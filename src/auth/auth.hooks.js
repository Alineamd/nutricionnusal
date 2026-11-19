// Guardas reutilizables para proteger rutas.
// Comprueba que la cuenta sigue activa (una baja invalida también las sesiones abiertas).
// En producción consulta la base de datos; el banco de pruebas puede inyectar su propio comprobador.
let checker = null;
export function setAccountChecker(fn) { checker = fn; }
async function active(req) {
  if (!checker) {
    const { prisma } = await import('../db.js');
    checker = async (id) => { const u = await prisma.user.findUnique({ where: { id }, select: { disabled: true } }); return !!u && !u.disabled; };
  }
  return checker(req.user.id);
}

export async function authenticate(req, reply) {
  try {
    await req.jwtVerify();
    if (!(await active(req))) return reply.code(401).send({ error: 'Cuenta dada de baja.' });
  } catch (err) { reply.code(401).send({ error: 'No autorizado. Inicia sesión.' }); }
}

// Solo el ADMINISTRADOR (parte técnica: costes, auditoría, copias de seguridad)
export async function requireAdmin(req, reply) {
  try {
    await req.jwtVerify();
    if (!(await active(req))) return reply.code(401).send({ error: 'Cuenta dada de baja.' });
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Solo el administrador.' });
  } catch (err) { reply.code(401).send({ error: 'No autorizado.' }); }
}

// PERSONAL CLÍNICO: admin O médico (parte médica: pacientes, dietas, recetas...)
export async function requireStaff(req, reply) {
  try {
    await req.jwtVerify();
    if (!(await active(req))) return reply.code(401).send({ error: 'Cuenta dada de baja.' });
    if (req.user.role !== 'admin' && req.user.role !== 'medico') {
      return reply.code(403).send({ error: 'Acceso reservado al personal de la clínica.' });
    }
  } catch (err) { reply.code(401).send({ error: 'No autorizado.' }); }
}
