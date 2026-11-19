// ================================================================
// Copias de seguridad automáticas de TODA la base de datos.
// - Diarias a las 03:00 (hora de Madrid) y al arrancar si no hay ninguna reciente.
// - Comprimidas y, si existe BACKUP_KEY, cifradas con AES-256-GCM (contienen datos de salud).
// - Dónde se guardan:
//     · En Netlify: Netlify Blobs, región UE (Frankfurt), almacén privado "nusal-copias".
//       Así la copia está en un proveedor distinto de la base de datos (Supabase).
//     · En un servidor propio: carpeta BACKUP_DIR.
// ================================================================
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { purgeExpiredRecords } from '../routes/gdpr.routes.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || '/data/backups';
const KEEP = Math.max(3, parseInt(process.env.BACKUP_KEEP || '30', 10) || 30);
// Orden padres → hijos (generado a partir del esquema); la restauración lo usa tal cual
export const MODELS = ["clinic", "user", "patient", "appointment", "weightRecord", "mealBank", "recipe", "weeklyDiet", "weeklyDietMeal", "patientDietAssignment", "patientQuestion", "questionReply", "privateNote", "shoppingList", "shoppingItem", "faq", "resource", "aiUsage", "auditLog", "pushSubscription", "storeProduct", "alimento", "farmaco", "mensaje", "gdprLog", "clinicalRecord", "clinicalRecordHistory", "weeklyCheckin", "bodyMeasurement"];
const MAGIC = Buffer.from('NUSALBK1');

function key() { const k = process.env.BACKUP_KEY; return k ? crypto.scryptSync(k, 'nusal-backup-v1', 32) : null; }
export function encryptionEnabled() { return !!process.env.BACKUP_KEY; }

export function encode(obj) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
  const k = key();
  if (!k) return { buf: gz, ext: '.json.gz' };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(gz), c.final()]);
  return { buf: Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]), ext: '.json.gz.enc' };
}
export function decode(buf) {
  if (buf.subarray(0, 8).equals(MAGIC)) {
    const k = key(); if (!k) throw new Error('Esta copia está cifrada: define BACKUP_KEY para leerla.');
    const d = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(8, 20));
    d.setAuthTag(buf.subarray(20, 36));
    return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(36)), d.final()])).toString());
  }
  return JSON.parse(zlib.gunzipSync(buf).toString());
}

function stamp() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const NAME_RE = /^nusal-\d{8}-\d{6}\.json\.gz(\.enc)?$/;
const useBlobs = () => process.env.NUSAL_SERVERLESS === '1' || process.env.BACKUP_STORE === 'blobs';
export function backupLocation() {
  return useBlobs() ? 'Netlify Blobs · UE (Frankfurt)' : BACKUP_DIR;
}
async function blobStore() {
  const { getStore } = await import('@netlify/blobs');
  // La región se indica en CADA llamada: si no, Netlify usaría EE. UU. y no vería las copias
  return getStore({ name: 'nusal-copias', region: process.env.BACKUP_BLOBS_REGION || 'eu-central-1', consistency: 'strong' });
}
// "nusal-20261119-030000" (hora de Madrid) → fecha aproximada, por si falta el dato guardado
function dateFromName(n) {
  const m = n.match(/^nusal-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) : new Date(0);
}

export async function listBackups() {
  if (useBlobs()) {
    const store = await blobStore();
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.filter((b) => NAME_RE.test(b.key)).map(async (b) => {
      const meta = await store.getMetadata(b.key).catch(() => null);
      const md = (meta && meta.metadata) || {};
      return { name: b.key, size: Number(md.size) || 0, createdAt: md.createdAt ? new Date(md.createdAt) : dateFromName(b.key), encrypted: b.key.endsWith('.enc') };
    }));
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => NAME_RE.test(f))
    .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, createdAt: st.mtime, encrypted: f.endsWith('.enc') }; })
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Solo nombres con el formato exacto: impide leer cualquier otra cosa
export async function readBackup(name) {
  if (!NAME_RE.test(String(name || ''))) return null;
  if (useBlobs()) {
    const data = await (await blobStore()).get(name, { type: 'arrayBuffer' });
    return data ? Buffer.from(data) : null;
  }
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

async function saveBackup(name, buf) {
  if (useBlobs()) {
    const store = await blobStore();
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    await store.set(name, ab, { metadata: { size: buf.length, createdAt: new Date().toISOString() } });
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, name), buf, { mode: 0o600 });
}

async function deleteBackup(name) {
  if (useBlobs()) { await (await blobStore()).delete(name); return; }
  try { fs.unlinkSync(path.join(BACKUP_DIR, name)); } catch {}
}

export async function createBackup(reason = 'auto') {
  const data = {};
  for (const m of MODELS) data[m] = await prisma[m].findMany();
  const meta = { app: 'NUSAL', formato: 1, creada: new Date().toISOString(), motivo: reason, registros: Object.fromEntries(MODELS.map((m) => [m, data[m].length])) };
  const { buf, ext } = encode({ meta, data });
  const name = 'nusal-' + stamp() + ext;
  await saveBackup(name, buf);
  const old = (await listBackups()).slice(KEEP);
  for (const b of old) await deleteBackup(b.name);
  return { name, size: buf.length, meta };
}

// Una pasada de mantenimiento: copia (si la última tiene más de 20 h), purga legal y limpieza.
// En Netlify la lanza cada noche la función programada "mantenimiento".
export async function runMaintenance(log = console, { force = false } = {}) {
  const out = { copia: null, purgadas: 0, limites: 0 };
  const last = (await listBackups())[0];
  if (force || !last || Date.now() - new Date(last.createdAt).getTime() > 20 * 3600 * 1000) {
    try { out.copia = (await createBackup('automática')).name; log.info && log.info('Copia de seguridad creada: ' + out.copia); }
    catch (e) { log.error && log.error('Copia de seguridad fallida: ' + e.message); out.error = e.message; }
  }
  try { out.purgadas = await purgeExpiredRecords(); if (out.purgadas) log.info && log.info('Historias con plazo vencido eliminadas: ' + out.purgadas); }
  catch (e) { log.error && log.error('Purga fallida: ' + e.message); }
  try { const { cleanupRateLimits } = await import('../plugins/security.js'); out.limites = await cleanupRateLimits(); }
  catch (e) { log.error && log.error('Limpieza de límites fallida: ' + e.message); }
  return out;
}

// Mantenimiento en servidor propio: copia diaria a las 03:00 (Madrid) + purga legal
export function startMaintenance(fastify) {
  let lastDay = '';
  const tick = async () => {
    const madrid = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const day = madrid.toDateString();
    if (madrid.getHours() === 3 && lastDay !== day) { lastDay = day; await runMaintenance(fastify.log, { force: true }); }
    else if (lastDay === '') { lastDay = '-'; await runMaintenance(fastify.log); } // al arrancar, solo si no hay copia reciente
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 15 * 60 * 1000);
}
