// ================================================================
// TRIBUNAL DE GUARDRAILS
// Toda respuesta de la IA pasa por 3 jueces antes de aceptarse:
//   1. Juez de ESTRUCTURA  — el JSON tiene la forma exacta esperada
//   2. Juez de NUTRICIÓN   — las calorías y cantidades son sensatas
//   3. Juez de RESTRICCIONES — no aparece ningún ingrediente prohibido
// Si algún juez condena, la respuesta se RECHAZA y no llega al usuario.
// ================================================================

import { MEAL_TYPES, WEEK_DAYS } from './dietEngine.js';

// ── Juez 1: estructura ──
function judgeStructure(diet) {
  const v = [];
  if (!diet || typeof diet !== 'object') return ['La respuesta no es un objeto'];
  if (!diet.days || typeof diet.days !== 'object') return ['Falta el objeto days'];
  const days = Object.keys(diet.days);
  if (days.length === 0) v.push('days está vacío');
  for (const day of days) {
    if (!WEEK_DAYS.includes(day)) v.push(`Día desconocido: ${day}`);
    const meals = diet.days[day];
    for (const [type, meal] of Object.entries(meals || {})) {
      if (!MEAL_TYPES.includes(type)) v.push(`Tipo de comida desconocido: ${type} (${day})`);
      if (!meal || typeof meal.name !== 'string' || !meal.name.trim()) v.push(`Comida sin nombre en ${day}/${type}`);
      if (meal && meal.ingredients && !Array.isArray(meal.ingredients)) v.push(`ingredients no es array en ${day}/${type}`);
    }
  }
  return v;
}

// ── Juez 2: sensatez nutricional ──
function judgeNutrition(diet, targetKcal) {
  const v = [];
  let total = 0, mealCount = 0;
  for (const meals of Object.values(diet.days || {})) {
    for (const meal of Object.values(meals || {})) {
      const cal = Number(meal.cal) || 0;
      if (cal < 0) v.push(`Calorías negativas en "${meal.name}"`);
      if (cal > 2000) v.push(`Calorías absurdas (${cal}) en "${meal.name}"`);
      total += cal; mealCount++;
    }
  }
  if (mealCount === 0) { v.push('La dieta no tiene ninguna comida'); return v; }
  const daysCount = Object.keys(diet.days).length || 1;
  const avgDaily = total / daysCount;
  if (targetKcal) {
    const dev = Math.abs(avgDaily - targetKcal) / targetKcal;
    // margen 25%: la IA puede desviarse un poco, más es sospechoso
    if (dev > 0.25) v.push(`Media diaria ${Math.round(avgDaily)} kcal se desvía >25% del objetivo ${targetKcal}`);
  }
  if (avgDaily < 800) v.push(`Media diaria peligrosamente baja: ${Math.round(avgDaily)} kcal`);
  return v;
}

// ── Juez 3: restricciones del paciente ──
function judgeRestrictions(diet, patient) {
  const v = [];
  const banned = [...(patient?.allergies || []), ...(patient?.dislikes || [])]
    .map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (banned.length === 0) return v;
  for (const [day, meals] of Object.entries(diet.days || {})) {
    for (const [type, meal] of Object.entries(meals || {})) {
      const ings = (meal.ingredients || []).map((i) =>
        (typeof i === 'string' ? i : i?.nombre || '').toLowerCase());
      const hitName = banned.find((b) => meal.name.toLowerCase().includes(b));
      const hitIng = banned.find((b) => ings.some((x) => x.includes(b)));
      if (hitName) v.push(`"${meal.name}" (${day}) contiene restricción "${hitName}" en el nombre`);
      if (hitIng) v.push(`"${meal.name}" (${day}) contiene ingrediente prohibido "${hitIng}"`);
    }
  }
  return v;
}

// ── Veredicto para dietas ──
export function tribunalDiet(diet, { targetKcal, patient } = {}) {
  const structure = judgeStructure(diet);
  // si la estructura falla, no tiene sentido seguir juzgando
  if (structure.length) return { approved: false, judge: 'estructura', violations: structure };
  const nutrition = judgeNutrition(diet, targetKcal);
  if (nutrition.length) return { approved: false, judge: 'nutrición', violations: nutrition };
  const restrictions = judgeRestrictions(diet, patient);
  if (restrictions.length) return { approved: false, judge: 'restricciones', violations: restrictions };
  return { approved: true, judge: null, violations: [] };
}

// ── Veredicto para recetas ──
export function tribunalRecipe(recipe, { patient } = {}) {
  const v = [];
  if (!recipe || typeof recipe.name !== 'string' || !recipe.name.trim()) v.push('Receta sin nombre');
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) v.push('Receta sin ingredientes');
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) v.push('Receta sin pasos');
  const cal = Number(recipe.cal) || 0;
  if (cal < 0 || cal > 3000) v.push(`Calorías fuera de rango: ${cal}`);
  const banned = [...(patient?.allergies || []), ...(patient?.dislikes || [])]
    .map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (banned.length && Array.isArray(recipe.ingredients)) {
    const ings = recipe.ingredients.map((i) => (typeof i === 'string' ? i : i?.nombre || '').toLowerCase());
    const hit = banned.find((b) => ings.some((x) => x.includes(b)) || recipe.name.toLowerCase().includes(b));
    if (hit) v.push(`Contiene restricción del paciente: "${hit}"`);
  }
  return v.length ? { approved: false, violations: v } : { approved: true, violations: [] };
}
