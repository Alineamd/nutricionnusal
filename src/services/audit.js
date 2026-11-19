// ================================================================
// REGISTRO DE AUDITORÍA
// Deja rastro de quién accede o modifica datos sensibles.
// No lanza si falla (la auditoría no debe tumbar la app).
// ================================================================

import { prisma } from '../db.js';

export async function logAudit(req, action, { targetType, targetId, detail } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        ip: req.ip || null,
        detail: detail || null,
      },
    });
  } catch (e) { /* silencioso */ }
}

export async function auditFeed({ limit = 100 } = {}) {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  // Enriquecer con nombre de usuario
  const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
  const map = Object.fromEntries(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    fecha: r.createdAt,
    usuario: map[r.userId]?.fullName || r.userRole || 'sistema',
    rol: r.userRole,
    accion: r.action,
    objetivo: r.targetType ? `${r.targetType}${r.targetId ? ':' + r.targetId.slice(0, 8) : ''}` : null,
    ip: r.ip,
    detalle: r.detail,
  }));
}
