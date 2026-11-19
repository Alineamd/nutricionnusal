import { prisma } from '../db.js';

export default async function farmacosRoutes(fastify) {
  fastify.get('/farmacos', { preHandler: [fastify.authenticate] }, async (req) => {
    const { q } = req.query || {};
    const where = q ? { OR: [
      { nombre: { contains: String(q).slice(0, 60), mode: 'insensitive' } },
      { principioActivo: { contains: String(q).slice(0, 60), mode: 'insensitive' } },
    ] } : {};
    return { items: await prisma.farmaco.findMany({ where, orderBy: { nombre: 'asc' }, take: 200 }) };
  });

  const bodySchema = { type: 'object', required: ['nombre', 'principioActivo'], properties: {
    nombre: { type: 'string', maxLength: 80 }, principioActivo: { type: 'string', maxLength: 80 },
    grupo: { type: 'string', maxLength: 60 }, interacciones: { type: 'array', maxItems: 30 },
  }, additionalProperties: false };

  fastify.post('/farmacos', { preHandler: [fastify.requireStaff], schema: { body: bodySchema } }, async (req) =>
    prisma.farmaco.upsert({ where: { nombre: req.body.nombre }, update: { ...req.body, grupo: req.body.grupo || 'Otros', interacciones: req.body.interacciones || [] }, create: { ...req.body, grupo: req.body.grupo || 'Otros', interacciones: req.body.interacciones || [] } }));

  fastify.put('/farmacos/:id', { preHandler: [fastify.requireStaff], schema: { body: bodySchema } }, async (req, reply) => {
    try { return await prisma.farmaco.update({ where: { id: req.params.id }, data: req.body }); }
    catch { return reply.code(404).send({ error: 'No encontrado.' }); }
  });

  fastify.delete('/farmacos/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    try { await prisma.farmaco.delete({ where: { id: req.params.id } }); } catch {}
    return { ok: true };
  });
}
