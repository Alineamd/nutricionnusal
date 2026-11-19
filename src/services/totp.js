// ================================================================
// 2FA — TOTP (RFC 6238) con crypto nativo de Node. Sin dependencias.
// Compatible con Google Authenticator, Authy, Microsoft Authenticator.
// ================================================================

import crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(length = 20) {
  const bytes = crypto.randomBytes(length);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32ToBuffer(secret) {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpAt(secret, counter) {
  const key = base32ToBuffer(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

export function verifyToken(secret, token, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (totpAt(secret, counter + w) === clean) return true;
  }
  return false;
}

export function otpauthUrl(secret, label, issuer = 'NUSAL') {
  const l = encodeURIComponent(label);
  const i = encodeURIComponent(issuer);
  return `otpauth://totp/${i}:${l}?secret=${secret}&issuer=${i}&algorithm=SHA1&digits=6&period=30`;
}
