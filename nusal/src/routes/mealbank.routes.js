import { prisma } from '../db.js';
import { nutricionDeComposicion } from '../services/dietEngine.js';

export default async function mealBankRoutes(fastify) {
  // Listar (cualquiera logueado puede leer)
  fastify.get('/meals', { preHandler: [fastify.authenticate] }, async () => {
    return prisma.mealBank.findMany({ orderBy: { mealType: 'asc' } });
  });

  // Crear (solo admin)
  fastify.post('/meals', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', required: ['mealType', 'name'], maxProperties: 15, properties: { mealType: { type: 'string', maxLength: 30 }, name: { type: 'string', minLength: 1, maxLength: 150 }, calories: { type: ['number', 'string', 'null'] }, ingredients: { type: ['array', 'null'], maxItems: 60 }, tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } }, composicion: { type: ['array', 'object', 'null'] } } } } }, async (req, reply) => {
    const { mealType, name, ingredients, tags, composicion } = req.body || {};
    let { calories } = req.body || {};
    if (!mealType || !name) return reply.code(400).send({ error: 'mealType y name requeridos.' });
    // Si viene composición de alimentos, las kcal se calculan con valores reales (BEDCA)
    if (Array.isArray(composicion) && composicion.length) {
      const alimentos = await prisma.alimento.findMany();
      const nut = nutricionDeComposicion(composicion, alimentos);
      calories = Math.round(nut.kcal);
    }
    return prisma.mealBank.create({
      data: {
        mealType, name,
        calories: calories || 0,
        composicion: composicion || null,
        ingredients: ingredients || [],
        tags: tags || [],
        clinicId: req.body.clinicId || null,
      },
    });
  });

  // Borrar (solo admin)
  fastify.delete('/meals/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    await prisma.mealBank.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
}
