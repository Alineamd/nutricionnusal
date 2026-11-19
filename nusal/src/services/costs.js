// ================================================================
// COSTES OPERATIVOS EN TIEMPO REAL
// Cada llamada a la IA registra: tokens de entrada/salida, coste
// estimado en USD, latencia y si el Tribunal la aprobó.
// La doctora/admin puede consultar el acumulado en /admin/costs.
// ================================================================

import { prisma } from '../db.js';

// Precios por millón de tokens (USD) — ajustables por variable de entorno
const PRICING = {
  'claude-sonnet-5-5': { in: 2.00, out: 10.00 },
  'claude-opus-5-5':   { in: 4.00, out: 20.00 },
  'claude-sonnet-5':   { in: 3.00, out: 15.00 },
  'claude-opus-4-8':   { in: 15.00, out: 75.00 },
  'claude-haiku-4-5':  { in: 1.00, out: 5.00 },
  default:             { in: 3.00, out: 15.00 },
};

export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model] || PRICING.default;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

// Registra una llamada de IA (no lanza si falla la BD: el coste no debe tumbar la app)
export async function logAiUsage({ endpoint, model, inputTokens, outputTokens, latencyMs, approved }) {
  const costUsd = estimateCost(model, inputTokens || 0, outputTokens || 0);
  try {
    await prisma.aiUsage.create({
      data: {
        endpoint, model,
        inputTokens: inputTokens || 0,
        outputTokens: outputTokens || 0,
        costUsd, latencyMs: latencyMs || 0,
        approved: approved !== false,
      },
    });
  } catch (e) { /* silencioso */ }
  return costUsd;
}

// Resumen para el panel: hoy, mes, total, últimas llamadas
export async function costSummary() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [today, month, total, recent] = await Promise.all([
    prisma.aiUsage.aggregate({ _sum: { costUsd: true }, _count: true, where: { createdAt: { gte: dayStart } } }),
    prisma.aiUsage.aggregate({ _sum: { costUsd: true }, _count: true, where: { createdAt: { gte: monthStart } } }),
    prisma.aiUsage.aggregate({ _sum: { costUsd: true }, _count: true }),
    prisma.aiUsage.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);

  const r = (x) => Math.round((x || 0) * 10000) / 10000;
  return {
    hoy:   { llamadas: today._count,  costeUsd: r(today._sum.costUsd) },
    mes:   { llamadas: month._count,  costeUsd: r(month._sum.costUsd) },
    total: { llamadas: total._count,  costeUsd: r(total._sum.costUsd) },
    ultimas: recent.map((u) => ({
      fecha: u.createdAt, endpoint: u.endpoint, modelo: u.model,
      tokens: u.inputTokens + u.outputTokens, costeUsd: r(u.costUsd),
      aprobada: u.approved, latenciaMs: u.latencyMs,
    })),
  };
}
