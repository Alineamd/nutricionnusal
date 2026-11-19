// ================================================================
// Integración con la API de Claude (Anthropic).
// La clave vive en process.env.ANTHROPIC_API_KEY (NUNCA en el frontend).
// ================================================================

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

async function callClaude(systemPrompt, userPrompt, maxTokens = 4000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Falta ANTHROPIC_API_KEY en las variables de entorno.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Error de la API de Claude (${res.status}): ${detail}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };
  return { text, usage };
}

// Extrae el primer bloque JSON de una respuesta (por si viene con texto alrededor)
function extractJson(text) {
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('La IA no devolvió JSON válido.');
  return JSON.parse(clean.slice(start, end + 1));
}

// Genera una dieta semanal con IA respetando restricciones
export async function generateDietWithAI({ patient, targetKcal, mealBank = [] }) {
  const system = `Eres una nutricionista clínica. Generas dietas semanales equilibradas en español.
Respondes SIEMPRE y ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown.`;

  const bankHint = mealBank.length
    ? `Puedes inspirarte en estas comidas del banco: ${mealBank.slice(0, 30).map((m) => m.name).join('; ')}.`
    : '';

  const user = `Crea una dieta semanal (Lunes a Domingo) con 5 comidas al día: DESAYUNO, MEDIA_MANANA, COMIDA, MERIENDA, CENA.
Calorías objetivo diarias: ${targetKcal} kcal.
Restricciones/alergias: ${JSON.stringify(patient.allergies || [])}.
No le gustan: ${JSON.stringify(patient.dislikes || [])}.
Tipo de dieta: ${patient.dietType || 'equilibrada'}.
${bankHint}

Devuelve este JSON exacto:
{
  "days": {
    "Lunes": {
      "DESAYUNO": { "name": "...", "cal": 320, "ingredients": [{"nombre":"avena","cantidad":50,"unidad":"g"}] },
      "MEDIA_MANANA": { ... }, "COMIDA": { ... }, "MERIENDA": { ... }, "CENA": { ... }
    },
    "Martes": { ... }, "...": {}, "Domingo": { ... }
  }
}`;

  const { text, usage } = await callClaude(system, user, 6000);
  return { diet: extractJson(text), usage, model: MODEL };
}

// Genera/adapta una receta con IA
export async function generateRecipeWithAI({ query, patient }) {
  const system = `Eres una chef nutricionista. Creas recetas saludables en español.
Respondes SIEMPRE y ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown.`;

  const restr = patient
    ? `Ten en cuenta alergias: ${JSON.stringify(patient.allergies || [])} y que no le gustan: ${JSON.stringify(patient.dislikes || [])}.`
    : '';

  const user = `Crea una receta saludable sobre: "${query}". ${restr}
Devuelve este JSON exacto:
{
  "name": "...",
  "cal": 450,
  "time": "25 min",
  "servings": 2,
  "ingredients": [{"nombre":"salmón","cantidad":200,"unidad":"g"}],
  "steps": ["Paso 1", "Paso 2"]
}`;

  const { text, usage } = await callClaude(system, user, 2000);
  return { recipe: extractJson(text), usage, model: MODEL };
}

// ── Catálogo de supermercados: mapea ingredientes → producto real por cadena ──
export async function generateStoreCatalogWithAI({ ingredients, stores }) {
  const system = `Eres un experto en supermercados españoles. Para cada ingrediente genérico, indica el nombre del producto equivalente más común (marca blanca preferente) en cada supermercado indicado.
Reglas:
- Usa la marca blanca del supermercado cuando exista (Mercadona→Hacendado, DÍA→DÍA, Carrefour→Carrefour, Lidl→marcas propias como Milbona/Cien, Alcampo→Auchan/Alcampo).
- Nombre corto y realista, como aparecería en la lista de la compra.
- Devuelve SOLO JSON válido, sin texto extra.
Formato exacto:
{"items":[{"ingredient":"leche","products":{"Mercadona":"Leche entera Hacendado","DÍA":"Leche entera DÍA"}}]}`;
  const user = `Ingredientes: ${JSON.stringify(ingredients)}
Supermercados: ${JSON.stringify(stores)}`;
  const { text, usage } = await callClaude(system, user, 4000);
  return { catalog: extractJson(text), usage, model: MODEL };
}


// ── Importación: convierte el texto de un PDF/Word/Excel en una dieta estructurada ──
// Regla de oro: TRANSCRIBIR, no inventar. Si el documento no trae calorías, cal = null.
export async function extractDietFromTextWithAI({ text, fileName = '' }) {
  const system = `Eres una asistente que TRANSCRIBE dietas escritas por nutricionistas a un formato estructurado.
No inventas platos, cantidades ni calorías: si un dato no aparece en el documento, lo dejas vacío.
Respondes SIEMPRE y ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown.`;
  const user = `Documento importado${fileName ? ' ("' + fileName + '")' : ''}. Extrae la dieta con esta estructura exacta:
{"name":"título si aparece","weeks":[{"Lunes":{"Desayuno":{"name":"texto del plato tal cual","cal":número o null,"ingredients":["alimento",...]},"Media mañana":{...},"Comida":{...},"Merienda":{...},"Cena":{...}},"Martes":{...}}]}
Reglas:
- Días válidos: Lunes, Martes, Miércoles, Jueves, Viernes, Sábado, Domingo.
- Comidas válidas: Desayuno, Media mañana, Comida, Merienda, Cena. ("Almuerzo" = Comida, salvo que el documento tenga también "Comida"; entonces "Almuerzo" = Media mañana. "Recena" se añade a Cena.)
- Omite las comidas que no aparezcan. Si el documento da un único menú sin días, repítelo en los 7 días.
- Si hay varias semanas ("Semana 1", "Semana 2"...), crea un objeto por semana en "weeks".
- "ingredients": los alimentos principales mencionados en el plato (máximo 8), en singular y en español.

DOCUMENTO:
"""
${text}
"""`;
  const { text: out, usage } = await callClaude(system, user, 8000);
  return { diet: extractJson(out), usage, model: MODEL };
}
