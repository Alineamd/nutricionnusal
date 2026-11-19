import { auditFeed } from '../services/audit.js';

export default async function auditRoutes(fastify) {
  fastify.get('/admin/audit', { preHandler: [fastify.requireAdmin] }, async (req) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 300);
    return { registros: await auditFeed({ limit }) };
  });
}
