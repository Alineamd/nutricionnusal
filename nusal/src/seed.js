import bcrypt from 'bcryptjs';
import { prisma, closeDb } from './db.js';
import { maskEmail } from './services/mask.js';
// En producción NUNCA se usan correos ni contraseñas por defecto. Las cuentas se crean
// solo la primera vez (si no existen); después estas variables ya no hacen falta.
const PROD = process.env.NODE_ENV === 'production';

import { ALIMENTOS } from './data/alimentos.data.js';
import { FARMACOS } from './data/farmacos.data.js';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

const MEALS = [
  ['DESAYUNO', 'Porridge de avena con arándanos', 320, [{nombre:'avena',cantidad:50,unidad:'g'},{nombre:'leche',cantidad:200,unidad:'ml'},{nombre:'arándanos',cantidad:null,unidad:null}]],
  ['DESAYUNO', 'Tostada integral con aguacate y huevo', 380, [{nombre:'pan integral',cantidad:2,unidad:'ud'},{nombre:'aguacate',cantidad:0.5,unidad:null},{nombre:'huevo',cantidad:1,unidad:'ud'}]],
  ['DESAYUNO', 'Yogur griego con granola y fruta', 290, [{nombre:'yogur griego',cantidad:150,unidad:'g'},{nombre:'granola',cantidad:30,unidad:'g'}]],
  ['MEDIA_MANANA', 'Fruta de temporada con nueces', 180, [{nombre:'manzana',cantidad:1,unidad:'ud'},{nombre:'nueces',cantidad:15,unidad:'g'}]],
  ['MEDIA_MANANA', 'Yogur natural con semillas', 150, [{nombre:'yogur natural',cantidad:125,unidad:'g'},{nombre:'semillas de chía',cantidad:10,unidad:'g'}]],
  ['COMIDA', 'Salmón al horno con espárragos', 540, [{nombre:'salmón',cantidad:200,unidad:'g'},{nombre:'espárragos',cantidad:1,unidad:null},{nombre:'limón',cantidad:null,unidad:null}]],
  ['COMIDA', 'Pollo al curry con arroz integral', 580, [{nombre:'pechuga de pollo',cantidad:200,unidad:'g'},{nombre:'arroz integral',cantidad:80,unidad:'g'},{nombre:'leche de coco',cantidad:100,unidad:'ml'}]],
  ['COMIDA', 'Bowl de quinoa con verduras', 490, [{nombre:'quinoa',cantidad:80,unidad:'g'},{nombre:'calabacín',cantidad:1,unidad:null},{nombre:'garbanzos',cantidad:100,unidad:'g'}]],
  ['COMIDA', 'Lentejas con verduras', 480, [{nombre:'lentejas',cantidad:100,unidad:'g'},{nombre:'zanahoria',cantidad:1,unidad:null},{nombre:'patata',cantidad:1,unidad:null}]],
  ['MERIENDA', 'Tostada integral con pavo', 200, [{nombre:'pan integral',cantidad:1,unidad:'ud'},{nombre:'pavo',cantidad:50,unidad:'g'}]],
  ['CENA', 'Ensalada César con pollo', 410, [{nombre:'pechuga de pollo',cantidad:150,unidad:'g'},{nombre:'lechuga',cantidad:null,unidad:null},{nombre:'parmesano',cantidad:20,unidad:'g'}]],
  ['CENA', 'Crema de calabacín con semillas', 280, [{nombre:'calabacín',cantidad:2,unidad:null},{nombre:'patata',cantidad:1,unidad:null},{nombre:'cebolla',cantidad:1,unidad:null}]],
  ['CENA', 'Tortilla francesa con ensalada', 350, [{nombre:'huevo',cantidad:2,unidad:'ud'},{nombre:'ensalada mixta',cantidad:null,unidad:null}]],
];

const FAQS = [
  ['¿Puedo cambiar el arroz por pasta?', 'Sí, siempre integral y misma cantidad en crudo.', 1],
  ['¿Qué hago si me salto la dieta?', 'Retoma en la siguiente comida. No compenses.', 2],
  ['¿Puedo tomar café entre horas?', 'Sí, café solo o infusiones sin azúcar.', 3],
  ['¿Puedo comer fruta por la noche?', 'Sí, evita las muy dulces antes de dormir.', 4],
];

