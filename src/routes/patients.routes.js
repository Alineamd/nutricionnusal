import { encStr, decStr, encJson, decJson } from '../services/fieldCrypto.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { logAudit } from '../services/audit.js';

export default async function patientsRoutes(fastify) {
  // Listar pacientes (admin)
  fastify.get('/patients', { preHandler: [fastify.requireStaff] }, async () => {
    const patients = await prisma.patient.findMany({
      where: { isActive: true },
      include: { user: true, weights: { orderBy: { recordedAt: 'asc' } }, questions: true, assignments: { where: { isCurrent: true }, orderBy: { startDate: 'desc' }, take: 1, select: { weeklyDietId: true } } },
    });
    return patients.map(fmtPatient);
  });

  // Un paciente (admin o el propio paciente)
  fastify.get('/patients/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const staff = ['admin', 'medico'].includes(req.user.role);
    const p = await prisma.patient.findUnique({
      where: { id: req.params.id },
      // Las notas privadas (anotaciones de la profesional) solo viajan al personal clínico, nunca al paciente
      include: { user: true, weights: { orderBy: { recordedAt: 'asc' } }, questions: { include: { replies: true } }, notes: staff, assignments: { where: { isCurrent: true }, orderBy: { startDate: 'desc' }, take: 1, select: { weeklyDietId: true } } },
    });
    if (!p) return reply.code(404).send({ error: 'Paciente no encontrado.' });
    if (!['admin','medico'].includes(req.user.role) && p.userId !== req.user.id) {
      return reply.code(403).send({ error: 'No autorizado.' });
    }
    await logAudit(req, 'ver_ficha_paciente', { targetType: 'patient', targetId: p.id });
    return fmtPatient(p);
  });

  // Alta de un paciente (User + Patient). Contraseña temporal FUERTE si no se indica (antes: "nusal" + 4 cifras)
  async function createPatientRecord(b) {
    const fullName = String(b.fullName || '').trim().slice(0, 120);
    const email = String(b.email || '').toLowerCase().trim();
    if (!fullName || !email) throw Object.assign(new Error('Nombre y email son obligatorios.'), { code: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw Object.assign(new Error('Email no válido.'), { code: 400 });
    if (b.password && String(b.password).length < 8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres.'), { code: 400 });
    const pw = b.password || crypto.randomBytes(9).toString('base64url');
    const num = (v, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
    const alta = b.altaDate ? new Date(b.altaDate) : null;
    const user = await prisma.user.create({
      data: {
        email, passwordHash: await bcrypt.hash(pw, 12), role: 'patient', fullName, clinicId: b.clinicId || null,
        patient: { create: {
          heightCm: num(b.heightCm, 50, 250), startWeight: num(b.startWeight, 20, 400),
          currentWeight: num(b.currentWeight, 20, 400) ?? num(b.startWeight, 20, 400), targetWeight: num(b.targetWeight, 20, 400),
          dni: b.dni ? String(b.dni).slice(0, 20) : null, phone: b.phone ? String(b.phone).slice(0, 30) : null,
          sex: b.sex ? String(b.sex).slice(0, 20) : null, birthDate: b.birthDate && !isNaN(new Date(b.birthDate)) ? new Date(b.birthDate) : null,
          dietWeeks: b.dietWeeks || null, clinicId: b.clinicId || null,
          ...(alta && !isNaN(alta) && alta <= new Date() ? { createdAt: alta } : {}),
        } },
      },
      include: { patient: true },
    });
    return { patient: fmtPatient({ ...user.patient, user }), tempPassword: pw };
  }

  // Crear paciente (personal clínico)
  fastify.post('/patients', { preHandler: [fastify.requireStaff] }, async (req, reply) => {
    try { return await createPatientRecord(req.body || {}); }
    catch (e) {
      if (e.code === 'P2002') return reply.code(409).send({ error: 'Ya existe un usuario con ese email.' });
      return reply.code(e.code === 400 ? 400 : 500).send({ error: e.code === 400 ? e.message : 'No se pudo crear el paciente.' });
    }
  });

  // Importación masiva: una sola petición (máx. 500); cada paciente se crea por separado e informa de su resultado
  fastify.post('/patients/bulk', {
    preHandler: [fastify.requireStaff],
    bodyLimit: 2000000,
    schema: { body: { type: 'object', required: ['patients'], properties: { patients: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object' } } } } },
  }, async (req) => {
    const results = [];
    for (const b of req.body.patients) {
      try { const r = await createPatientRecord(b); results.push({ email: r.patient.email || b.email, ok: true, tempPassword: r.tempPassword, patient: r.patient }); }
      catch (e) { results.push({ email: b.email || '', ok: false, error: e.code === 'P2002' ? 'Ya existe un usuario con ese email.' : (e.code === 400 ? e.message : 'Error al crear.') }); }
    }
    await logAudit(req, 'pacientes_importados', { detail: results.filter((r) => r.ok).length + ' de ' + results.length });
    return { created: results.filter((r) => r.ok).length, results };
  });

  // Actualizar ficha (admin)
  fastify.patch('/patients/:id', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', additionalProperties: false, properties: { heightCm: { type: ['number', 'null'], minimum: 50, maximum: 250 }, startWeight: { type: ['number', 'null'], minimum: 20, maximum: 400 }, currentWeight: { type: ['number', 'null'], minimum: 20, maximum: 400 }, targetWeight: { type: ['number', 'null'], minimum: 20, maximum: 400 }, activityLevel: { type: ['number', 'null'], minimum: 1, maximum: 2.5 }, goal: { type: ['string', 'null'], maxLength: 80 }, sex: { type: ['string', 'null'], maxLength: 20 }, dietType: { type: ['string', 'null'], maxLength: 40 }, trafficLight: { type: ['string', 'null'], maxLength: 12 }, birthDate: { type: ['string', 'null'], maxLength: 30 }, allergies: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } }, dislikes: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } }, dni: { type: ['string', 'null'], maxLength: 20 }, phone: { type: ['string', 'null'], maxLength: 30 }, dietWeeks: { type: ['integer', 'null'], minimum: 0, maximum: 104 }, paid: { type: 'boolean' }, amountPaid: { type: ['number', 'null'], minimum: 0, maximum: 100000 }, nextAppt: { type: ['string', 'null'], maxLength: 60 }, isActive: { type: 'boolean' }, medicacion: { type: 'array', maxItems: 60, items: { type: 'string', maxLength: 80 } } } } } }, async (req) => {
    const data = {};
    for (const k of ['heightCm', 'startWeight', 'currentWeight', 'targetWeight', 'activityLevel', 'goal', 'sex', 'dietType', 'trafficLight', 'birthDate', 'allergies', 'dislikes', 'dni', 'phone', 'dietWeeks', 'paid', 'amountPaid', 'nextAppt', 'isActive', 'medicacion']) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }
    if (data.birthDate) data.birthDate = new Date(data.birthDate);
    const p = await prisma.patient.update({ where: { id: req.params.id }, data, include: { user: true, weights: true, questions: true, assignments: { where: { isCurrent: true }, orderBy: { startDate: 'desc' }, take: 1, select: { weeklyDietId: true } } } });
    await logAudit(req, 'editar_ficha_paciente', { targetType: 'patient', targetId: req.params.id });
    return fmtPatient(p);
  });

  // Borrar (admin)
  fastify.delete('/patients/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    await prisma.patient.update({ where: { id: req.params.id }, data: { isActive: false } });
    return { ok: true };
  });

  // Registrar peso (admin)
  fastify.post('/patients/:id/weights', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', required: ['weight'], additionalProperties: false, properties: { weight: { type: 'number', minimum: 20, maximum: 400 } } } } }, async (req, reply) => {
    const { weight } = req.body || {};
    if (!weight) return reply.code(400).send({ error: 'weight requerido.' });
    await prisma.weightRecord.create({ data: { patientId: req.params.id, weight: parseFloat(weight) } });
    await prisma.patient.update({ where: { id: req.params.id }, data: { currentWeight: parseFloat(weight) } });
    await logAudit(req, 'registrar_peso', { targetType: 'patient', targetId: req.params.id });
    return { ok: true };
  });

  // Añadir nota privada (admin)
  fastify.post('/patients/:id/notes', { preHandler: [fastify.requireStaff], schema: { body: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 5000 } } } } }, async (req) => {
    const note = await prisma.privateNote.create({ data: { patientId: req.params.id, text: encStr(req.body.text) } });
    return note;
  });
}

