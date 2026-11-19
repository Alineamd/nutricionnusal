// ================================================================
// Motor de dietas por reglas
// 1) Calcula calorías objetivo (Mifflin-St Jeor)
// 2) Reparte entre las 5 comidas del día
// 3) Elige comidas del banco respetando exclusiones y variedad
// ================================================================

export const MEAL_TYPES = ['DESAYUNO', 'MEDIA_MANANA', 'COMIDA', 'MERIENDA', 'CENA'];
export const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Reparto de calorías por comida (suma 1.0)
const MEAL_SPLIT = {
  DESAYUNO: 0.25,
  MEDIA_MANANA: 0.10,
  COMIDA: 0.35,
  MERIENDA: 0.10,
  CENA: 0.20,
};

// Gasto energético basal (Mifflin-St Jeor)
export function calcBMR({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'M' ? base + 5 : base - 161;
}

// Calorías objetivo diarias según actividad y objetivo
export function calcTargetKcal({ sex, weightKg, heightCm, age, activityLevel = 1.2, goal = 'perder' }) {
  const bmr = calcBMR({ sex, weightKg, heightCm, age });
  const tdee = bmr * activityLevel;
  const adjust = goal === 'perder' ? -0.20 : goal === 'ganar' ? 0.15 : 0;
  return Math.round(tdee * (1 + adjust));
}

// ¿La comida está permitida para este paciente?
function isAllowed(meal, { allergies = [], dislikes = [] }) {
  const banned = [...allergies, ...dislikes].map((s) => s.toLowerCase());
  if (banned.length === 0) return true;
  const ingredients = (meal.ingredients || []).map((i) =>
    (typeof i === 'string' ? i : i.nombre || '').toLowerCase()
  );
  return !ingredients.some((ing) => banned.some((b) => ing.includes(b)));
}

// Elige la mejor comida de un tipo para un presupuesto de calorías,
// penalizando las ya usadas (para dar variedad)
function pickMeal(candidates, budget, usedIds) {
  const allowed = candidates.filter((m) => !usedIds.has(m.id));
  const pool = allowed.length > 0 ? allowed : candidates; // si no queda variedad, reutiliza
  if (pool.length === 0) return null;

  let best = null;
  let bestScore = Infinity;
  for (const m of pool) {
    const score = Math.abs((m.calories || 0) - budget);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

// Genera la dieta semanal completa
// mealBank: comidas de la BD ; patient: ficha con restricciones
export function generateWeeklyDiet({ mealBank, patient, targetKcal }) {
  const kcal = targetKcal || 2000;

  // Filtra por restricciones y agrupa por tipo
  const byType = {};
  for (const type of MEAL_TYPES) {
    byType[type] = mealBank.filter((m) => m.mealType === type && isAllowed(m, patient));
  }

  const usedIds = new Set();
  const days = {};

  for (const day of WEEK_DAYS) {
    days[day] = {};
    for (const type of MEAL_TYPES) {
      const budget = kcal * MEAL_SPLIT[type];
      const meal = pickMeal(byType[type], budget, usedIds);
      if (meal) {
        usedIds.add(meal.id);
        days[day][type] = {
          name: meal.name,
          cal: meal.calories,
          ingredients: meal.ingredients,
        };
      }
    }
    // Cada 2 días liberamos parte del historial para permitir cierta repetición controlada
    if (WEEK_DAYS.indexOf(day) % 2 === 1) usedIds.clear();
  }

  const totalKcal = Object.values(days).reduce((sum, dayMeals) => {
    return sum + Object.values(dayMeals).reduce((s, m) => s + (m.cal || 0), 0);
  }, 0);
  const avgDaily = Math.round(totalKcal / WEEK_DAYS.length);

  return { targetKcal: kcal, avgDaily, days };
}

// ── Nutrición real desde composición de alimentos ──
// items: [{alimentoId | nombre, gramos}], alimentos: filas de la tabla Alimento
export function nutricionDeComposicion(items, alimentos) {
  const idx = {};
  for (const a of alimentos) { idx[a.id] = a; idx[a.nombre.toLowerCase()] = a; }
  const tot = { kcal: 0, proteinas: 0, hidratos: 0, grasas: 0, fibra: 0, sal: 0 };
  for (const it of items || []) {
    const a = idx[it.alimentoId] || idx[String(it.nombre || '').toLowerCase()];
    if (!a) continue;
    const f = (it.gramos || 0) / 100;
    tot.kcal += a.kcal * f; tot.proteinas += a.proteinas * f; tot.hidratos += a.hidratos * f;
    tot.grasas += a.grasas * f; tot.fibra += a.fibra * f; tot.sal += a.sal * f;
  }
  for (const k of Object.keys(tot)) tot[k] = Math.round(tot[k] * 10) / 10;
  return tot;
}
