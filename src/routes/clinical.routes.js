import { encStr, decStr, encJson, decJson } from '../services/fieldCrypto.js';
import { prisma } from '../db.js';
import { logAudit } from '../services/audit.js';

// Limpia el JSON de la historia: solo texto, números, booleanos, listas y objetos, con límites
function sanitize(v, depth = 0) {
  if (depth > 5) return null;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 5000);
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => sanitize(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).slice(0, 250).forEach((k) => { if (/^[a-zA-Z0-9_]{1,40}$/.test(k)) o[k] = sanitize(v[k], depth + 1); });
    return o;
  }
  return null;
}

export default async function clinicalRoutes(fastify) {
  // Historia clínica (solo personal clínico; cada lectura queda auditada)
  fastify.get('/patients/:id/clinical', { preHandler: [fastify.requireStaff] }, async (req, reply) => {
    const p = await prisma.patient.findUnique({ where: { id: req.params.id }, select: { id: true, archivedAt: true, retainUntil: true } });
    if (!p) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    const rec = await prisma.clinicalRecord.findUnique({ where: { patientId: p.id } });
    const history = await prisma.clinicalRecordHistory.findMany({ where: { patientId: p.id }, orderBy: { savedAt: 'desc' }, take: 20, select: { savedAt: true, savedBy: true } });
    await logAudit(req, 'historia_clinica_consulta', { targetType: 'patient', targetId: p.id });
    return { data: decJson(rec?.data) || {}, updatedAt: rec?.updatedAt || null, updatedBy: rec?.updatedBy || null, history, archived: !!p.archivedAt, retainUntil: p.retainUntil };
  });

  // Guardar el historial clínico.
  // - Concurrencia: si se envía baseUpdatedAt y el historial cambió desde entonces (otra sesión/dispositivo), responde 409
  //   en lugar de sobrescribir en silencio.
  // - Versiones: los guardados automáticos de la misma persona dentro de 15 min se agrupan en una única versión.
  fastify.put('/patients/:id/clinical', {
    preHandler: [fastify.requireStaff],
    bodyLimit: 400000,
    schema: { body: { type: 'object', required: ['data'], additionalProperties: false, properties: {
      data: { type: 'object', maxProperties: 250 },
      baseUpdatedAt: { type: ['string', 'null'], maxLength: 40 },
      autosave: { type: 'boolean' },
    } } },
  }, async (req, reply) => {
    const p = await prisma.patient.findUnique({ where: { id: req.params.id }, select: { id: true, archivedAt: true } });
    if (!p) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    if (p.archivedAt) return reply.code(409).send({ error: 'Historia archivada: solo lectura.' });
    const current = await prisma.clinicalRecord.findUnique({ where: { patientId: p.id }, select: { updatedAt: true, updatedBy: true } });
    if (req.body.baseUpdatedAt && current && current.updatedAt.toISOString() !== req.body.baseUpdatedAt) {
      return reply.code(409).send({ error: 'El historial ha cambiado desde otra sesión.', conflict: true, updatedAt: current.updatedAt, updatedBy: current.updatedBy });
    }
    const data = sanitize(req.body.data) || {};
    const who = req.user.name || req.user.fullName || req.user.email || req.user.id; // el token lleva el nombre en 'name'
    const last = await prisma.clinicalRecordHistory.findFirst({ where: { patientId: p.id }, orderBy: { savedAt: 'desc' }, select: { id: true, savedBy: true, savedAt: true } });
    const group = last && last.savedBy === who && Date.now() - new Date(last.savedAt).getTime() < 15 * 60 * 1000;
    const enc = encJson(data);
    const [rec] = await prisma.$transaction([
      prisma.clinicalRecord.upsert({ where: { patientId: p.id }, create: { patientId: p.id, data: enc, updatedBy: who }, update: { data: enc, updatedBy: who } }),
      group
        ? prisma.clinicalRecordHistory.update({ where: { id: last.id }, data: { data: enc } })
        : prisma.clinicalRecordHistory.create({ data: { patientId: p.id, data: enc, savedBy: who } }),
    ]);
    if (!req.body.autosave || !group) await logAudit(req, 'historia_clinica_guardada', { targetType: 'patient', targetId: p.id });
    return { ok: true, updatedAt: rec.updatedAt, updatedBy: rec.updatedBy, newVersion: !group };
  });

  // Pacientes dados de baja: historia conservada y bloqueada hasta que venza el plazo legal
  fastify.get('/patients-archived', { preHandler: [fastify.requireStaff] }, async () => {
    const rows = await prisma.patient.findMany({ where: { archivedAt: { not: null } }, include: { user: true }, orderBy: { archivedAt: 'desc' } });
    return rows.map((p) => ({ id: p.id, name: p.user?.fullName || '', archivedAt: p.archivedAt, retainUntil: p.retainUntil }));
  });

  // El paciente ve sus próximas citas (solo las suyas)
  fastify.get('/me/appointments', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes.' });
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const rows = await prisma.appointment.findMany({ where: { patientId: patient.id, date: { gte: today } }, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 20 });
    return rows.map((a) => ({ id: a.id, date: a.date, time: a.time, note: a.note, status: a.status }));
  });
}
