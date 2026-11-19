import { fetchPage, parseRecipeFromHtml } from '../services/recipeImport.js';
import { hitLimit } from '../plugins/security.js';
import { logAudit } from '../services/audit.js';

const SAFE_ERRORS = /^(Dirección no válida|Dirección no permitida|Solo se admiten|Demasiadas redirecciones|La web respondió|Esa dirección no es|La página es demasiado|La web tarda)/;

export default async function recipeImportRoutes(fastify) {
  fastify.post('/recipes/import-url', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['url'], properties: { url: { type: 'string', minLength: 8, maxLength: 500 } }, additionalProperties: false } },
  }, async (req, reply) => {
    if (await hitLimit('recipe-import:' + req.user.id, 20, 3600 * 1000)) return reply.code(429).send({ error: 'Has importado muchas recetas seguidas. Espera un poco.' });
    try {
      const html = await fetchPage(req.body.url);
      const r = parseRecipeFromHtml(html, req.body.url);
      if (!r || !r.name || !r.ingredients.length) return reply.code(422).send({ error: 'No he encontrado una receta en esa página. Prueba con otra web o añádela a mano.' });
      await logAudit(req, 'receta_importada_web', { detail: new URL(req.body.url).hostname });
      return r;
    } catch (e) {
      return reply.code(400).send({ error: SAFE_ERRORS.test(e.message || '') ? e.message : 'No se pudo leer esa página.' });
    }
  });
}
