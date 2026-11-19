import { prisma } from '../db.js';
import { calcTargetKcal, generateWeeklyDiet } from '../services/dietEngine.js';
import { generateDietWithAI, generateRecipeWithAI, extractDietFromTextWithAI } from '../services/claude.js';
import { tribunalDiet, tribunalRecipe } from '../services/guardrails.js';
import { logAiUsage } from '../services/costs.js';

function ageFrom(birthDate) {
  if (!birthDate) return 40;
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000));
}


const IMP_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const IMP_MEALS = ['Desayuno', 'Media mañana', 'Comida', 'Merienda', 'Cena'];
// Deja solo días/comidas válidos y tipos seguros (la IA nunca escribe fuera del esquema)
function normalizeImportedDiet(raw) {
  const weeks = Array.isArray(raw?.weeks) ? raw.weeks.slice(0, 8) : [];
  const out = weeks.map((w) => {
    const days = {};
    IMP_DAYS.forEach((d) => {
      days[d] = {};
      IMP_MEALS.forEach((m) => {
        const x = w && w[d] && w[d][m];
        if (!x || typeof x.name !== 'string' || !x.name.trim()) return;
        const cal = Number.isFinite(Number(x.cal)) && Number(x.cal) > 0 && Number(x.cal) < 3000 ? Math.round(Number(x.cal)) : 0;
        const ingredients = Array.isArray(x.ingredients) ? x.ingredients.filter((i) => typeof i === 'string').map((i) => i.trim().slice(0, 60)).filter(Boolean).slice(0, 12) : [];
        days[d][m] = { name: x.name.trim().slice(0, 200), cal, ingredients };
      });
    });
    return days;
  }).filter((w) => Object.values(w).some((d) => Object.keys(d).length));
  return { name: typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : '', weeks: out };
}

// Sin clave de IA no se intenta nada (la app usa entonces su motor propio); así no se registran errores como coste
async function requireAI(req, reply) {
  if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'La IA no está configurada en el servidor.', ia: false });
}

export default async function aiRoutes(fastify) {
  // ── Motor por reglas (sin coste de IA) ──
  fastify.post('/ai/diet/rules', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', properties: {
      patientId: { type: 'string', maxLength: 64 },
      targetKcal: { type: 'integer', minimum: 800, maximum: 5000 },
    }, additionalProperties: false } },
  }, async (req) => {
    const { patientId, targetKcal } = req.body || {};
    const patient = patientId ? await prisma.patient.findUnique({ where: { id: patientId } }) : null;
    let kcal = targetKcal;
    if (!kcal && patient?.currentWeight && patient?.heightCm) {
      kcal = calcTargetKcal({ sex: patient.sex || 'F', weightKg: patient.currentWeight, heightCm: patient.heightCm, age: ageFrom(patient.birthDate), activityLevel: patient.activityLevel || 1.2, goal: patient.goal || 'perder' });
    }
    kcal = kcal || 2000;
    const mealBank = await prisma.mealBank.findMany();
    return generateWeeklyDiet({ mealBank, patient: { allergies: patient?.allergies || [], dislikes: patient?.dislikes || [] }, targetKcal: kcal });
  });

  // ── Dieta con IA: Tribunal + coste + 1 reintento si es condenada ──
  fastify.post('/ai/diet/generate', {
    preHandler: [fastify.requireStaff, requireAI],
    schema: { body: { type: 'object', properties: {
      patientId: { type: 'string', maxLength: 64 },
      targetKcal: { type: 'integer', minimum: 800, maximum: 5000 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const { patientId, targetKcal } = req.body || {};
    const patient = patientId ? await prisma.patient.findUnique({ where: { id: patientId } }) : {};
    const mealBank = await prisma.mealBank.findMany();
    let kcal = targetKcal;
    if (!kcal && patient?.currentWeight && patient?.heightCm) {
      kcal = calcTargetKcal({ sex: patient.sex || 'F', weightKg: patient.currentWeight, heightCm: patient.heightCm, age: ageFrom(patient.birthDate), activityLevel: patient.activityLevel || 1.2, goal: patient.goal || 'perder' });
    }
    kcal = kcal || 2000;

    const MAX_TRIES = 2;
    let lastVerdict = null;
    for (let i = 1; i <= MAX_TRIES; i++) {
      const t0 = Date.now();
      try {
        const { diet, usage, model } = await generateDietWithAI({ patient: patient || {}, targetKcal: kcal, mealBank });
        const verdict = tribunalDiet(diet, { targetKcal: kcal, patient });
        const costUsd = await logAiUsage({ endpoint: '/ai/diet/generate', model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, latencyMs: Date.now() - t0, approved: verdict.approved });
        if (verdict.approved) {
          return { targetKcal: kcal, ...diet, _meta: { costeUsd: Math.round(costUsd * 10000) / 10000, intento: i, tribunal: 'aprobada' } };
        }
        lastVerdict = verdict;
        fastify.log.warn({ verdict }, `Tribunal condenó la dieta (intento ${i})`);
      } catch (err) {
        fastify.log.error(err);
        await logAiUsage({ endpoint: '/ai/diet/generate', model: 'error', inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, approved: false });
        if (i === MAX_TRIES) return reply.code(502).send({ error: 'La IA no pudo generar la dieta.', detail: err.message });
      }
    }
    return reply.code(422).send({ error: 'El Tribunal de Guardrails rechazó la dieta generada.', juez: lastVerdict?.judge, violaciones: lastVerdict?.violations });
  });

  // ── Receta con IA: Tribunal + coste ──
  fastify.post('/ai/recipe/generate', {
    preHandler: [fastify.requireStaff, requireAI],
    schema: { body: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', minLength: 2, maxLength: 120 },
      patientId: { type: 'string', maxLength: 64 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const { query, patientId } = req.body;
    const patient = patientId ? await prisma.patient.findUnique({ where: { id: patientId } }) : null;
    const t0 = Date.now();
    try {
      const { recipe, usage, model } = await generateRecipeWithAI({ query, patient });
      const verdict = tribunalRecipe(recipe, { patient });
      const costUsd = await logAiUsage({ endpoint: '/ai/recipe/generate', model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, latencyMs: Date.now() - t0, approved: verdict.approved });
      if (!verdict.approved) {
        return reply.code(422).send({ error: 'El Tribunal rechazó la receta.', violaciones: verdict.violations });
      }
      return { ...recipe, _meta: { costeUsd: Math.round(costUsd * 10000) / 10000, tribunal: 'aprobada' } };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(502).send({ error: 'La IA no pudo generar la receta.', detail: err.message });
    }
  });

  // ── Importar una dieta desde el texto de un PDF / Word / Excel ──
  fastify.post('/ai/diet/import', {
    preHandler: [fastify.requireStaff, requireAI],
    schema: { body: { type: 'object', required: ['text'], properties: {
      text: { type: 'string', minLength: 20, maxLength: 60000 },
      fileName: { type: 'string', maxLength: 200 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const t0 = Date.now();
    try {
      const { diet, usage, model } = await extractDietFromTextWithAI({ text: req.body.text, fileName: req.body.fileName || '' });
      const clean = normalizeImportedDiet(diet);
      const costUsd = await logAiUsage({ endpoint: '/ai/diet/import', model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, latencyMs: Date.now() - t0 });
      if (!clean.weeks.length) return reply.code(422).send({ error: 'No se encontró ninguna dieta en el documento.' });
      return { ...clean, _meta: { costeUsd: Math.round(costUsd * 10000) / 10000, motor: 'ia' } };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(502).send({ error: 'La IA no pudo interpretar el documento.' });
    }
  });
}
