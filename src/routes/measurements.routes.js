import { prisma } from '../db.js';

// Composición corporal: % grasa, masa muscular, perímetros...
export default async function measurementsRoutes(fastify) {
  // Listar medidas de un paciente (admin o el propio paciente)
  fastify.get('/patients/:id/measurements', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
    if (!patient) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    if (!['admin','medico'].includes(req.user.role) && patient.userId !== req.user.id) {
      return reply.code(403).send({ error: 'No autorizado.' });
    }
    return prisma.bodyMeasurement.findMany({
      where: { patientId: req.params.id },
      orderBy: { recordedDate: 'asc' },
    });
  });

  // Registrar composición corporal (admin)
  fastify.post('/patients/:id/measurements', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', maxProperties: 20, additionalProperties: { anyOf: [{ type: 'number' }, { type: 'null' }, { type: 'string', maxLength: 30 }] } } } }, async (req) => {
    const b = req.body || {};
    const m = await prisma.bodyMeasurement.create({
      data: {
        patientId: req.params.id,
        waistCm: num(b.waistCm),
        hipCm: num(b.hipCm),
        chestCm: num(b.chestCm),
        armCm: num(b.armCm),
        thighCm: num(b.thighCm),
        bodyFatPct: num(b.bodyFatPct),
        muscleMassKg: num(b.muscleMassKg),
      },
    });
    return m;
  });
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
