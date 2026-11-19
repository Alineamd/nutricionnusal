// ── Recordatorios de citas: email + push al paciente el día antes ──
import { prisma } from '../db.js';
import { sendEmail, sendPushToUser, escHtml } from './notifications.js';

// Fecha "YYYY-MM-DD" en horario de España
function dateInSpain(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Minutos desde medianoche, hora de España
function minutesNowSpain() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return (+p.find((x) => x.type === 'hour').value % 24) * 60 + (+p.find((x) => x.type === 'minute').value);
}
const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };

export async function sendDueReminders(log = console) {
  let sent = 0;
  // 1) Día antes: recordatorio que pide confirmar la asistencia (no a citas canceladas).
  //    Solo entre las 9:00 y las 21:30 (hora de España): nunca notificaciones de madrugada.
  const nowMin = minutesNowSpain();
  const tomorrow = dateInSpain(1);
  const dayBefore = (nowMin < 9 * 60 || nowMin > 21 * 60 + 30) ? [] : await prisma.appointment.findMany({ where: { date: tomorrow, reminderSent: false, NOT: { status: 'cancelada' } }, include: { patient: { include: { user: true } } } });
  for (const a of dayBefore) {
    const u = a.patient?.user; if (!u || u.disabled) continue;
    const nombre = (u.fullName || '').split(' ')[0] || 'Hola';
    const pide = a.status === 'confirmada' ? 'Ya confirmaste tu asistencia. ¡Te esperamos!' : 'Abre la app y confirma si vas a venir.';
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;color:#1C1C1E"><h2 style="color:#7B2D8E">Mañana tienes cita</h2><p>${escHtml(nombre)}, te recordamos tu cita de mañana a las <b>${escHtml(a.time)}</b>.</p><p>${escHtml(pide)}</p></div>`;
    try {
      await Promise.all([
        sendEmail(u.email, 'Recordatorio: mañana tienes cita a las ' + a.time, html),
        sendPushToUser(u.id, { title: 'Mañana tienes cita a las ' + a.time, body: a.status === 'confirmada' ? 'Asistencia confirmada. ¡Te esperamos!' : '¿Vas a venir? Toca para confirmar tu asistencia.', tag: 'cita-' + a.id, url: '/' }),
      ]);
    } catch (e) { log.error && log.error(e); }
    await prisma.appointment.update({ where: { id: a.id }, data: { reminderSent: true } });
    sent++;
  }
  // 2) Una hora antes: aviso de que la cita es inminente
  const now = nowMin;
  const today = await prisma.appointment.findMany({ where: { date: dateInSpain(0), reminder1hSent: false, NOT: { status: 'cancelada' } }, include: { patient: { include: { user: true } } } });
  for (const a of today) {
    const t = toMin(a.time); const left = t === null ? null : t - now;
    if (left === null || left <= 0 || left > 65) continue;
    const u = a.patient?.user; if (!u || u.disabled) continue;
    try { await sendPushToUser(u.id, { title: 'Tu cita es a las ' + a.time, body: 'Dentro de ' + left + ' minutos. ¡Te esperamos!', tag: 'cita1h-' + a.id, url: '/' }); }
    catch (e) { log.error && log.error(e); }
    await prisma.appointment.update({ where: { id: a.id }, data: { reminder1hSent: true } });
    sent++;
  }
  return sent;
}

export function startReminderScheduler(fastify) {
  const run = async () => {
    try { const n = await sendDueReminders(fastify.log); if (n > 0) fastify.log.info(`Recordatorios de cita enviados: ${n}`); }
    catch (e) { fastify.log.error(e); }
  };
  setTimeout(run, 30 * 1000);
  setInterval(run, 5 * 60 * 1000); // cada 5 minutos: permite el aviso de "una hora antes"
}
