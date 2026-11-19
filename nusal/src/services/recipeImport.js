// ================================================================
// Importar recetas desde una web (idea de Mealie).
// Lee los datos estructurados schema.org/Recipe que publican casi todas las webs de recetas.
// Seguridad (anti-SSRF): solo http/https en puertos 80/443, sin credenciales en la URL, y la IP real
// se valida EN EL MOMENTO DE CONECTAR (también tras cada redirección), así que no se puede usar
// para llegar a la red interna del servidor, a la base de datos ni a los metadatos de la nube.
// ================================================================
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('Dirección no permitida'));
    if (opts && opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}
export function fetchPage(url, { maxBytes = 2_000_000, timeout = 8000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('Dirección no válida')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('Solo se admiten direcciones web (http o https)'));
    if ((u.port && !['80', '443'].includes(u.port)) || u.username || u.password) return reject(new Error('Dirección no permitida'));
    // Una IP escrita directamente no pasa por la consulta DNS: se valida aquí (si no, se saltaría la protección)
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) return reject(new Error('Dirección no permitida'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout, headers: { 'User-Agent': 'Mozilla/5.0 (NUSAL importador de recetas)', Accept: 'text/html,application/xhtml+xml' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Demasiadas redirecciones'));
        return resolve(fetchPage(new URL(res.headers.location, u).toString(), { maxBytes, timeout, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('La web respondió con un error (' + res.statusCode + ')')); }
      if (!/text\/html|application\/xhtml/.test(String(res.headers['content-type'] || ''))) { res.resume(); return reject(new Error('Esa dirección no es una página web')); }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(); reject(new Error('La página es demasiado grande')); } else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('La web tarda demasiado en responder')));
    req.on('error', (e) => reject(e));
  });
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const minutes = (d) => { const m = String(d || '').match(/P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i); return m ? (+(m[1] || 0)) * 60 + (+(m[2] || 0)) : 0; };

export function parseRecipeFromHtml(html, url) {
  const found = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = [].concat(n['@type'] || []);
    if (t.some((x) => String(x).toLowerCase() === 'recipe')) found.push(n);
    if (n['@graph']) visit(n['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { try { visit(JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, ' '))); } catch {} }
  }
  const r = found[0]; if (!r) return null;
  const steps = [];
  const add = (x) => {
    if (!x) return;
    if (typeof x === 'string') return x.split(/\n+/).map(clean).filter(Boolean).forEach((s) => steps.push(s));
    if (Array.isArray(x)) return x.forEach(add);
    if (x.itemListElement) return add(x.itemListElement);
    if (x.text) steps.push(clean(x.text)); else if (x.name) steps.push(clean(x.name));
  };
  add(r.recipeInstructions);
  const y = [].concat(r.recipeYield || [])[0];
  return {
    name: clean(r.name).slice(0, 150),
    ingredients: [].concat(r.recipeIngredient || []).map(clean).filter(Boolean).slice(0, 60),
    steps: steps.filter(Boolean).slice(0, 40),
    servings: Math.min(parseInt(String(y || '').match(/\d+/)?.[0] || '0', 10) || 0, 50),
    minutes: Math.min(minutes(r.totalTime) || minutes(r.prepTime) + minutes(r.cookTime), 1440),
    kcal: Math.min(parseInt(String(r.nutrition?.calories || '').match(/\d+/)?.[0] || '0', 10) || 0, 5000),
    source: url,
  };
}
