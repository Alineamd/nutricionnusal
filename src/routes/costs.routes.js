import { costSummary } from '../services/costs.js';

export default async function costsRoutes(fastify) {
  // Panel de costes operativos (solo admin)
  fastify.get('/admin/costs', { preHandler: [fastify.requireAdmin] }, async () => {
    return costSummary();
  });
}
