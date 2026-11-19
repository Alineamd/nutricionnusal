// ================================================================
// NUSAL · API como función de Netlify
// Todas las peticiones a https://<tu-web>/api/* llegan aquí y las atiende
// la misma aplicación Fastify de siempre (src/app.js).
// ================================================================
let appPromise = null;

export default async (req, context) => {
  // Antes de cargar nada: modo Netlify (pooler en modo transacción, límites y copias compartidos)
  process.env.NUSAL_SERVERLESS = '1';
  process.env.API_BASE_PATH = '/api';

  const { buildApp, configProblems } = await import('../../src/app.js');
  const faltan = configProblems();
  if (faltan.length) {
    console.error('NUSAL: configuración incompleta. Falta: ' + faltan.join(', '));
    return Response.json({ status: 'error', error: 'El servidor no está configurado todavía.', faltan },
      { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const db = await import('../../src/db.js');
  db.refreshIfIdle();
  if (!appPromise) appPromise = buildApp({ serverless: true });
  let app;
  try { app = await appPromise; }
  catch (e) { appPromise = null; console.error(e); return Response.json({ error: 'Error interno.' }, { status: 500 }); }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  const method = req.method.toUpperCase();
  const payload = method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer());
  const headers = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  const res = await app.inject({
    method, url: path + url.search, headers, payload,
    remoteAddress: (context && context.ip) || '0.0.0.0', // IP real que da Netlify (no falsificable)
  });

  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || v === null) continue;
    if (['content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(k)) continue;
    if (Array.isArray(v)) v.forEach((x) => out.append(k, String(x))); else out.set(k, String(v));
  }
  const noBody = method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304;
  return new Response(noBody ? null : res.rawPayload, { status: res.statusCode, headers: out });
};

export const config = { path: '/api/*' };
