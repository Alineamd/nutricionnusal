// Cifrado de campos sensibles en la base de datos (AES-256-GCM, clave en FIELD_ENCRYPTION_KEY).
// Si alguien obtuviera una copia de la base de datos, la historia clínica, las notas clínicas y los
// secretos de verificación en dos pasos serían ilegibles. Los datos antiguos sin cifrar se siguen leyendo.
import crypto from 'crypto';
let KEY;
function key() {
  if (KEY === undefined) { const k = process.env.FIELD_ENCRYPTION_KEY; KEY = k ? crypto.scryptSync(k, 'nusal-field-v1', 32) : null; }
  return KEY;
}
export const fieldCryptoEnabled = () => !!key();
export function encStr(s) {
  if (s == null || s === '' || !key()) return s;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decStr(s) {
  if (typeof s !== 'string' || !s.startsWith('enc:v1:')) return s;
  if (!key()) throw new Error('Falta FIELD_ENCRYPTION_KEY para leer datos cifrados.');
  const b = Buffer.from(s.slice(7), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
export const encJson = (o) => (key() ? { __enc: encStr(JSON.stringify(o ?? {})) } : o);
export const decJson = (o) => (o && typeof o === 'object' && typeof o.__enc === 'string' ? JSON.parse(decStr(o.__enc)) : o);
