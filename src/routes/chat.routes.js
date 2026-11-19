import { prisma } from '../db.js';
import { hitLimit } from '../plugins/security.js';
import { sendEmail, sendPushToUser } from '../services/notifications.js';

// Comprueba que quien llama puede acceder a la conversación de ese paciente
async function canAccess(req, patientId) {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, include: { user: true } });
  if (!patient) return { ok: false, code: 404, error: 'Paciente no encontrado.' };
  const isStaff = ['admin', 'medico'].includes(req.user.role);
  if (!isStaff && patient.userId !== req.user.id) return { ok: false, code: 403, error: 'No autorizado.' };
  return { ok: true, patient, isStaff };
}

export default async function chatRoutes(fastify) {
  // Lista de conversaciones (staff): último mensaje + no leídos por conversación
  fastify.get('/chat', { preHandler: [fastify.requireStaff] }, async () => {
    const últimos = await prisma.mensaje.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { patient: { include: { user: true } } } });
    const conv = new Map();
    for (const m of últimos) {
      if (!conv.has(m.patientId)) conv.set(m.patientId, { patientId: m.patientId, patientName: m.patient?.user?.fullName || '', last: m.texto, lastAt: m.createdAt, lastRole: m.senderRole, unread: 0 });
      if (m.senderRole === 'patient' && !m.leido) conv.get(m.patientId).unread++;
    }
    return { conversations: [...conv.values()] };
  });

  // Historial de una conversación (paginado hacia atrás)
  fastify.get('/chat/:patientId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const acc = await canAccess(req, req.params.patientId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const { before, limit } = req.query || {};
    const take = Math.min(parseInt(limit) || 50, 100);
    const where = { patientId: req.params.patientId };
    if (before) where.createdAt = { lt: new Date(before) };
    const msgs = await prisma.mensaje.findMany({ where, orderBy: { createdAt: 'desc' }, take });
    return { messages: msgs.reverse() };
  });

  // Enviar mensaje
  fastify.post('/chat', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['patientId', 'texto'], properties: {
      patientId: { type: 'string', maxLength: 60 },
      texto: { type: 'string', minLength: 1, maxLength: 2000 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    if (await hitLimit('chat:' + req.user.id, 20, 60 * 1000)) return reply.code(429).send({ error: 'Estás enviando mensajes muy rápido. Espera un momento.' });
    const acc = await canAccess(req, req.body.patientId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const msg = await prisma.mensaje.create({ data: {
      patientId: req.body.patientId, senderId: req.user.id, senderRole: req.user.role, texto: req.body.texto,
    } });
    // Notificar al otro lado (sin bloquear la respuesta)
    (async () => {
      try {
        if (acc.isStaff) {
          const u = acc.patient.user;
          const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto"><div style="background:#7B2D8E;padding:18px;border-radius:14px 14px 0 0"><h2 style="color:#fff;margin:0">Nuevo mensaje de tu nutricionista</h2></div><div style="padding:22px;background:#faf8f5;border-radius:0 0 14px 14px"><p style="white-space:pre-wrap">${req.body.texto.slice(0, 400)}</p><p style="color:#888;font-size:13px">Responde desde la app.</p></div></div>`;
          await Promise.all([
            sendEmail(u.email, 'Tienes un mensaje nuevo', html),
            sendPushToUser(u.id, { title: 'Mensaje de tu nutricionista', body: req.body.texto.slice(0, 120), tag: 'chat-' + acc.patient.id, url: '/' }),
          ]);
        } else {
          const staff = await prisma.user.findMany({ where: { role: { in: ['admin', 'medico'] } } });
          await Promise.all(staff.map(s => sendPushToUser(s.id, { title: 'Mensaje de ' + (acc.patient.user?.fullName || 'paciente'), body: req.body.texto.slice(0, 120), tag: 'chat-' + acc.patient.id, url: '/' })));
        }
      } catch {}
    })();
    return msg;
  });

  // Marcar leídos (los mensajes del otro lado)
  fastify.put('/chat/leidos', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['patientId'], properties: { patientId: { type: 'string', maxLength: 60 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const acc = await canAccess(req, req.body.patientId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const otherRoles = acc.isStaff ? ['patient'] : ['admin', 'medico'];
    await prisma.mensaje.updateMany({ where: { patientId: req.body.patientId, senderRole: { in: otherRoles }, leido: false }, data: { leido: true } });
    return { ok: true };
  });
}
