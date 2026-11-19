// Escapa texto antes de meterlo en un correo HTML (evita inyectar HTML con un nombre o un mensaje)
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ================================================================
// NOTIFICACIONES — Email + Push (móvil y PC)
//  · Email: SMTP (nodemailer). Si no hay SMTP configurado, no falla.
//  · Push: Web Push (VAPID). Funciona en PWA (Android/PC; iOS 16.4+).
// Ninguna notificación debe tumbar la app: todo va en try/catch.
// ================================================================

import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { prisma } from '../db.js';
import { maskEmail } from './mask.js';

// ── Configuración VAPID (push) ──
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@nusal.es';
let pushReady = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); pushReady = true; }
  catch (e) { console.warn('⚠ VAPID mal configurado:', e.message); }
}
export function getVapidPublicKey() { return VAPID_PUBLIC; }

// ── Configuración email (SMTP) ──
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
const FROM = process.env.MAIL_FROM || 'NUSAL <no-reply@nusal.es>';

export async function sendEmail(to, subject, html) {
  if (!mailer || !to) { console.log(`[email no enviado: falta configurar SMTP] ${maskEmail(to)} · ${subject}`); return false; }
  try { await mailer.sendMail({ from: FROM, to, subject, html }); return true; }
  catch (e) { console.warn('⚠ Error enviando email:', e.message); return false; }
}

// ── Enviar push a todas las suscripciones de un usuario ──
export async function sendPushToUser(userId, payload) {
  if (!pushReady || !userId) return 0;
  let sent = 0;
  let subs = [];
  try { subs = await prisma.pushSubscription.findMany({ where: { userId } }); } catch (e) { return 0; }
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      // Suscripción caducada/eliminada → limpiar
      if (err.statusCode === 404 || err.statusCode === 410) {
        try { await prisma.pushSubscription.delete({ where: { id: s.id } }); } catch {}
      }
    }
  }
  return sent;
}

// ── Guardar / actualizar una suscripción push ──
export async function savePushSubscription(userId, sub) {
  if (!sub || !sub.endpoint) return false;
  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId, p256dh: sub.keys?.p256dh || '', auth: sub.keys?.auth || '' },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys?.p256dh || '', auth: sub.keys?.auth || '' },
    });
    return true;
  } catch (e) { return false; }
}

// ── Plantillas ──
export function replyEmailHtml(patientName, replyText) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <div style="background:#7B2D8E;padding:20px;border-radius:16px 16px 0 0">
        <h2 style="color:#fff;margin:0">NUSAL</h2>
      </div>
      <div style="padding:24px;background:#faf8f5;border-radius:0 0 16px 16px">
        <p>Hola ${escHtml(patientName || '')},</p>
        <p>Tu nutricionista te ha respondido:</p>
        <blockquote style="background:#fff;border-left:3px solid #E8A025;padding:12px 16px;border-radius:8px;color:#333">
          ${escHtml(replyText)}
        </blockquote>
        <p style="color:#888;font-size:13px">Abre la app de NUSAL para ver la conversación completa.</p>
      </div>
    </div>`;
}
