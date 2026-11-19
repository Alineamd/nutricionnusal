import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { securityPlugin, loginGate, registerLoginFailure, registerLoginSuccess } from '../src/plugins/security.js';
import { authenticate, requireAdmin, requireStaff, setAccountChecker } from '../src/auth/auth.hooks.js';
import { hitLimit } from '../src/plugins/security.js';
// Cuentas dadas de baja (simulado): el control de acceso real las consulta aquí
const DISABLED = new Set();
setAccountChecker(async (id) => !DISABLED.has(String(id)));

// Usuarios de prueba en memoria (admin, médico, paciente)
const USERS = {
  'admin@nusal.es':  { id: '1', role: 'admin',   hash: bcrypt.hashSync('admin123', 10) },
  'medico@nusal.es': { id: '2', role: 'medico',  hash: bcrypt.hashSync('nusal123', 10) },
  'pac@nusal.es':    { id: '3', role: 'patient', hash: bcrypt.hashSync('pac123', 10) },
};

const fastify = Fastify({ logger: false, bodyLimit: 1*1024*1024, trustProxy: true });
await fastify.register(cors, { origin: true });
await fastify.register(jwt, { secret: 'test-secret-larguísimo-para-pruebas-1234' });
await securityPlugin(fastify);
fastify.decorate('authenticate', authenticate);
fastify.decorate('requireAdmin', requireAdmin);
fastify.decorate('requireStaff', requireStaff);
fastify.setErrorHandler((err, req, reply) => {
  if (err.validation) return reply.code(400).send({ error: 'Datos no válidos.' });
  const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  reply.code(code).send({ error: code === 500 ? 'Error interno.' : err.message });
});

fastify.get('/health', async () => ({ status: 'ok', service: 'nusal-backend' }));

fastify.post('/auth/login', { schema: { body: { type:'object', required:['email','password'], properties:{ email:{type:'string',format:'email',maxLength:120}, password:{type:'string',minLength:4,maxLength:128} }, additionalProperties:false } } }, async (req, reply) => {
  const ip = req.ip || 'x';
  if ((await loginGate(ip)).blocked) return reply.code(429).send({ error: 'bloqueado' });
  const u = USERS[req.body.email.toLowerCase().trim()];
  const ok = u && bcrypt.compareSync(req.body.password, u.hash);
  if (!ok) { await registerLoginFailure(ip); return reply.code(401).send({ error: 'Credenciales incorrectas.' }); }
  await registerLoginSuccess(ip);
  return { token: fastify.jwt.sign({ id: u.id, role: u.role }) };
});

// Parte MÉDICA (staff = admin o médico)
fastify.get('/patients', { preHandler: [fastify.requireStaff] }, async () => ([]));
fastify.post('/meals', { preHandler: [fastify.requireStaff] }, async () => ({ ok: true }));
// Parte TÉCNICA (solo admin)
fastify.get('/admin/costs', { preHandler: [fastify.requireAdmin] }, async () => ({ total: 0 }));
fastify.get('/admin/audit', { preHandler: [fastify.requireAdmin] }, async () => ({ registros: [] }));


// Chat y RGPD (aislamiento entre pacientes, mismo scoping que producción)
const PATIENTS_MOCK = { pt3: { userId: '3' }, ptOtro: { userId: '9' } };
function accessCode(req, pid) {
  const p = PATIENTS_MOCK[pid];
  if (!p) return 404;
  const isStaff = ['admin', 'medico'].includes(req.user.role);
  if (!isStaff && p.userId !== req.user.id) return 403;
  return 200;
}
fastify.get('/chat/:pid', { preHandler: [fastify.authenticate] }, async (req, reply) => {
  const c = accessCode(req, req.params.pid);
  if (c !== 200) return reply.code(c).send({ error: 'No autorizado.' });
  return { messages: [] };
});
fastify.post('/chat', { preHandler: [fastify.authenticate] }, async (req, reply) => {
  const c = accessCode(req, (req.body || {}).patientId);
  if (c !== 200) return reply.code(c).send({ error: 'No autorizado.' });
  return { ok: true };
});
fastify.get('/me/export', { preHandler: [fastify.authenticate] }, async (req, reply) => {
  if (req.user.role !== 'patient') return reply.code(403).send({ error: 'Solo pacientes.' });
  return { perfil: {} };
});
fastify.get('/patients/:pid/export', { preHandler: [fastify.requireStaff] }, async () => ({ perfil: {} }));
fastify.delete('/patients/:pid/gdpr', { preHandler: [fastify.requireStaff] }, async () => ({ ok: true }));

// Solo en pruebas: simula la baja de una cuenta
fastify.post('/test/disable/:id', async (req) => { DISABLED.add(String(req.params.id)); return { ok: true }; });
// Mismo limitador que /auth/forgot en producción (3 por correo y hora)
fastify.post('/test/forgot', async (req) => ({ limited: await hitLimit('forgot-mail:' + req.body.email, 3, 3600 * 1000) }));

await fastify.listen({ port: 3999, host: '0.0.0.0' });
console.log('test-server listo en 3999');
