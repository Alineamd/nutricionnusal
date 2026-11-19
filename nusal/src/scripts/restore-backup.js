// Restaura una copia de seguridad COMPLETA (sustituye todos los datos actuales).
// Uso:  node src/scripts/restore-backup.js <ruta-de-la-copia> --confirmar
import fs from 'fs';
import { prisma, closeDb } from '../db.js';
import { decode, MODELS } from '../services/backup.js';

const file = process.argv[2];
if (!file || !process.argv.includes('--confirmar')) {
  console.log('Uso: node src/scripts/restore-backup.js <copia> --confirmar');
  console.log('ATENCIÓN: borra los datos actuales y los sustituye por los de la copia.');
  process.exit(1);
}
const { meta, data } = decode(fs.readFileSync(file));
console.log('Copia de', meta.creada, '·', Object.values(meta.registros).reduce((a, b) => a + b, 0), 'registros');
await prisma.$transaction(async (tx) => {
  for (const m of [...MODELS].reverse()) await tx[m].deleteMany();
  for (const m of MODELS) {
    const rows = data[m] || [];
    for (let i = 0; i < rows.length; i += 500) await tx[m].createMany({ data: rows.slice(i, i + 500) });
    if (rows.length) console.log('  ', m, rows.length);
  }
}, { timeout: 10 * 60 * 1000 });
console.log('Restauración completada.');
await closeDb();
