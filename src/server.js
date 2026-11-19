// ================================================================
// NUSAL — Servidor propio (opcional). En Netlify NO se usa: allí la API
// corre como función (netlify/functions/api.mjs) y las tareas periódicas
// como funciones programadas. Útil para desarrollo local o un VPS.
// ================================================================
import { buildApp, configProblems } from './app.js';
import { startReminderScheduler } from './services/reminders.js';
import { startMaintenance } from './services/backup.js';

const faltan = configProblems();
if (faltan.length) {
  console.error('❌ Configuración incompleta. Falta: ' + faltan.join(', '));
  process.exit(1);
}

const fastify = await buildApp();
startReminderScheduler(fastify);
startMaintenance(fastify);

const port = process.env.PORT || 3000;
try {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 NUSAL backend en puerto ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
