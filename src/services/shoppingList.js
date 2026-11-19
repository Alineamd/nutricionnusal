// ================================================================
// Genera la lista de la compra agregando ingredientes de:
//  - todas las comidas de la dieta semanal
//  - (opcional) recetas asignadas
// Suma cantidades, elimina duplicados y categoriza.
// ================================================================

const CAT_KEYWORDS = {
  Verduras: ['espinaca', 'calabac', 'pimiento', 'tomate', 'cebolla', 'zanahoria', 'lechuga', 'espárrago', 'patata', 'brócoli', 'ajo', 'pepino', 'berenjena'],
  Frutas: ['plátano', 'arándano', 'manzana', 'limón', 'aguacate', 'pera', 'naranja', 'fresa', 'kiwi', 'mango'],
  Proteínas: ['pollo', 'pechuga', 'salmón', 'merluza', 'huevo', 'pavo', 'tofu', 'garbanzo', 'lenteja', 'atún', 'ternera', 'cerdo', 'gambas'],
  Cereales: ['arroz', 'avena', 'quinoa', 'pan', 'granola', 'pasta', 'cuscús', 'trigo'],
  Lácteos: ['leche', 'yogur', 'parmesano', 'queso', 'nata', 'mantequilla'],
  Grasas: ['aceite', 'aove', 'tahini', 'nuez', 'semilla', 'almendra', 'anacardo'],
};

function categorize(name) {
  const low = name.toLowerCase();
  for (const [cat, keys] of Object.entries(CAT_KEYWORDS)) {
    if (keys.some((k) => low.includes(k))) return cat;
  }
  return 'Otros';
}

// Normaliza un ingrediente que puede venir como string o como objeto
function normalize(ing) {
  if (typeof ing === 'string') {
    // intenta separar "200g salmón" → cantidad/unidad/nombre
    const m = ing.match(/^([\d.,]+)\s*(g|kg|ml|l|ud|uds)?\s+(.*)$/i);
    if (m) return { nombre: m[3].trim(), cantidad: parseFloat(m[1].replace(',', '.')) || null, unidad: m[2] || null };
    return { nombre: ing.trim(), cantidad: null, unidad: null };
  }
  return { nombre: (ing.nombre || '').trim(), cantidad: ing.cantidad ?? null, unidad: ing.unidad || null };
}

// diet: { days: { Lunes: { COMIDA: { ingredients: [...] } } } }
// extraRecipes: [{ ingredients: [...] }]
export function buildShoppingList(diet, extraRecipes = []) {
  const agg = {}; // clave: nombre+unidad

  function addIngredient(raw) {
    const ing = normalize(raw);
    if (!ing.nombre) return;
    const key = (ing.nombre + '|' + (ing.unidad || '')).toLowerCase();
    if (!agg[key]) {
      agg[key] = { name: ing.nombre, unit: ing.unidad, quantity: 0, hasQty: false, category: categorize(ing.nombre) };
    }
    if (ing.cantidad != null) {
      agg[key].quantity += ing.cantidad;
      agg[key].hasQty = true;
    }
  }

  if (diet && diet.days) {
    for (const dayMeals of Object.values(diet.days)) {
      for (const meal of Object.values(dayMeals)) {
        (meal.ingredients || []).forEach(addIngredient);
      }
    }
  }
  for (const recipe of extraRecipes) {
    (recipe.ingredients || []).forEach(addIngredient);
  }

  const items = Object.values(agg).map((it) => ({
    name: it.name,
    category: it.category,
    quantity: it.hasQty ? `${Math.round(it.quantity * 100) / 100}${it.unit || ''}` : null,
    isChecked: false,
  }));

  // Ordena por categoría
  items.sort((a, b) => a.category.localeCompare(b.category));
  return items;
}
