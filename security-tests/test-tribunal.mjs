import { tribunalDiet, tribunalRecipe } from '../src/services/guardrails.js';

console.log('\n⚖️  TRIBUNAL DE GUARDRAILS — casos de prueba\n');
let ok=0,ko=0;
function t(name, cond){ if(cond){console.log('  ✅ '+name);ok++} else {console.log('  ❌ '+name);ko++} }

// Dieta buena
const buena={days:{Lunes:{DESAYUNO:{name:'Avena',cal:320,ingredients:[{nombre:'avena'}]},COMIDA:{name:'Pollo',cal:540,ingredients:[{nombre:'pollo'}]},CENA:{name:'Ensalada',cal:400,ingredients:[{nombre:'lechuga'}]}}}};
t('Aprueba una dieta correcta', tribunalDiet(buena,{targetKcal:1260}).approved);

// Estructura rota
t('Rechaza dieta sin days', !tribunalDiet({},{}).approved);
t('Rechaza comida sin nombre', !tribunalDiet({days:{Lunes:{COMIDA:{cal:500}}}},{}).approved);

// Calorías peligrosas
const hambre={days:{Lunes:{DESAYUNO:{name:'x',cal:100,ingredients:[]},COMIDA:{name:'y',cal:150,ingredients:[]}}}};
t('Rechaza dieta peligrosamente baja en kcal', !tribunalDiet(hambre,{targetKcal:2000}).approved);

// Restricción violada (calorías realistas para que llegue al juez de restricciones)
const conAlergia={days:{Lunes:{DESAYUNO:{name:'Avena',cal:320,ingredients:[{nombre:'avena'}]},COMIDA:{name:'Lentejas con verduras',cal:500,ingredients:[{nombre:'lentejas'}]},CENA:{name:'Ensalada',cal:400,ingredients:[{nombre:'lechuga'}]}}}};
const veredicto=tribunalDiet(conAlergia,{targetKcal:1220,patient:{dislikes:['lentejas']}});
t('Rechaza dieta con ingrediente prohibido', !veredicto.approved && veredicto.judge==='restricciones');

// Recetas
t('Aprueba receta correcta', tribunalRecipe({name:'Tortilla',cal:300,ingredients:[{nombre:'huevo'}],steps:['batir','cuajar']},{}).approved);
t('Rechaza receta sin pasos', !tribunalRecipe({name:'x',cal:200,ingredients:[{nombre:'a'}],steps:[]},{}).approved);
t('Rechaza receta con alérgeno', !tribunalRecipe({name:'Salmón',cal:400,ingredients:[{nombre:'salmón'}],steps:['hornear']},{patient:{allergies:['salmón']}}).approved);

console.log(`\n  ${ok} correctos, ${ko} fallos\n`);
process.exit(ko>0?1:0);
