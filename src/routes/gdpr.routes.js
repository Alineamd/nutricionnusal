import { encStr, decStr, encJson, decJson } from '../services/fieldCrypto.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../db.js';

// Recopila TODOS los datos de un paciente en JSON legible (derecho de acceso/portabilidad)
async function buildExport(patientId, { notasPrivadas = true } = {}) {
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      user: true, weights: true, notes: true, appointments: true, mensajes: true,
      assignments: { include: { weeklyDiet: { include: { meals: true } } } },
      checkins: true, measurements: true,
      questions: true, shoppingLists: { include: { items: true } }, clinicalRecord: true,
    },
  });
  if (!p) return null;
  return {
    generado: new Date().toISOString(),
    descripcion: 'Copia de todos tus datos personales almacenados en la aplicación (RGPD, derecho de acceso y portabilidad).',
    perfil: {
      nombre: p.user?.fullName, email: p.user?.email, dni: p.dni, telefono: p.phone,
      nacimiento: p.birthDate, sexo: p.sex, alturaCm: p.heightCm,
      pesoInicial: p.startWeight, pesoActual: p.currentWeight, pesoObjetivo: p.targetWeight,
      objetivo: p.goal, tipoDieta: p.dietType, alergias: p.allergies, aversiones: p.dislikes,
      medicacion: p.medicacion || [], duracionDietaSemanas: p.dietWeeks,
      consentimiento: { aceptado: p.consentAccepted, fecha: p.consentAt },
    },
    seguimiento: {
      adherenciaComidas: p.mealsDone || {},
      aguaHoy: p.waterToday, fechaAgua: p.waterDate,
      historialPeso: p.weights.map(w => ({ fecha: w.recordedAt, kg: w.weight })),
      medidasCorporales: (p.measurements || []).map(m => ({ fecha: m.recordedDate, cinturaCm: m.waistCm, caderaCm: m.hipCm, pechoCm: m.chestCm, brazoCm: m.armCm, musloCm: m.thighCm, grasaPct: m.bodyFatPct, masaMuscularKg: m.muscleMassKg })),
      revisionesSemanales: (p.checkins || []).map(c => ({ semana: c.weekStart, energia: c.energia, hambre: c.hambre, sueno: c.sueno, cumplimiento: c.cumplimiento, animo: c.animo, nota: c.nota })),
    },
    dietasAsignadas: p.assignments.map(a => ({ nombre: a.weeklyDiet?.name, asignadaEl: a.startDate, actual: a.isCurrent,
      comidas: (a.weeklyDiet?.meals || []).map(m => ({ semana: m.weekNumber, dia: m.dayName, comida: m.mealType, plato: m.mealName, kcal: m.calories, ingredientes: m.ingredients })) })),
    citas: p.appointments.map(a => ({ fecha: a.date, hora: a.time, motivo: a.note, estado: a.status })),
    mensajesChat: p.mensajes.map(m => ({ fecha: m.createdAt, de: m.senderRole === 'patient' ? 'paciente' : 'clínica', texto: m.texto })),
    consultasAntiguas: p.questions.map(q => ({ fecha: q.createdAt, texto: q.text })),
    cestasCompra: p.shoppingLists.map(l => ({ creada: l.createdAt, articulos: (l.items || []).map(i => i.name) })),
    // Las notas privadas son anotaciones subjetivas de la profesional (Ley 41/2002, art. 18.3):
    // salen en la exportación que hace la clínica, no en la que descarga el propio paciente.
    ...(notasPrivadas ? { notasClinicas: p.notes.map(n => ({ fecha: n.createdAt, texto: decStr(n.text) })) } : {}),
    historiaClinica: p.clinicalRecord ? { actualizada: p.clinicalRecord.updatedAt, contenido: decJson(p.clinicalRecord.data) } : null,
  };
}

