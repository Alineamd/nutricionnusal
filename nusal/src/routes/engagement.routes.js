import crypto from 'crypto';
import { prisma } from '../db.js';
import { logAudit } from '../services/audit.js';
import { hitLimit } from '../plugins/security.js';
import { sendPushToUser } from '../services/notifications.js';
import { buildIcs, weekStartMadrid } from '../services/calendar.js';

const S5 = { type: 'integer', minimum: 1, maximum: 5 };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
async function myPatient(req, reply) {
  const p = await prisma.patient.findUnique({ where: { userId: req.user.id }, include: { user: true } });
  if (!p) reply.code(403).send({ error: 'Solo pacientes.' });
  return p;
}

export default async function engagementRoutes(fastify) {
  // ── El paciente confirma o avisa de que no puede ir (solo a SUS citas) ──
  fastify.put('/me/appointments/:id/status', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['confirmada', 'cancelada'] } }, additionalProperties: false } },
  }, async (req, reply) => {
    const patient = await myPatient(req, reply); if (!patient) return;
    const a = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!a || a.patientId !== patient.id) return reply.code(404).send({ error: 'Cita no encontrada.' });
    const upd = await prisma.appointment.update({ where: { id: a.id }, data: { status: req.body.status, respondedAt: new Date() } });
    await logAudit(req, 'cita_' + req.body.status, { targetType: 'appointment', targetId: a.id });
    (async () => {
      try {
        const staff = await prisma.user.findMany({ where: { role: { in: ['admin', 'medico'] }, disabled: false } });
        const who = patient.user?.fullName || 'Un paciente';
        const ok = req.body.status === 'confirmada';
        await Promise.all(staff.map((s) => sendPushToUser(s.id, { title: ok ? 'Cita confirmada' : 'Un paciente no puede ir', body: who + (ok ? ' confirma' : ' NO puede ir a') + ' su cita del ' + a.date + ' a las ' + a.time, tag: 'cita-' + a.id, url: '/' })));
      } catch {}
    })();
    return { id: upd.id, status: upd.status, respondedAt: upd.respondedAt };
  });

  // ── Revisión semanal ──
  fastify.post('/me/checkin', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['energia', 'hambre', 'sueno', 'cumplimiento'], properties: { energia: S5, hambre: S5, sueno: S5, cumplimiento: S5, animo: S5, nota: { type: 'string', maxLength: 500 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const patient = await myPatient(req, reply); if (!patient) return;
    if (await hitLimit('checkin:' + req.user.id, 20, 3600 * 1000)) return reply.code(429).send({ error: 'Demasiados envíos. Inténtalo más tarde.' });
    const weekStart = weekStartMadrid();
    const b = req.body;
    const data = { energia: b.energia, hambre: b.hambre, sueno: b.sueno, cumplimiento: b.cumplimiento, animo: b.animo ?? null, nota: (b.nota || '').trim() || null };
    return prisma.weeklyCheckin.upsert({ where: { patientId_weekStart: { patientId: patient.id, weekStart } }, create: { patientId: patient.id, weekStart, ...data }, update: data });
  });
  fastify.get('/me/checkin', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const patient = await myPatient(req, reply); if (!patient) return;
    return { weekStart: weekStartMadrid(), checkins: await prisma.weeklyCheckin.findMany({ where: { patientId: patient.id }, orderBy: { weekStart: 'desc' }, take: 8 }) };
  });
  fastify.get('/patients/:id/checkins', { preHandler: [fastify.requireStaff] }, async (req) =>
    prisma.weeklyCheckin.findMany({ where: { patientId: req.params.id }, orderBy: { weekStart: 'desc' }, take: 12 }));
  fastify.get('/checkins/week', { preHandler: [fastify.requireStaff] }, async () => {
    const weekStart = weekStartMadrid();
    const rows = await prisma.weeklyCheckin.findMany({ where: { weekStart }, include: { patient: { include: { user: true } } } });
    return { weekStart, checkins: rows.map((c) => ({ patientId: c.patientId, name: c.patient?.user?.fullName || '', energia: c.energia, hambre: c.hambre, sueno: c.sueno, cumplimiento: c.cumplimiento, animo: c.animo, nota: c.nota })) };
  });

  // ── Calendario privado de la doctora (suscripción que se actualiza sola) ──
  fastify.post('/me/calendar-token', { preHandler: [fastify.requireStaff] }, async (req) => {
    const token = crypto.randomBytes(32).toString('hex'); // 256 bits: imposible de adivinar
    await prisma.user.update({ where: { id: req.user.id }, data: { calendarTokenHash: sha(token) } });
    await logAudit(req, 'calendario_enlace_creado');
    // En Netlify la API vive en /api (API_BASE_PATH) del mismo dominio que la app
    const base = (process.env.PUBLIC_API_URL || ((req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host + (process.env.API_BASE_PATH || ''))).replace(/\/$/, '');
    return { url: base + '/calendar/' + token + '.ics' };
  });
  fastify.delete('/me/calendar-token', { preHandler: [fastify.requireStaff] }, async (req) => {
    await prisma.user.update({ where: { id: req.user.id }, data: { calendarTokenHash: null } });
    await logAudit(req, 'calendario_enlace_revocado');
    return { ok: true };
  });
  fastify.get('/calendar/:file', async (req, reply) => {
    if (await hitLimit('cal-ip:' + (req.ip || 'x'), 60, 3600 * 1000)) return reply.code(429).send({ error: 'Demasiadas peticiones.' });
    const m = String(req.params.file).match(/^([a-f0-9]{64})\.ics$/);
    if (!m) return reply.code(404).send({ error: 'No encontrado.' });
    const user = await prisma.user.findUnique({ where: { calendarTokenHash: sha(m[1]) } });
    if (!user || user.disabled || !['admin', 'medico'].includes(user.role)) return reply.code(404).send({ error: 'No encontrado.' });
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const appts = await prisma.appointment.findMany({ where: { date: { gte: from } }, include: { patient: { include: { user: true } } }, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 2000 });
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    return buildIcs(appts.map((a) => ({ id: a.id, date: a.date, time: a.time, status: a.status, name: a.patient?.user?.fullName })), { calName: (process.env.APP_NAME || 'NUSAL') + ' · Citas' });
  });
}
