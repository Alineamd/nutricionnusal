import { prisma } from '../db.js';
import { logAudit } from '../services/audit.js';

export const CONSENT_VERSION = '2.0'; // 2.0: texto con conservación legal y encargados del tratamiento

export default async function consentRoutes(fastify) {
  // El paciente acepta el uso de sus datos
  fastify.post('/me/consent', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo los pacientes aceptan el consentimiento.' });
    await prisma.patient.update({
      where: { id: patient.id },
      data: { consentAccepted: true, consentAt: new Date(), consentVersion: CONSENT_VERSION },
    });
    await logAudit(req, 'consentimiento_aceptado', { targetType: 'patient', targetId: patient.id });
    return { ok: true, consentAccepted: true, version: CONSENT_VERSION };
  });
}
