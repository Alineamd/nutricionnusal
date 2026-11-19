import { prisma } from '../db.js';

const STORES = ['Mercadona', 'DÍA', 'Carrefour', 'Lidl', 'Alcampo', ''];

export default async function preferencesRoutes(fastify) {
  // El paciente fija/actualiza su supermercado preferido
  fastify.post('/me/preferred-store', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['store'], properties: {
      store: { type: 'string', maxLength: 30 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const store = STORES.includes(req.body.store) ? req.body.store : null;
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes.' });
    await prisma.patient.update({ where: { id: patient.id }, data: { preferredStore: store || null } });
    return { ok: true, preferredStore: store };
  });

  // El paciente guarda su adherencia (comidas marcadas como hechas)
  fastify.post('/me/adherence', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['mealsDone'], properties: {
      mealsDone: { type: 'object', maxProperties: 600, additionalProperties: { type: 'boolean' } },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes.' });
    await prisma.patient.update({ where: { id: patient.id }, data: { mealsDone: req.body.mealsDone } });
    return { ok: true };
  });

  // El paciente guarda sus vasos de agua de hoy
  fastify.post('/me/water', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['water'], properties: {
      water: { type: 'integer', minimum: 0, maximum: 30 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes.' });
    const today = new Date().toISOString().slice(0, 10);
    await prisma.patient.update({ where: { id: patient.id }, data: { waterToday: req.body.water, waterDate: today } });
    return { ok: true, water: req.body.water };
  });

  // Pantalla de inicio personalizada (paciente y personal): widgets elegidos y su orden
  fastify.get('/me/home-layout', { preHandler: [fastify.authenticate] }, async (req) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { homeLayout: true } });
    return { layout: Array.isArray(u?.homeLayout) ? u.homeLayout : null };
  });
  fastify.put('/me/home-layout', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['layout'], properties: {
      layout: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[a-zA-Z_-]{1,30}$' } },
    }, additionalProperties: false } },
  }, async (req) => {
    const layout = [...new Set(req.body.layout)];
    await prisma.user.update({ where: { id: req.user.id }, data: { homeLayout: layout } });
    return { ok: true, layout };
  });
}
