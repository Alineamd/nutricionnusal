import { createBackup, listBackups, readBackup, encryptionEnabled, backupLocation } from '../services/backup.js';
import { logAudit } from '../services/audit.js';

export default async function backupRoutes(fastify) {
  fastify.get('/admin/backups', { preHandler: [fastify.requireAdmin] }, async () => ({
    backups: await listBackups(), dir: backupLocation(), encrypted: encryptionEnabled(),
  }));
  fastify.post('/admin/backups', { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    try {
      const b = await createBackup('manual');
      await logAudit(req, 'copia_seguridad_manual', { detail: b.name });
      return { ok: true, name: b.name, size: b.size, registros: b.meta.registros };
    } catch (e) { fastify.log.error(e); return reply.code(500).send({ error: 'No se pudo crear la copia.' }); }
  });
  fastify.get('/admin/backups/:name', { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    const buf = await readBackup(req.params.name);
    if (!buf) return reply.code(404).send({ error: 'Copia no encontrada.' });
    await logAudit(req, 'copia_seguridad_descargada', { detail: req.params.name });
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="' + req.params.name + '"');
    return reply.send(buf);
  });
}
