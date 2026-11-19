// ================================================================
// Ajuste del cliente de Prisma generado (se ejecuta tras "prisma generate").
// El motor de consultas en WebAssembly está pensado para entornos "edge";
// aquí se carga desde disco para que funcione en Node (Netlify Functions,
// servidor propio y local) sin binarios nativos. Si el código generado no
// es el esperado, el despliegue se detiene con un mensaje claro.
// ================================================================
const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'node_modules', '.prisma', 'client', 'wasm.js');
if (!fs.existsSync(file)) {
  console.error('⛔ No existe ' + file + '. Ejecuta antes "prisma generate" (con previewFeatures = ["driverAdapters"]).');
  process.exit(1);
}
let src = fs.readFileSync(file, 'utf8');
const MARK = '/* NUSAL: motor WASM desde disco */';
if (src.includes(MARK)) { console.log('✅ Cliente de Prisma ya preparado.'); process.exit(0); }

const re = /getQueryEngineWasmModule: async \(\) => \{[\s\S]*?\n  \}/;
if (!re.test(src)) {
  console.error('⛔ El cliente de Prisma generado no tiene el formato esperado (versión distinta de 5.22).');
  process.exit(1);
}
src = src.replace(re, `getQueryEngineWasmModule: async () => { ${MARK}
    const g = globalThis
    if (!g.__nusalPrismaWasm) g.__nusalPrismaWasm = new WebAssembly.Module(require('fs').readFileSync(require('path').join(__dirname, 'query_engine_bg.wasm')))
    return g.__nusalPrismaWasm
  }`);
fs.writeFileSync(file, src);
console.log('✅ Cliente de Prisma preparado (motor WebAssembly).');
