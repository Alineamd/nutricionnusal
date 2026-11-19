// ================================================================
// Dirección de la base de datos (DATABASE_URL), preparada para Supabase
// ----------------------------------------------------------------
// Pega en DATABASE_URL la cadena "Session pooler" que da Supabase
// (botón Connect). Este módulo la completa sola:
//   · Si la cadena trae [YOUR-PASSWORD] y existe DB_PASSWORD, la inserta
//     codificada (así los símbolos de la contraseña no rompen la dirección).
//   · Supabase: conexión cifrada (sslmode=require), límite de conexiones
//     acorde al pooler y, en el puerto 6543, modo pgbouncer.
//   · Las tablas de NUSAL van en un esquema propio ("nusal"), que la API
//     pública de Supabase (Data API) NO expone. Se puede cambiar con DB_SCHEMA.
// Nunca se imprime la contraseña.
// ================================================================

const PLACEHOLDERS = ['[YOUR-PASSWORD]', '[YOUR_PASSWORD]', '[PASSWORD]', '<password>'];

export function isSupabaseHost(host = '') {
  return /(^|\.)supabase\.(co|com)$/i.test(host);
}

export function buildDatabaseUrl(env = process.env) {
  let raw = String(env.DATABASE_URL || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return '';

  if (env.DB_PASSWORD) {
    const enc = encodeURIComponent(String(env.DB_PASSWORD));
    for (const ph of PLACEHOLDERS) raw = raw.split(ph).join(enc);
  }

  let u;
  try { u = new URL(raw); } catch { return raw; } // Prisma explicará el error
  if (!/^postgres(ql)?:$/.test(u.protocol)) return raw;

  const p = u.searchParams;
  const supa = isSupabaseHost(u.hostname);
  if (supa) {
    if (!p.has('sslmode')) p.set('sslmode', 'require');
    if (u.port === '6543' && !p.has('pgbouncer')) p.set('pgbouncer', 'true');
    if (!p.has('connection_limit')) p.set('connection_limit', String(env.DB_CONNECTION_LIMIT || 5));
  }
  const schema = env.DB_SCHEMA || (supa ? 'nusal' : '');
  if (schema && !p.has('schema')) p.set('schema', schema);
  return u.toString();
}

// Resumen sin secretos, para los registros de arranque
export function describeDatabaseUrl(url) {
  try {
    const u = new URL(url);
    const schema = u.searchParams.get('schema') || 'public';
    const tipo = /pooler\.supabase\.com$/i.test(u.hostname)
      ? (u.port === '6543' ? 'Supabase · pooler (transacción)' : 'Supabase · pooler (sesión)')
      : (isSupabaseHost(u.hostname) ? 'Supabase · conexión directa' : 'PostgreSQL');
    return `${tipo} · ${u.hostname}:${u.port || 5432} · esquema "${schema}"`;
  } catch { return 'PostgreSQL'; }
}

// Avisos útiles para errores típicos de configuración
export function databaseUrlWarnings(url) {
  const out = [];
  try {
    const u = new URL(url);
    if (PLACEHOLDERS.some((ph) => decodeURIComponent(url).includes(ph))) {
      out.push('La dirección todavía contiene [YOUR-PASSWORD]: añade la variable DB_PASSWORD con la contraseña de la base de datos.');
    }
    if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(u.hostname)) {
      out.push('Usas la "Direct connection" de Supabase, que en el plan gratuito solo funciona por IPv6. Si no conecta, usa la cadena "Session pooler" (…pooler.supabase.com:5432).');
    }
    if (/pooler\.supabase\.com$/i.test(u.hostname) && u.username === 'postgres') {
      out.push('En el pooler de Supabase el usuario debe ser "postgres.<id-del-proyecto>", tal y como aparece en Connect.');
    }
  } catch { out.push('DATABASE_URL no tiene el formato postgresql://usuario:contraseña@servidor:puerto/base'); }
  return out;
}

// Configuración del controlador pg a partir de la dirección ya completada.
// · En funciones de Netlify (serverless) usa el pooler de Supabase en modo
//   "transacción" (puerto 6543), el recomendado para conexiones cortas.
//   El modo "sesión" (5432) queda para crear tablas en el despliegue.
// · Cifrado TLS siempre que la dirección lo pida (Supabase lo pide siempre).
export function runtimePoolConfig(url, { serverless = false } = {}) {
  const u = new URL(url);
  const p = u.searchParams;
  const schema = p.get('schema') || 'public';
  const sslmode = p.get('sslmode');
  const limit = parseInt(p.get('connection_limit') || '', 10);
  if (serverless && /pooler\.supabase\.com$/i.test(u.hostname) && (u.port === '5432' || u.port === '') && process.env.DB_POOL_MODE !== 'session') {
    u.port = '6543';
  }
  // Parámetros que solo entiende Prisma: fuera de la dirección que recibe pg
  for (const k of ['schema', 'pgbouncer', 'connection_limit', 'sslmode', 'sslaccept', 'pool_timeout', 'connect_timeout', 'statement_cache_size']) p.delete(k);
  const ssl = (sslmode && sslmode !== 'disable') || isSupabaseHost(u.hostname) ? { rejectUnauthorized: false } : undefined;
  return {
    schema,
    pool: {
      connectionString: u.toString(),
      ssl,
      max: serverless ? 2 : (Number.isFinite(limit) && limit > 0 ? limit : 5),
      idleTimeoutMillis: serverless ? 15000 : 30000,
      connectionTimeoutMillis: 15000,
    },
  };
}
