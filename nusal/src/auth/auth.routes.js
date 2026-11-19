import { encStr, decStr } from '../services/fieldCrypto.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { loginGate, registerLoginFailure, registerLoginSuccess, hitLimit } from '../plugins/security.js';
import { generateSecret, verifyToken, otpauthUrl } from '../services/totp.js';
import { logAudit } from '../services/audit.js';
import { sendEmail } from '../services/notifications.js';
import crypto from 'crypto';

export default async function authRoutes(fastify) {

  // POST /auth/login — con aduana anti fuerza bruta y 2FA
  fastify.post('/auth/login', {
    schema: { body: { type: 'object', required: ['email', 'password'], properties: {
      email: { type: 'string', format: 'email', maxLength: 120 },
      password: { type: 'string', minLength: 4, maxLength: 128 },
      token2fa: { type: 'string', maxLength: 8 },
      website: { type: 'string', maxLength: 200 },   // campo trampa: una persona nunca lo rellena
    }, additionalProperties: false } },
  }, async (req, reply) => {
    if (req.body.website) return reply.code(401).send({ error: 'Credenciales incorrectas.' });
    const ip = req.ip || 'unknown';
    const gate = await loginGate(ip);
    if (gate.blocked) return reply.code(429).send({ error: `Demasiados intentos fallidos. Vuelve en ${gate.minutes} min.` });

    const { email, password, token2fa } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { patient: true } });
    const ok = user && !user.disabled ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!ok) {
      await registerLoginFailure(ip);
      await logAudit({ user: null, ip }, 'login_fallido', { detail: email });
      return reply.code(401).send({ error: 'Credenciales incorrectas.' });
    }

    // 2FA: si está activado, exige el código
    if (user.twoFactorEnabled) {
      if (!token2fa) return reply.code(200).send({ needs2FA: true });
      if (!verifyToken(decStr(user.twoFactorSecret), token2fa)) {
        await registerLoginFailure(ip);
        await logAudit({ user: { id: user.id, role: user.role }, ip }, 'login_2fa_fallido');
        return reply.code(401).send({ error: 'Código de verificación incorrecto.', needs2FA: true });
      }
    }

    await registerLoginSuccess(ip);
    const token = fastify.jwt.sign({ id: user.id, role: user.role, name: user.fullName }, { expiresIn: '7d' });
    await logAudit({ user: { id: user.id, role: user.role }, ip }, 'login_ok');
    return {
      token,
      user: {
        id: user.id, email: user.email, role: user.role, fullName: user.fullName,
        patientId: user.patient?.id || null,
        twoFactorEnabled: user.twoFactorEnabled,
        consentAccepted: user.patient ? user.patient.consentAccepted : true,
      },
    };
  });

  // ── Olvidé mi contraseña: enviar código por email ──
  fastify.post('/auth/forgot', {
    schema: { body: { type: 'object', required: ['email'], properties: {
      email: { type: 'string', format: 'email', maxLength: 120 },
      website: { type: 'string', maxLength: 200 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const ip = req.ip || 'unknown';
    const gate = await loginGate(ip);
    if (gate.blocked) return reply.code(429).send({ error: `Demasiados intentos. Vuelve en ${gate.minutes} min.` });
    const okMsg = { ok: true, message: 'Si el correo existe, recibirás un código en unos minutos.' };
    // Antispam: bots (campo trampa) y bombardeo de correos (máx. 3 por correo/hora y 10 por IP/hora)
    if (req.body.website) return okMsg;
    const em = req.body.email.toLowerCase().trim();
    if (await hitLimit('forgot-ip:' + ip, 10, 3600 * 1000) || await hitLimit('forgot-mail:' + em, 3, 3600 * 1000)) return okMsg;

    const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase().trim() } });
    // Respuesta idéntica exista o no el email (evita enumerar usuarios)
    if (user) {
      const code = String(crypto.randomInt(100000, 1000000));
      const resetCodeHash = crypto.createHash('sha256').update(code).digest('hex');
      await prisma.user.update({ where: { id: user.id }, data: { resetCodeHash, resetExpires: new Date(Date.now() + 15 * 60 * 1000), resetAttempts: 0 } });
      const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto"><div style="background:#7B2D8E;padding:18px;border-radius:14px 14px 0 0"><h2 style="color:#fff;margin:0">Recuperar contraseña</h2></div><div style="padding:22px;background:#faf8f5;border-radius:0 0 14px 14px"><p>Tu código de recuperación es:</p><p style="font-size:34px;letter-spacing:8px;font-weight:800;color:#7B2D8E;text-align:center">${code}</p><p style="color:#888;font-size:13px">Caduca en 15 minutos. Si no lo pediste, ignora este email.</p></div></div>`;
      await sendEmail(user.email, 'Tu código de recuperación', html);
      await logAudit({ user: { id: user.id, role: user.role }, ip }, 'password_reset_solicitado');
    }
    return { ok: true, message: 'Si el email existe, hemos enviado un código.' };
  });

  // ── Restablecer con el código ──
  fastify.post('/auth/reset', {
    schema: { body: { type: 'object', required: ['email', 'code', 'next'], properties: {
      email: { type: 'string', format: 'email', maxLength: 120 },
      code: { type: 'string', minLength: 6, maxLength: 6 },
      next: { type: 'string', minLength: 8, maxLength: 128 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const ip = req.ip || 'unknown';
    const gate = await loginGate(ip);
    if (gate.blocked) return reply.code(429).send({ error: `Demasiados intentos. Vuelve en ${gate.minutes} min.` });

    const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase().trim() } });
    const fail = async () => { await registerLoginFailure(ip); return reply.code(401).send({ error: 'Código incorrecto o caducado.' }); };
    if (!user || !user.resetCodeHash || !user.resetExpires) return fail();
    if (user.resetExpires < new Date() || (user.resetAttempts || 0) >= 5) {
      await prisma.user.update({ where: { id: user.id }, data: { resetCodeHash: null, resetExpires: null, resetAttempts: 0 } });
      return fail();
    }
    const hash = crypto.createHash('sha256').update(req.body.code).digest('hex');
    if (hash !== user.resetCodeHash) {
      await prisma.user.update({ where: { id: user.id }, data: { resetAttempts: (user.resetAttempts || 0) + 1 } });
      return fail();
    }
    const passwordHash = await bcrypt.hash(req.body.next, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetCodeHash: null, resetExpires: null, resetAttempts: 0 } });
    await logAudit({ user: { id: user.id, role: user.role }, ip }, 'password_reset_ok');
    return { ok: true };
  });

  // ── Cambiar contraseña (cualquier usuario logueado, verificando la actual) ──
  fastify.post('/auth/password', {
    preHandler: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['current', 'next'], properties: {
      current: { type: 'string', minLength: 4, maxLength: 128 },
      next: { type: 'string', minLength: 8, maxLength: 128 },
    }, additionalProperties: false } },
  }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = user ? await bcrypt.compare(req.body.current, user.passwordHash) : false;
    if (!ok) return reply.code(401).send({ error: 'La contraseña actual no es correcta.' });
    const passwordHash = await bcrypt.hash(req.body.next, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await logAudit(req, 'cambio_password');
    return { ok: true };
  });

  fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { patient: true } });
    return { id: user.id, email: user.email, role: user.role, fullName: user.fullName, patientId: user.patient?.id || null, twoFactorEnabled: user.twoFactorEnabled, consentAccepted: user.patient ? user.patient.consentAccepted : true };
  });

  // ── 2FA: iniciar configuración (staff) ──
  fastify.post('/auth/2fa/setup', { preHandler: [fastify.requireStaff] }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const secret = generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encStr(secret) } });
    return { secret, otpauth: otpauthUrl(secret, user.email) };
  });

  // ── 2FA: activar tras verificar el primer código ──
  fastify.post('/auth/2fa/enable', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['token'], properties: { token: { type: 'string', maxLength: 8 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorSecret || !verifyToken(decStr(user.twoFactorSecret), req.body.token)) {
      return reply.code(400).send({ error: 'Código incorrecto. Revisa tu app de autenticación.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    await logAudit(req, '2fa_activado');
    return { ok: true, twoFactorEnabled: true };
  });

  // ── 2FA: desactivar (requiere código) ──
  fastify.post('/auth/2fa/disable', {
    preHandler: [fastify.requireStaff],
    schema: { body: { type: 'object', required: ['token'], properties: { token: { type: 'string', maxLength: 8 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorEnabled || !verifyToken(decStr(user.twoFactorSecret), req.body.token)) {
      return reply.code(400).send({ error: 'Código incorrecto.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    await logAudit(req, '2fa_desactivado');
    return { ok: true, twoFactorEnabled: false };
  });
}
