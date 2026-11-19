import { prisma } from '../db.js';

export default async function alimentosRoutes(fastify) {
  // Buscar/listar (cualquier usuario logueado; el paciente puede consultar)
  fastify.get('/alimentos', { preHandler: [fastify.authenticate] }, async (req) => {
    const { q, categoria } = req.query || {};
    const where = {};
    if (q) where.nombre = { contains: String(q).slice(0, 60), mode: 'insensitive' };
    if (categoria) where.categoria = String(categoria).slice(0, 40);
    const rows = await prisma.alimento.findMany({ where, orderBy: { nombre: 'asc' }, take: 400 });
    return { items: rows };
  });

  const bodySchema = { type: 'object', required: ['nombre', 'categoria', 'kcal'], properties: {
    nombre: { type: 'string', maxLength: 80 }, categoria: { type: 'string', maxLength: 40 },
    kcal: { type: 'number', minimum: 0, maximum: 950 },
    proteinas: { type: 'number', minimum: 0, maximum: 100 }, hidratos: { type: 'number', minimum: 0, maximum: 100 },
    azucares: { type: 'number', minimum: 0, maximum: 100 }, grasas: { type: 'number', minimum: 0, maximum: 100 },
    grasasSat: { type: 'number', minimum: 0, maximum: 100 }, fibra: { type: 'number', minimum: 0, maximum: 60 },
    sal: { type: 'number', minimum: 0, maximum: 40 }, calcio: { type: 'number', minimum: 0, maximum: 2000 },
    hierro: { type: 'number', minimum: 0, maximum: 60 }, vitD: { type: 'number', minimum: 0, maximum: 100 },
    b12: { type: 'number', minimum: 0, maximum: 100 }, potasio: { type: 'number', minimum: 0, maximum: 4000 },
  }, additionalProperties: false };

  fastify.post('/alimentos', { preHandler: [fastify.requireStaff], schema: { body: bodySchema } }, async (req) => {
    const d = { proteinas:0,hidratos:0,azucares:0,grasas:0,grasasSat:0,fibra:0,sal:0,calcio:0,hierro:0,vitD:0,b12:0,potasio:0, ...req.body };
    return prisma.alimento.upsert({ where: { nombre: d.nombre }, update: d, create: d });
  });

  fastify.put('/alimentos/:id', { preHandler: [fastify.requireStaff], schema: { body: bodySchema } }, async (req, reply) => {
    try { return await prisma.alimento.update({ where: { id: req.params.id }, data: req.body }); }
    catch { return reply.code(404).send({ error: 'Alimento no encontrado.' }); }
  });

  fastify.delete('/alimentos/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    try { await prisma.alimento.delete({ where: { id: req.params.id } }); } catch {}
    return { ok: true };
  });
}
