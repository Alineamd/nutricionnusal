// ================================================================
// NUSAL — Preparación de la base de datos
// En Netlify se ejecuta en cada despliegue ("npm run build"); en un servidor
// propio, al arrancar ("npm start").
// ----------------------------------------------------------------
//  1. Crea o actualiza las tablas (prisma db push). Si un cambio fuera a
//     BORRAR datos, se detiene sin tocar nada y el despliegue no se publica.
//  2. Blindaje: activa Row Level Security en todas las tablas de NUSAL y
//     retira cualquier permiso a los roles públicos de Supabase (anon,
//     authenticated). El servidor sigue funcionando porque es el dueño.
//  3. Datos iniciales (clínica, cuentas, alimentos, fármacos...). Solo
//     crea lo que falta: nunca duplica ni cambia contraseñas.
// Uso: node src/scripts/prepare-db.js
// (NUSAL_SKIP_DB_PUSH=1 omite el paso 1: solo para pruebas locales sin el motor de esquemas)
// ================================================================
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDatabaseUrl, describeDatabaseUrl, databaseUrlWarnings } from '../config/database-url.js';
import { hardenDatabase } from '../config/harden-db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = buildDatabaseUrl();
if (!url) {
  console.error('⛔ Falta la variable DATABASE_URL (la dirección de la base de datos). En Supabase: botón Connect → "Session pooler". En Netlify: Project configuration → Environment variables.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.PRISMA_HIDE_UPDATE_MESSAGE = '1';
console.log('🗄  Base de datos:', describeDatabaseUrl(url));
for (const w of databaseUrlWarnings(url)) console.warn('⚠ ' + w);

// ── 1) Tablas ──
const prismaCli = require.resolve('prisma/build/index.js');
let pushed = process.env.NUSAL_SKIP_DB_PUSH === '1';
if (pushed) console.log('↷ Paso de tablas omitido (NUSAL_SKIP_DB_PUSH=1).');
for (let intento = 1; intento <= 3 && !pushed; intento++) {
  const r = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 180000,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.status === 0) { pushed = true; console.log('✅ Tablas al día.'); break; }
  if (/data loss|perder[aá]n datos|--accept-data-loss/i.test(out)) {
    console.error(out);
    console.error('⛔ La actualización de tablas BORRARÍA datos. No se ha tocado nada y este despliegue no se publica (la versión anterior sigue funcionando). Revisa el cambio antes de continuar.');
    process.exit(1);
  }
  console.error(out.replace(/postgres(ql)?:\/\/[^\s"']+/gi, 'postgresql://***'));
  if (/P1000|authentication failed|password authentication/i.test(out)) {
    console.error('⛔ Usuario o contraseña de la base de datos incorrectos. En Supabase puedes cambiarla en Database → Settings → Reset database password y copiarla en DB_PASSWORD.');
    process.exit(1);
  }
  if (intento < 3) { console.warn(`⏳ No se pudo conectar (intento ${intento}/3). Reintentando…`); await sleep(intento * 5000); }
}
if (!pushed) {
  console.error('⛔ No se pudo conectar con la base de datos. Comprueba DATABASE_URL (usa la cadena "Session pooler" de Supabase) y que el proyecto de Supabase no esté pausado.');
  process.exit(1);
}

// ── 2) Blindaje ──
const { prisma, closeDb } = await import('../db.js');
const { Prisma } = (await import('@prisma/client/wasm')).default;
const schema = new URL(url).searchParams.get('schema') || 'public';
try {
  const n = await hardenDatabase(prisma, Prisma, schema);
  console.log(`🔒 Blindaje aplicado: RLS activo en ${n} tablas del esquema "${schema}" y sin acceso para roles públicos.`);
} catch (e) {
  console.warn('⚠ No se pudo aplicar el blindaje RLS (el servidor arranca igualmente):', e.message);
}
await closeDb();

// ── 3) Datos iniciales ──
const seed = spawnSync(process.execPath, [path.join(root, 'src/seed.js')], { cwd: root, env: process.env, stdio: 'inherit', timeout: 300000 });
if (seed.status !== 0) {
  console.error('⛔ No se pudieron crear los datos iniciales (mira el mensaje de arriba).');
  process.exit(1);
}
console.log('✅ Base de datos lista.');
