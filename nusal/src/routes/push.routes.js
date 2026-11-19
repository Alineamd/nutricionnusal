import { getVapidPublicKey, savePushSubscription } from '../services/notifications.js';

export default async function pushRoutes(fastify) {
  // Clave pública VAPID (el frontend la necesita para suscribirse)
  fastify.get('/push/vapid', async () => ({ publicKey: getVapidPublicKey() }));

  // Guardar la suscripción del dispositivo del usuario logueado
  fastify.post('/push/subscribe', { preHandler: [fastify.authenticate], schema: { body: { type: 'object', required: ['subscription'], additionalProperties: false, properties: { subscription: { type: 'object', required: ['endpoint', 'keys'], properties: { endpoint: { type: 'string', maxLength: 1000, pattern: '^https://' }, expirationTime: { type: ['number', 'null'] }, keys: { type: 'object', required: ['p256dh', 'auth'], properties: { p256dh: { type: 'string', maxLength: 200 }, auth: { type: 'string', maxLength: 100 } } } } } } } } }, async (req, reply) => {
    const ok = await savePushSubscription(req.user.id, req.body?.subscription);
    if (!ok) return reply.code(400).send({ error: 'Suscripción no válida.' });
    return { ok: true };
  });
}