function fmtPatient(p) {
  return {
    id: p.id,
    consentAccepted: p.consentAccepted,
    preferredStore: p.preferredStore,
    nm: p.user?.fullName,
    email: p.user?.email,
    li: p.trafficLight,
    h: p.heightCm,
    sw: p.startWeight,
    w: p.currentWeight,
    tg: p.targetWeight,
    sex: p.sex,
    dni: p.dni,
    phone: p.phone,
    birth: p.birthDate ? p.birthDate.toISOString().slice(0, 10) : null,
    dietWeeks: p.dietWeeks,
    paid: p.paid,
    amount: p.amountPaid,
    nextAppt: p.nextAppt,
    active: p.isActive,
    medicacion: p.medicacion || [],
    mealsDone: p.mealsDone || {},
    water: (p.waterDate === new Date().toISOString().slice(0, 10)) ? (p.waterToday || 0) : 0,
    activityLevel: p.activityLevel,
    goal: p.goal,
    allergies: p.allergies || [],
    dislikes: p.dislikes || [],
    dietType: p.dietType,
    weights: (p.weights || []).map((w) => ({ d: new Date(w.recordedAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), v: w.weight })),
    notes: (p.notes || []).map((n) => ({ dt: new Date(n.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), tx: decStr(n.text) })),
    questions: (p.questions || []).map((q) => ({ id: q.id, tx: q.text, ans: q.isAnswered, rp: q.replies?.[0]?.text || null, dt: new Date(q.createdAt).toLocaleDateString('es-ES') })),
    pq: (p.questions || []).filter((q) => !q.isAnswered).length,
    dietId: p.assignments?.[0]?.weeklyDietId || null,   // dieta asignada actualmente
    createdAt: p.createdAt,                              // día del alta (panel de pacientes)
  };
}