// Borrado completo: el Cascade de Prisma elimina paciente y todo lo suyo al borrar el usuario
async function deleteUserCompletely(userId) {
  await prisma.$transaction([
    prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}


// Plazo legal de conservación de la documentación clínica (Ley 41/2002, art. 17: mínimo 5 años desde el alta)
const RETENTION_YEARS = Math.max(5, parseInt(process.env.CLINICAL_RETENTION_YEARS || '5', 10) || 5);

// Baja: la persona deja de poder entrar y sus datos quedan bloqueados; la historia clínica se conserva
// durante el plazo legal y se elimina automáticamente al vencer (ver purgeExpiredRecords).
export async function archivePatient(patient) {
  const now = new Date();
  const until = new Date(now); until.setFullYear(until.getFullYear() + RETENTION_YEARS);
  const lockHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
  await prisma.$transaction([
    prisma.patient.update({ where: { id: patient.id }, data: { isActive: false, archivedAt: now, retainUntil: until } }),
    prisma.user.update({ where: { id: patient.userId }, data: { disabled: true, passwordHash: lockHash, homeLayout: null, twoFactorEnabled: false, twoFactorSecret: null, resetCodeHash: null, resetExpires: null } }),
    prisma.pushSubscription.deleteMany({ where: { userId: patient.userId } }),
  ]);
  return until;
}

// Elimina definitivamente las historias cuyo plazo de conservación ha vencido
export async function purgeExpiredRecords() {
  const expired = await prisma.patient.findMany({ where: { retainUntil: { lt: new Date() } }, select: { userId: true } });
  for (const p of expired) await deleteUserCompletely(p.userId);
  return expired.length;
}

export default async function gdprRoutes(fastify) {
  // ── El propio paciente: exportar todos sus datos ──
  fastify.get('/me/export', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes.' });
    const data = await buildExport(patient.id, { notasPrivadas: false });
    await prisma.gdprLog.create({ data: { action: 'export', actorRole: req.user.role, actorId: req.user.id, targetType: 'self' } });
    return data;
  });

  // ── El propio paciente: borrar su cuenta (confirmación por contraseña) ──
  fastify.delete('/me/account', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['password'], properties: { password: { type: 'string', minLength: 4, maxLength: 128 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return reply.code(403).send({ error: 'Solo pacientes.' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;
    if (!ok) return reply.code(401).send({ error: 'Contraseña incorrecta.' });
    await prisma.gdprLog.create({ data: { action: 'baja', actorRole: req.user.role, actorId: req.user.id, targetType: 'self' } });
    const until = await archivePatient(patient);
    return { ok: true, retainUntil: until, message: 'Cuenta dada de baja. Por obligación legal, tu historia clínica se conserva bloqueada hasta ' + until.toLocaleDateString('es-ES') + ' y después se elimina automáticamente.' };
  });

  // ── Personal: exportar los datos de un paciente ──
  fastify.get('/patients/:id/export', { preHandler: [fastify.requireStaff] }, async (req, reply) => {
    const data = await buildExport(req.params.id);
    if (!data) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    await prisma.gdprLog.create({ data: { action: 'export', actorRole: req.user.role, actorId: req.user.id, targetType: 'patient' } });
    return data;
  });

  // ── Personal: borrado RGPD (doble confirmación escribiendo el nombre) ──
  fastify.delete('/patients/:id/gdpr', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['confirmName'], properties: { confirmName: { type: 'string', maxLength: 120 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!patient) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    const real = (patient.user?.fullName || '').trim().toLowerCase();
    if (!real || req.body.confirmName.trim().toLowerCase() !== real) {
      return reply.code(400).send({ error: 'El nombre no coincide. Escribe el nombre completo del paciente para confirmar.' });
    }
    if (patient.archivedAt) return reply.code(409).send({ error: 'Este paciente ya está dado de baja.' });
    await prisma.gdprLog.create({ data: { action: 'baja', actorRole: req.user.role, actorId: req.user.id, targetType: 'patient' } });
    const until = await archivePatient(patient);
    return { ok: true, retainUntil: until };
  });
}