async function main() {
  console.log('🌱 Sembrando datos...');

  await prisma.clinic.upsert({
    where: { id: CLINIC_ID },
    update: {},
    create: { id: CLINIC_ID, name: process.env.CLINIC_NAME || 'NUSAL - Nutrición & Salud' },
  });

  // Cuentas del personal: ADMIN (parte técnica + médica) y MÉDICO (solo parte médica, la doctora).
  // Si ya existe una cuenta con ese rol, no se toca (ni su contraseña).
  async function ensureStaff({ role, envEmail, envPass, envName, devEmail, devPass, defName, label }) {
    const existing = await prisma.user.findFirst({ where: { role }, select: { email: true } });
    if (existing) { console.log(`   ${label}: ya existe (${maskEmail(existing.email)})`); return; }
    const email = String(process.env[envEmail] || (PROD ? '' : devEmail)).toLowerCase().trim();
    const pass = process.env[envPass] || (PROD ? '' : devPass);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error(`⛔ Falta ${envEmail}: el correo real de la cuenta ${label} (sirve para recuperar la contraseña).`);
      process.exit(1);
    }
    if (PROD && String(pass).length < 10) {
      console.error(`⛔ ${envPass} debe tener al menos 10 caracteres (se usa solo para crear la cuenta ${label} la primera vez).`);
      process.exit(1);
    }
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(pass, 12), role, fullName: process.env[envName] || defName, clinicId: CLINIC_ID } });
    console.log(`   ${label}: cuenta creada (${maskEmail(email)})`);
  }
  await ensureStaff({ role: 'admin', envEmail: 'ADMIN_EMAIL', envPass: 'ADMIN_PASSWORD', envName: 'ADMIN_NAME', devEmail: 'admin@nusal.es', devPass: 'admin123', defName: 'Administrador', label: 'Admin (técnico + médico)' });
  await ensureStaff({ role: 'medico', envEmail: 'MEDICO_EMAIL', envPass: 'MEDICO_PASSWORD', envName: 'MEDICO_NAME', devEmail: 'nutricionista@nusal.es', devPass: 'nusal123', defName: 'Nutricionista', label: 'Médico (solo clínico)' });

  // Banco de comidas
  const count = await prisma.mealBank.count();
  if (count === 0) {
    for (const [mealType, name, calories, ingredients] of MEALS) {
      await prisma.mealBank.create({ data: { mealType, name, calories, ingredients, clinicId: CLINIC_ID } });
    }
    console.log(`   ${MEALS.length} comidas en el banco`);
  }

  // FAQs
  const fcount = await prisma.faq.count();
  if (fcount === 0) {
    for (const [question, answer, sortOrder] of FAQS) {
      await prisma.faq.create({ data: { question, answer, sortOrder, clinicId: CLINIC_ID } });
    }
    console.log(`   ${FAQS.length} FAQs`);
  }

  // ── Catálogo inicial de supermercados (arranque; la IA lo amplía) ──
  const STARTER_CATALOG = {
    'leche':{Mercadona:'Leche entera Hacendado','DÍA':'Leche entera DÍA',Carrefour:'Leche entera Carrefour',Lidl:'Leche entera Milbona',Alcampo:'Leche entera Auchan'},
    'huevos':{Mercadona:'Huevos M Hacendado','DÍA':'Huevos frescos DÍA',Carrefour:'Huevos camperos Carrefour',Lidl:'Huevos frescos',Alcampo:'Huevos M Alcampo'},
    'pollo':{Mercadona:'Pechuga de pollo Hacendado','DÍA':'Pechuga de pollo DÍA',Carrefour:'Pechuga de pollo Carrefour',Lidl:'Pechuga de pollo',Alcampo:'Pechuga de pollo Alcampo'},
    'arroz':{Mercadona:'Arroz redondo Hacendado','DÍA':'Arroz redondo DÍA',Carrefour:'Arroz redondo Carrefour',Lidl:'Arroz redondo',Alcampo:'Arroz redondo Alcampo'},
    'aceite de oliva':{Mercadona:'AOVE Hacendado','DÍA':'AOVE DÍA',Carrefour:'AOVE Carrefour',Lidl:'AOVE Milbona',Alcampo:'AOVE Alcampo'},
  };
  const ccount = await prisma.storeProduct.count();
  if (ccount === 0) {
    let n = 0;
    for (const [ingredient, map] of Object.entries(STARTER_CATALOG)) {
      for (const [store, productName] of Object.entries(map)) {
        await prisma.storeProduct.create({ data: { ingredient, store, productName } });
        n++;
      }
    }
    console.log(`   ${n} productos de catálogo`);
  }

  // ── Base de datos de alimentos (BEDCA) ──
  const acount = await prisma.alimento.count();
  if (acount === 0) {
    const rows = ALIMENTOS.map(([nombre, categoria, kcal, proteinas, hidratos, azucares, grasas, grasasSat, fibra, sal, calcio, hierro, vitD, b12, potasio]) =>
      ({ nombre, categoria, kcal, proteinas, hidratos, azucares, grasas, grasasSat, fibra, sal, calcio, hierro, vitD, b12, potasio }));
    await prisma.alimento.createMany({ data: rows, skipDuplicates: true });
    console.log(`   ${rows.length} alimentos (ref. BEDCA)`);
  }

  const fcount2 = await prisma.farmaco.count();
  if (fcount2 === 0) {
    const rows = FARMACOS.map(([nombre, principioActivo, grupo, interacciones]) => ({ nombre, principioActivo, grupo, interacciones }));
    await prisma.farmaco.createMany({ data: rows, skipDuplicates: true });
    console.log(`   ${rows.length} fármacos con interacciones`);
  }

  console.log('✅ Datos sembrados.');
}

main().then(() => closeDb()).catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
