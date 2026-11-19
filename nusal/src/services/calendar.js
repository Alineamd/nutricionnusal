// Calendario (iCalendar, RFC 5545) y utilidades de la revisión semanal
export function weekStartMadrid(d = new Date()) {
  const m = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-' + String(m.getDate()).padStart(2, '0');
}
// Privacidad: en el calendario solo nombre e inicial del apellido
export function shortName(full) {
  const p = String(full || '').trim().split(/\s+/).filter(Boolean);
  return p.length > 1 ? p[0] + ' ' + p[1].charAt(0).toUpperCase() + '.' : (p[0] || 'Paciente');
}
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out = []; let cur = '';
  for (const ch of line) { if (Buffer.byteLength(cur + ch, 'utf8') > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch; }
  out.push(cur); return out.join('\r\n ');
}
export function buildIcs(appts, { calName = 'NUSAL · Citas' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NUSAL//Citas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(calName), 'X-WR-TIMEZONE:Europe/Madrid', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const a of appts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) continue;
    const t = /^\d{1,2}:\d{2}$/.test(a.time || '') ? a.time.padStart(5, '0') : '09:00';
    const st = a.status === 'confirmada' ? 'CONFIRMED' : a.status === 'cancelada' ? 'CANCELLED' : 'TENTATIVE';
    const mark = a.status === 'confirmada' ? '✓ ' : a.status === 'cancelada' ? '✗ ' : '';
    L.push('BEGIN:VEVENT', 'UID:' + a.id + '@nusal', 'DTSTAMP:' + stamp, 'DTSTART;TZID=Europe/Madrid:' + a.date.replace(/-/g, '') + 'T' + t.replace(':', '') + '00',
      'DURATION:PT45M', 'SUMMARY:' + esc(mark + 'Cita · ' + shortName(a.name)), 'STATUS:' + st, 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
