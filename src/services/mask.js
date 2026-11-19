// En los registros (logs) nunca aparece el correo completo de nadie: protección de datos.
// "ana.lopez@gmail.com" → "a***@gmail.com"
export function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : '***';
}
