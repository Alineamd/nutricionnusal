// ================================================================
// NUSAL · Mantenimiento diario (función programada)
// · Copia de seguridad completa y cifrada en Netlify Blobs (UE), se guardan las 30 últimas.
// · Eliminación de historias clínicas cuyo plazo legal de conservación ha vencido.
// · Limpieza de contadores de intentos caducados.
// ================================================================
export default async () => {
  process.env.NUSAL_SERVERLESS = '1';
  const db = await import('../../src/db.js');
  db.refreshIfIdle();
  const { runMaintenance } = await import('../../src/services/backup.js');
  try {
    const r = await runMaintenance(console);
    console.log('NUSAL: mantenimiento', JSON.stringify(r));
  } finally {
    await db.closeDb();
  }
};

// 02:00 UTC = 03:00 en España en invierno (04:00 en verano)
export const config = { schedule: '0 2 * * *' };
