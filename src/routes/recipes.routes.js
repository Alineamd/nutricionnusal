import { prisma } from '../db.js';

export default async function recipesRoutes(fastify) {
  fastify.get('/recipes', { preHandler: [fastify.authenticate] }, async () => {
    return prisma.recipe.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
  });

  fastify.post('/recipes', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 150 }, calories: { type: ['number', 'string', 'null'] }, prepTime: { type: ['string', 'number', 'null'] }, servings: { type: ['number', 'string', 'null'] }, ingredients: { type: 'array', maxItems: 80, items: { type: 'string', maxLength: 300 } }, steps: { type: 'array', maxItems: 60, items: { type: 'string', maxLength: 2000 } }, source: { type: ['string', 'null'], maxLength: 500 }, tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } } } } } }, async (req, reply) => {
    const { name, calories, prepTime, servings, ingredients, steps, source, tags } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name requerido.' });
    return prisma.recipe.create({
      data: {
        name,
        calories: calories || 0,
        prepTime: prepTime || null,
        servings: servings || 2,
        ingredients: ingredients || [],
        steps: steps || [],
        tags: tags || [],
        source: source || 'manual',
        clinicId: req.body.clinicId || null,
      },
    });
  });

  fastify.delete('/recipes/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    await prisma.recipe.update({ where: { id: req.params.id }, data: { isActive: false } });
    return { ok: true };
  });
}
