// ================================================================
// Conexión a la base de datos: Prisma con su motor WebAssembly + controlador pg.
// No necesita binarios nativos, así funciona igual en Netlify Functions,
// en un servidor propio y en local.
// ================================================================
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import prismaWasm from '@prisma/client/wasm';
import { buildDatabaseUrl, runtimePoolConfig } from './config/database-url.js';

const { PrismaClient } = prismaWasm;
const url = buildDatabaseUrl();
if (url) process.env.DATABASE_URL = url; // la usa también la herramienta de Prisma (crear tablas)

let pool = null;
function create() {
  const cfg = runtimePoolConfig(url, { serverless: process.env.NUSAL_SERVERLESS === '1' });
  const p = new pg.Pool(cfg.pool);
  // Una conexión inactiva que el servidor cierra no debe tumbar el proceso
  p.on('error', (e) => console.warn('Conexión de base de datos cerrada:', e.message));
  pool = p;
  return new PrismaClient({ adapter: new PrismaPg(p, { schema: cfg.schema }), log: ['error'] });
}

const missing = new Proxy({}, { get() { throw new Error('Falta DATABASE_URL'); } });

// `prisma` es un enlace vivo: si se renueva la conexión, todos los módulos ven la nueva
export let prisma = url ? create() : missing;

// En Netlify la instancia se congela entre peticiones. Si lleva un rato parada,
// se abre una conexión nueva en vez de reutilizar una que el pooler pudo cerrar.
let lastUse = 0;
let closed = false;
export function refreshIfIdle(maxIdleMs = 45000) {
  const now = Date.now();
  if (url && (closed || (lastUse && now - lastUse > maxIdleMs))) {
    closed = false;
    const old = pool;
    prisma = create();
    if (old) old.end().catch(() => {});
  }
  lastUse = now;
}

export async function closeDb() {
  try { await prisma.$disconnect(); } catch {}
  try { if (pool) await pool.end(); } catch {}
  pool = null;
  closed = true;
}
