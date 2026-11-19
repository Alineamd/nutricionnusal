import { prisma } from '../db.js';

// Convierte las filas de comidas en la estructura { days: { Lunes: { COMIDA: {...} } } }
function mealsToStructure(meals) {
  // Agrupa por semana (weekNumber) -> array de {dia:{tipo:comida}}
  const byWeek = {};
  for (const m of meals) {
    const w = m.weekNumber || 1;
    if (!byWeek[w]) byWeek[w] = {};
    if (!byWeek[w][m.dayName]) byWeek[w][m.dayName] = {};
    byWeek[w][m.dayName][m.mealType] = { name: m.mealName, cal: m.calories, ingredients: m.ingredients };
  }
  const nums = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  const weeks = nums.map((n) => byWeek[n]);
  return { weeks: weeks.length ? weeks : [{}], days: weeks[0] || {} };
}

export default async function dietsRoutes(fastify) {
  // Listar dietas con sus comidas y asignaciones
  // El personal ve todas; un paciente SOLO la dieta que tiene asignada (nunca las de otros pacientes)
  fastify.get('/diets', { preHandler: [fastify.authenticate] }, async (req) => {
    const staff = ['admin', 'medico'].includes(req.user.role);
    let where = { isActive: true };
    let asgWhere = { isCurrent: true };
    if (!staff) {
      const me = await prisma.patient.findFirst({ where: { userId: req.user.id }, select: { id: true } });
      if (!me) return [];
      asgWhere = { isCurrent: true, patientId: me.id };
      where = { isActive: true, assignments: { some: asgWhere } };
    }
    const diets = await prisma.weeklyDiet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { meals: true, assignments: { where: asgWhere } },
    });
    return diets.map((d) => ({
      id: d.id,
      name: d.name,
      desc: d.description,
      targetKcal: d.targetKcal,
      source: d.source,
      ...mealsToStructure(d.meals),
      numWeeks: (mealsToStructure(d.meals).weeks || [{}]).length,
      assignedTo: d.assignments.map((a) => a.patientId),
    }));
  });

  // Crear o actualizar una dieta completa (con sus comidas)
  fastify.post('/diets', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { id: {}, name: { type: 'string', minLength: 1, maxLength: 150 }, desc: { type: ['string', 'null'], maxLength: 1000 }, targetKcal: { type: ['number', 'null'], minimum: 0, maximum: 6000 }, source: { type: ['string', 'null'], maxLength: 40 }, days: { type: ['object', 'null'] }, weeks: { type: ['array', 'null'], maxItems: 12 } } } } }, async (req, reply) => {
    const { id, name, desc, targetKcal, source, days, weeks } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name requerido.' });

    // Semanas: usa weeks[] si viene; si no, days como semana 1
    const weekList = (Array.isArray(weeks) && weeks.length) ? weeks : [days || {}];
    const mealRows = [];
    weekList.forEach((wk, wi) => {
      for (const [dayName, dayMeals] of Object.entries(wk || {})) {
        for (const [mealType, meal] of Object.entries(dayMeals)) {
          mealRows.push({
            weekNumber: wi + 1,
            dayName, mealType,
            mealName: meal.name,
            calories: meal.cal || 0,
            ingredients: meal.ingredients || [],
          });
        }
      }
    });

    let diet;
    if (id) {
      // Actualizar: borra comidas antiguas y reinserta
      await prisma.weeklyDietMeal.deleteMany({ where: { weeklyDietId: id } });
      diet = await prisma.weeklyDiet.update({
        where: { id },
        data: {
          name, description: desc, targetKcal: targetKcal || null, source: source || 'manual',
          meals: { create: mealRows },
        },
        include: { meals: true },
      });
    } else {
      diet = await prisma.weeklyDiet.create({
        data: {
          name, description: desc, targetKcal: targetKcal || null, source: source || 'manual',
          clinicId: req.body.clinicId || null,
          meals: { create: mealRows },
        },
        include: { meals: true },
      });
    }

    return { id: diet.id, name: diet.name, desc: diet.description, ...mealsToStructure(diet.meals) };
  });

  // Borrar
  fastify.delete('/diets/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    await prisma.weeklyDiet.update({ where: { id: req.params.id }, data: { isActive: false } });
    return { ok: true };
  });

  // Asignar dieta a paciente
  fastify.post('/diets/:id/assign', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', required: ['patientId'], additionalProperties: false, properties: { patientId: { type: 'string', maxLength: 60 } } } } }, async (req, reply) => {
    const { patientId } = req.body || {};
    if (!patientId) return reply.code(400).send({ error: 'patientId requerido.' });
    // Desactiva asignaciones previas del paciente
    await prisma.patientDietAssignment.updateMany({
      where: { patientId, isCurrent: true }, data: { isCurrent: false },
    });
    await prisma.patientDietAssignment.create({
      data: { patientId, weeklyDietId: req.params.id, isCurrent: true },
    });
    return { ok: true };
  });
}
