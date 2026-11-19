// ================================================================
// NUSAL · Recordatorios de citas (función programada, cada 15 minutos)
// · El día antes (entre las 9:00 y las 21:30): correo + aviso pidiendo confirmar.
// · Una hora antes: aviso en el móvil.
// ================================================================
export default async () => {
  process.env.NUSAL_SERVERLESS = '1';
  const db = await import('../../src/db.js');
  db.refreshIfIdle();
  const { sendDueReminders } = await import('../../src/services/reminders.js');
  try {
    const n = await sendDueReminders(console);
    if (n) console.log(`NUSAL: recordatorios enviados: ${n}`);
  } catch (e) {
    console.error('NUSAL: recordatorios fallidos:', e.message);
  } finally {
    await db.closeDb();
  }
};

// Cada 15 minutos (UTC; la lógica usa la hora de España)
export const config = { schedule: '*/15 * * * *' };
