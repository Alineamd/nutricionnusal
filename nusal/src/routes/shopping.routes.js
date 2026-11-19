import { prisma } from '../db.js';
import { buildShoppingList } from '../services/shoppingList.js';

function mealsToStructure(meals) {
  const days = {};
  for (const m of meals) {
    if (!days[m.dayName]) days[m.dayName] = {};
    days[m.dayName][m.mealType] = { name: m.mealName, cal: m.calories, ingredients: m.ingredients };
  }
  return { days };
}

export default async function shoppingRoutes(fastify) {
  // Genera (y guarda) la lista de la compra de un paciente a partir de su dieta actual
  fastify.get('/patients/:id/shopping-list', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    // Solo el propio paciente o el personal clínico
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
    if (!patient) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    if (!['admin','medico'].includes(req.user.role) && patient.userId !== req.user.id) {
      return reply.code(403).send({ error: 'No autorizado.' });
    }
    const assignment = await prisma.patientDietAssignment.findFirst({
      where: { patientId: req.params.id, isCurrent: true },
      include: { weeklyDiet: { include: { meals: true } } },
    });
    if (!assignment) return { items: [], message: 'El paciente no tiene dieta asignada.' };

    const diet = mealsToStructure(assignment.weeklyDiet.meals);
    const items = buildShoppingList(diet, []);
    return { dietName: assignment.weeklyDiet.name, items };
  });
}
