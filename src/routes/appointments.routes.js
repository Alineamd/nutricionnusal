import { prisma } from '../db.js';
import { logAudit } from '../services/audit.js';

export default async function appointmentsRoutes(fastify) {
  // Listar todas las citas (staff)
  fastify.get('/appointments', { preHandler: [fastify.requireStaff] }, async () => {
    // Incluye el estado (confirmada / cancelada por el paciente) para que la doctora lo vea; sin pacientes dados de baja
    const rows = await prisma.appointment.findMany({
      where: { patient: { archivedAt: null } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      include: { patient: { select: { user: { select: { fullName: true } } } } },
    });
    return rows.map((a) => ({ id: a.id, date: a.date, time: a.time, note: a.note, patientId: a.patientId, patientName: a.patient?.user?.fullName || '', status: a.status, respondedAt: a.respondedAt }));
  });

  // Crear cita (staff). Actualiza también la "próxima cita" visible del paciente.
  fastify.post('/appointments', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['patientId', 'date', 'time'], properties: {
      patientId: { type: 'string', maxLength: 60 },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
      note: { type: 'string', maxLength: 300 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const { patientId, date, time, note } = req.body;
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    const appt = await prisma.appointment.create({ data: { patientId, date, time, note: note || null } });
    // Texto visible "15 jul · 10:00"
    const MON = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const d = new Date(date + 'T00:00');
    const txt = d.getDate() + ' ' + MON[d.getMonth()] + ' · ' + time;
    await prisma.patient.update({ where: { id: patientId }, data: { nextAppt: txt } });
    await logAudit(req, 'crear_cita', { targetType: 'appointment', targetId: appt.id });
    return { id: appt.id, date, time, note: appt.note, patientId };
  });

  // Borrar cita (staff)
  fastify.delete('/appointments/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    try { await prisma.appointment.delete({ where: { id: req.params.id } }); } catch {}
    await logAudit(req, 'borrar_cita', { targetType: 'appointment', targetId: req.params.id });
    return { ok: true };
  });
}
