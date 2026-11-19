// ================================================================
// ADUANA DE ENTRADA — Capa de seguridad perimetral
//  - Cabeceras de seguridad (tipo helmet)
//  - Rate limiting global + estricto en login (anti fuerza bruta)
//  - Límite de tamaño de payload
//  - Bloqueo temporal por IP tras intentos fallidos de login
// ================================================================

import crypto from 'crypto';

// ── Límites de intentos ──
// En un servidor único bastaría con memoria. En Netlify cada petición puede caer en
// una instancia distinta, así que los contadores se guardan en la base de datos
// (tabla RateLimit). La clave se guarda como hash: ni IPs ni correos en claro.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000; // 15 minutos
const useDb = () => process.env.NUSAL_SERVERLESS === '1' || process.env.RATE_LIMIT_STORE === 'db';
const hk = (k) => crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 48);
let dbMod = null;
async function db() { if (!dbMod) dbMod = await import('../db.js'); return dbMod.prisma; }

const loginAttempts = new Map(); // memoria: ip -> { count, blockedUntil }
const buckets = new Map();       // memoria: clave -> [instantes]

export async function loginGate(ip) {
  if (useDb()) {
    const row = await (await db()).rateLimit.findUnique({ where: { key: 'login:' + hk(ip) } });
    if (row && row.blockedUntil && row.blockedUntil.getTime() > Date.now()) {
      return { blocked: true, minutes: Math.ceil((row.blockedUntil.getTime() - Date.now()) / 60000) };
    }
    return { blocked: false };
  }
  const rec = loginAttempts.get(ip);
  if (rec && rec.blockedUntil && Date.now() < rec.blockedUntil) {
    return { blocked: true, minutes: Math.ceil((rec.blockedUntil - Date.now()) / 60000) };
  }
  return { blocked: false };
}

export async function registerLoginFailure(ip) {
  if (useDb()) {
    const p = await db(); const key = 'login:' + hk(ip); const now = new Date();
    const row = await p.rateLimit.upsert({ where: { key }, create: { key, count: 1, windowStart: now }, update: { count: { increment: 1 } } });
    if (row.count >= LOGIN_MAX_ATTEMPTS) {
      await p.rateLimit.update({ where: { key }, data: { count: 0, windowStart: now, blockedUntil: new Date(Date.now() + LOGIN_BLOCK_MS) } });
    }
    return;
  }
  const rec = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) { rec.blockedUntil = Date.now() + LOGIN_BLOCK_MS; rec.count = 0; }
  loginAttempts.set(ip, rec);
}

export async function registerLoginSuccess(ip) {
  if (useDb()) { await (await db()).rateLimit.deleteMany({ where: { key: 'login:' + hk(ip) } }); return; }
  loginAttempts.delete(ip);
}

// Limitador genérico por clave (IP, email, usuario…): true = se ha superado el límite
export async function hitLimit(key, max, windowMs) {
  if (useDb()) {
    const p = await db(); const k = 'rl:' + hk(key); const now = new Date();
    const row = await p.rateLimit.upsert({ where: { key: k }, create: { key: k, count: 1, windowStart: now }, update: { count: { increment: 1 } } });
    if (now.getTime() - row.windowStart.getTime() > windowMs) {
      await p.rateLimit.update({ where: { key: k }, data: { count: 1, windowStart: now } });
      return false;
    }
    return row.count > max;
  }
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return true; }
  arr.push(now); buckets.set(key, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, arr] of buckets) { if (!arr.some((t) => now - t < 24 * 3600 * 1000)) buckets.delete(k); } }, 10 * 60 * 1000).unref();

// Limpieza de contadores caducados (la llama el mantenimiento diario)
export async function cleanupRateLimits() {
  if (!useDb()) return 0;
  const r = await (await db()).rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - 2 * 24 * 3600 * 1000) }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] },
  });
  return r.count;
}

// Rate limiter global simple en memoria (por IP, ventana deslizante)
const windows = new Map(); // ip -> [timestamps]
const GLOBAL_MAX = 120;      // 120 req/min por IP
const WINDOW_MS = 60 * 1000;

export async function securityPlugin(fastify) {
  // Cabeceras de seguridad en todas las respuestas
  fastify.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-XSS-Protection', '0');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');       // la API nunca debe aparecer en buscadores
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    return payload;
  });

  // Forzar HTTPS en producción en un servidor propio (el proxy avisa con x-forwarded-proto).
  // En Netlify no hace falta: la plataforma sirve siempre por HTTPS (y HSTS) antes de llegar aquí.
  fastify.addHook('onRequest', async (req, reply) => {
    if (process.env.NODE_ENV === 'production' && process.env.NUSAL_SERVERLESS !== '1' && req.headers['x-forwarded-proto'] === 'http') {
      return reply.redirect('https://' + req.headers.host + req.url, 301);
    }
  });

  // 404 propio: mensaje en español y sin revelar rutas ni el framework
  fastify.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'No encontrado.' }));

  // Rate limit global
  fastify.addHook('onRequest', async (req, reply) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const arr = (windows.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    arr.push(now);
    windows.set(ip, arr);
    if (arr.length > GLOBAL_MAX) {
      return reply.code(429).send({ error: 'Demasiadas peticiones. Espera un momento.' });
    }
  });

  // Limpieza periódica de memoria
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of windows) {
      const alive = arr.filter((t) => now - t < WINDOW_MS);
      if (alive.length === 0) windows.delete(ip); else windows.set(ip, alive);
    }
    for (const [ip, rec] of loginAttempts) {
      if (rec.blockedUntil && now > rec.blockedUntil && rec.count === 0) loginAttempts.delete(ip);
    }
  }, 60_000).unref();
}
