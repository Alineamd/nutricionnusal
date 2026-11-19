import { prisma } from '../db.js';
import { sendEmail, sendPushToUser, replyEmailHtml, escHtml } from '../services/notifications.js';
import { logAudit } from '../services/audit.js';

export default async function questionsRoutes(fastify) {
  // ── Paciente crea una duda → avisa a TODO el personal (push) ──
  fastify.post('/questions', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const { text } = req.body;
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id }, include: { user: true } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes pueden preguntar.' });
    const q = await prisma.patientQuestion.create({ data: { patientId: patient.id, text } });

    // Notificar a admins y médicos (para que contesten rápido, PC y móvil)
    const staff = await prisma.user.findMany({ where: { role: { in: ['admin', 'medico'] } }, select: { id: true, email: true } });
    const nombre = patient.user?.fullName || 'Un paciente';
    const payload = {
      title: 'Nueva consulta de un paciente',
      body: `${nombre}: "${text.slice(0, 80)}"`,
      tag: 'pregunta-' + q.id,
      url: '/',
    };
    // Aviso por push (móvil/PC) y por email (fiable en cualquier dispositivo)
    const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto"><div style="background:#7B2D8E;padding:18px;border-radius:14px 14px 0 0"><h2 style="color:#fff;margin:0">NUSAL</h2></div><div style="padding:22px;background:#faf8f5;border-radius:0 0 14px 14px"><p><b>${escHtml(nombre)}</b> te ha enviado una consulta:</p><blockquote style="background:#fff;border-left:3px solid #E8A025;padding:12px 16px;border-radius:8px">${escHtml(text)}</blockquote><p style="color:#888;font-size:13px">Entra en NUSAL para responder.</p></div></div>`;
    await Promise.all([
      ...staff.map((s) => sendPushToUser(s.id, payload)),
      ...staff.map((s) => sendEmail(s.email, 'Nueva consulta de un paciente', html)),
    ]);
    return q;
  });

  // ── La doctora responde → email + push al paciente ──
  fastify.post('/questions/:id/reply', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const { text } = req.body;
    await prisma.questionReply.create({ data: { questionId: req.params.id, text } });
    await prisma.patientQuestion.update({ where: { id: req.params.id }, data: { isAnswered: true } });

    // Localizar al paciente para notificarle
    const q = await prisma.patientQuestion.findUnique({
      where: { id: req.params.id },
      include: { patient: { include: { user: true } } },
    });
    const patientUser = q?.patient?.user;
    if (patientUser) {
      // Email
      await sendEmail(patientUser.email, 'Tu nutricionista te ha respondido', replyEmailHtml(patientUser.fullName, text));
      // Push (móvil)
      await sendPushToUser(patientUser.id, {
        title: 'Respuesta de tu nutricionista',
        body: text.slice(0, 100),
        tag: 'respuesta-' + req.params.id,
        url: '/',
      });
    }
    await logAudit(req, 'respuesta_enviada', { targetType: 'question', targetId: req.params.id });
    return { ok: true };
  });
}
