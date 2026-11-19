import { prisma } from '../db.js';
import { generateStoreCatalogWithAI } from '../services/claude.js';
import { logAiUsage } from '../services/costs.js';

export const STORES = ['Mercadona', 'DÍA', 'Carrefour', 'Lidl', 'Alcampo'];

export default async function storeCatalogRoutes(fastify) {
  // Listar catálogo (cualquier usuario logueado: el paciente lo necesita para su cesta)
  fastify.get('/store-catalog', { preHandler: [fastify.authenticate] }, async (req) => {
    const where = req.query?.store ? { store: req.query.store } : {};
    const rows = await prisma.storeProduct.findMany({ where, orderBy: { ingredient: 'asc' } });
    return { stores: STORES, items: rows };
  });

  // Generar propuestas con IA (NO guarda: la médico/admin revisa antes). Solo staff.
  fastify.post('/store-catalog/generate', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['ingredients'], properties: {
      ingredients: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 200 },
      stores: { type: 'array', items: { type: 'string', maxLength: 30 }, maxItems: 10 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const ingredients = [...new Set((req.body.ingredients || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
    const stores = req.body.stores?.length ? req.body.stores : STORES;
    if (!ingredients.length) return reply.code(400).send({ error: 'No hay ingredientes.' });
    const t0 = Date.now();
    try {
      const { catalog, usage, model } = await generateStoreCatalogWithAI({ ingredients, stores });
      await logAiUsage({ endpoint: '/store-catalog/generate', model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, latencyMs: Date.now() - t0, approved: true });
      // Aplanar a filas {ingredient, store, productName} para revisar/editar en el frontend
      const rows = [];
      for (const it of catalog.items || []) {
        const ing = String(it.ingredient || '').toLowerCase().trim();
        if (!ing) continue;
        for (const [store, productName] of Object.entries(it.products || {})) {
          if (productName) rows.push({ ingredient: ing, store, productName: String(productName).slice(0, 120) });
        }
      }
      return { items: rows };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(502).send({ error: 'La IA no pudo generar el catálogo.', detail: err.message });
    }
  });

  // Guardar/actualizar catálogo (bulk upsert). Solo staff.
  fastify.post('/store-catalog', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['items'], properties: {
      items: { type: 'array', maxItems: 2000, items: { type: 'object', required: ['ingredient', 'store', 'productName'], properties: {
        ingredient: { type: 'string', maxLength: 80 },
        store: { type: 'string', maxLength: 30 },
        productName: { type: 'string', maxLength: 120 },
      }, additionalProperties: false } },
    }, additionalProperties: false } },
  }, async (req) => {
    let saved = 0;
    for (const it of req.body.items) {
      const ingredient = it.ingredient.toLowerCase().trim();
      if (!ingredient || !it.productName.trim()) continue;
      await prisma.storeProduct.upsert({
        where: { ingredient_store: { ingredient, store: it.store } },
        update: { productName: it.productName.trim() },
        create: { ingredient, store: it.store, productName: it.productName.trim() },
      });
      saved++;
    }
    return { ok: true, saved };
  });

  // Borrar una entrada
  fastify.delete('/store-catalog/:id', { preHandler: [fastify.requireStaff] }, async (req) => {
    try { await prisma.storeProduct.delete({ where: { id: req.params.id } }); } catch {}
    return { ok: true };
  });
}
