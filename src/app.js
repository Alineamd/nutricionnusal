import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

import { securityPlugin } from './plugins/security.js';
import { authenticate, requireAdmin, requireStaff } from './auth/auth.hooks.js';
import authRoutes from './auth/auth.routes.js';
import mealBankRoutes from './routes/mealbank.routes.js';
import recipesRoutes from './routes/recipes.routes.js';
import dietsRoutes from './routes/diets.routes.js';
import patientsRoutes from './routes/patients.routes.js';
import questionsRoutes from './routes/questions.routes.js';
import shoppingRoutes from './routes/shopping.routes.js';
import measurementsRoutes from './routes/measurements.routes.js';
import aiRoutes from './routes/ai.routes.js';
import costsRoutes from './routes/costs.routes.js';
import consentRoutes from './routes/consent.routes.js';
import auditRoutes from './routes/audit.routes.js';
import pushRoutes from './routes/push.routes.js';
import storeCatalogRoutes from './routes/storeCatalog.routes.js';
import preferencesRoutes from './routes/preferences.routes.js';
import appointmentsRoutes from './routes/appointments.routes.js';
import alimentosRoutes from './routes/alimentos.routes.js';
import farmacosRoutes from './routes/farmacos.routes.js';
import chatRoutes from './routes/chat.routes.js';
import gdprRoutes from './routes/gdpr.routes.js';
import clinicalRoutes from './routes/clinical.routes.js';
import backupRoutes from './routes/backup.routes.js';
import usageRoutes from './routes/usage.routes.js';
import recipeImportRoutes from './routes/recipeImport.routes.js';
import engagementRoutes from './routes/engagement.routes.js';
import { prisma } from './db.js';

// ================================================================
// NUSAL — Aplicación (todas las rutas de la API)
// Se usa de dos formas:
//   · En Netlify: netlify/functions/api.mjs la ejecuta en cada petición a /api/*
//   · En un servidor propio: src/server.js la arranca con listen()
// ================================================================

// Comprobación de la configuración: devuelve lo que falte (sin valores, solo nombres)
export function configProblems(env = process.env) {
  const faltan = [];
  if (!env.DATABASE_URL) faltan.push('DATABASE_URL');
  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 24) faltan.push('JWT_SECRET (24+ caracteres)');
    if (!env.FIELD_ENCRYPTION_KEY || env.FIELD_ENCRYPTION_KEY.length < 24) faltan.push('FIELD_ENCRYPTION_KEY (24+ caracteres)');
  }
  return faltan;
}

// Orígenes permitidos (CORS). En Netlify la app y la API comparten dominio y no hace falta;
// se mantiene para servidores propios o dominios adicionales (CORS_ORIGIN, separados por comas).
const DEFAULT_ORIGIN = 'https://nusal-app.netlify.app';
function corsOrigins() {
  const extra = [process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean);
  return [...new Set(String(process.env.CORS_ORIGIN || DEFAULT_ORIGIN).split(',').concat(extra)
    .map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean))];
}

export async function buildApp({ serverless = false } = {}) {
  const origins = corsOrigins();
  const fastify = Fastify({
    // En Netlify cada petición genera su propio registro: solo avisos y errores
    logger: serverless ? { level: 'warn' } : true,
    bodyLimit: 1 * 1024 * 1024, // 1 MB máximo por petición (anti payload gigante)
    // Detrás de un proxy (servidor propio) la IP real llega en x-forwarded-for.
    // En Netlify la IP la da la plataforma (context.ip), nunca una cabecera que pueda falsearse.
    trustProxy: !serverless,
  });

  await fastify.register(cors, {
    origin: origins,
    // @fastify/cors 10+ solo permite GET/HEAD/POST por defecto: sin esto el navegador bloquearía
    // guardar la historia clínica (PUT), editar fichas (PATCH) o borrar (DELETE).
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 600,
  });

  await fastify.register(jwt, { secret: process.env.JWT_SECRET || 'solo-desarrollo-local' });

  // Aduana perimetral: cabeceras + rate limiting + bloqueo login
  await securityPlugin(fastify); // directo = hooks globales

  fastify.decorate('authenticate', authenticate);
  fastify.decorate('requireAdmin', requireAdmin);
  fastify.decorate('requireStaff', requireStaff);

  // Cabeceras de seguridad en TODAS las respuestas (protección de datos de salud)
  fastify.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');          // sin adivinación de tipos
    reply.header('X-Frame-Options', 'DENY');                    // no incrustable (clickjacking)
    reply.header('Referrer-Policy', 'no-referrer');             // no filtrar URLs a terceros
    reply.header('Cache-Control', 'no-store');                  // datos clínicos NUNCA en cachés
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // HTTPS siempre
    }
    return payload;
  });

  // Manejador de errores que NO filtra detalles internos
  fastify.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'Datos de entrada no válidos.', detalle: err.message });
    }
    req.log.error(err);
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(code).send({ error: code === 500 ? 'Error interno.' : err.message });
  });

  // Estado del servicio y de la conexión con la base de datos (sin detalles internos)
  fastify.get('/health', async (req, reply) => {
    let db = 'ok';
    try { await prisma.$queryRaw`SELECT 1`; } catch { db = 'error'; }
    if (db !== 'ok') reply.code(503);
    return { status: db === 'ok' ? 'ok' : 'degraded', db, service: 'nusal-backend' };
  });
  fastify.get('/', async () => ({ name: 'NUSAL API', version: '2.0.0' }));

  await fastify.register(authRoutes);
  await fastify.register(mealBankRoutes);
  await fastify.register(recipesRoutes);
  await fastify.register(dietsRoutes);
  await fastify.register(patientsRoutes);
  await fastify.register(questionsRoutes);
  await fastify.register(shoppingRoutes);
  await fastify.register(measurementsRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(costsRoutes);
  await fastify.register(consentRoutes);
  await fastify.register(auditRoutes);
  await fastify.register(pushRoutes);
  await fastify.register(storeCatalogRoutes);
  await fastify.register(preferencesRoutes);
  await fastify.register(appointmentsRoutes);
  await fastify.register(alimentosRoutes);
  await fastify.register(farmacosRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(gdprRoutes);
  await fastify.register(clinicalRoutes);
  await fastify.register(backupRoutes);
  await fastify.register(usageRoutes);
  await fastify.register(recipeImportRoutes);
  await fastify.register(engagementRoutes);

  await fastify.ready();
  return fastify;
}
