import { prisma } from '../db.js';

// Uso de la app a partir de datos propios (auditoría y tablas), sin cookies ni servicios de terceros.
export default async function usageRoutes(fastify) {
  fastify.get('/admin/usage', { preHandler: [fastify.requireAdmin] }, async () => {
    const DAY = 86400000; const now = Date.now();
    const since30 = new Date(now - 30 * DAY), since14 = new Date(now - 14 * DAY);
    const logins = await prisma.auditLog.findMany({ where: { action: 'login_ok', createdAt: { gte: since30 } }, select: { userId: true, createdAt: true } });
    const perDay = {};
    for (let i = 13; i >= 0; i--) perDay[new Date(now - i * DAY).toISOString().slice(0, 10)] = 0;
    logins.filter((l) => l.createdAt >= since14).forEach((l) => { const d = l.createdAt.toISOString().slice(0, 10); if (d in perDay) perDay[d]++; });
    const activos30 = new Set(logins.map((l) => l.userId).filter(Boolean)).size;
    const activos7 = new Set(logins.filter((l) => l.createdAt >= new Date(now - 7 * DAY)).map((l) => l.userId).filter(Boolean)).size;
    const [pacientes, dietas, mensajes30, citas30, pesajes30] = await Promise.all([
      prisma.patient.count({ where: { isActive: true } }),
      prisma.weeklyDiet.count(),
      prisma.mensaje.count({ where: { createdAt: { gte: since30 } } }),
      prisma.appointment.count({ where: { createdAt: { gte: since30 } } }),
      prisma.weightRecord.count({ where: { recordedAt: { gte: since30 } } }),
    ]);
    return { activos7, activos30, pacientes, dietas, mensajes30, citas30, pesajes30, accesosPorDia: Object.entries(perDay).map(([dia, n]) => ({ dia, n })) };
  });
}
