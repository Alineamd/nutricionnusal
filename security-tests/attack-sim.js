// ================================================================
// SIMULACIÓN DE ATAQUES
// Lanza ataques reales contra el backend y verifica que cada
// defensa responde. Uso:  node security-tests/attack-sim.js [URL]
// ================================================================

const BASE = process.argv[2] || 'http://localhost:3000';
let pass = 0, fail = 0;

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body, headers: res.headers };
}
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name} ${detail}`); fail++; }
}

async function run() {
  console.log(`\n🎯 Simulación de ataques contra ${BASE}\n`);

  // 1. El servidor vive
  console.log('1) Disponibilidad');
  const h = await req('/health');
  check('El backend responde /health', h.status === 200);

  // 2. Cabeceras de seguridad (aduana)
  console.log('\n2) Cabeceras de seguridad');
  check('X-Content-Type-Options: nosniff', h.headers.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options: DENY', h.headers.get('x-frame-options') === 'DENY');
  check('HSTS presente', !!h.headers.get('strict-transport-security'));

  // 3. Acceso sin token → debe rechazar
  console.log('\n3) Control de acceso (endpoints protegidos)');
  const noauth = await req('/patients');
  check('GET /patients sin token → 401', noauth.status === 401, `(devolvió ${noauth.status})`);
  const noauthMeals = await req('/meals', { method: 'POST', body: JSON.stringify({ mealType: 'CENA', name: 'x' }) });
  check('POST /meals sin token → 401', noauthMeals.status === 401, `(devolvió ${noauthMeals.status})`);

  // 4. Token falso → debe rechazar
  console.log('\n4) Token manipulado');
  const fake = await req('/patients', { headers: { authorization: 'Bearer falso.token.aqui' } });
  check('Token inválido → 401', fake.status === 401, `(devolvió ${fake.status})`);

  // 5. Inyección / validación de entrada
  console.log('\n5) Validación de entrada (aduana)');
  const badLogin = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'no-es-email', password: 'x' }) });
  check('Login con email inválido → 400', badLogin.status === 400, `(devolvió ${badLogin.status})`);
  const sqlish = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: "a@b.com' OR '1'='1", password: 'x' }) });
  check('Intento de inyección SQL neutralizado (Prisma parametriza)', sqlish.status === 400 || sqlish.status === 401, `(devolvió ${sqlish.status})`);
  const huge = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(5000) }) });
  check('Password gigante rechazado por esquema → 400', huge.status === 400, `(devolvió ${huge.status})`);


  // 6. Separación de roles (médico NO ve la parte técnica)
  console.log('\n6) Separación de roles');
  async function login(email, password) {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    return r.body && r.body.token ? r.body.token : null;
  }
  const adminTk = await login('admin@nusal.es', 'admin123');
  const medicoTk = await login('medico@nusal.es', 'nusal123');
  check('El admin obtiene token', !!adminTk);
  check('El médico obtiene token', !!medicoTk);

  const medPat = await req('/patients', { headers: { authorization: 'Bearer ' + medicoTk } });
  check('Médico SÍ accede a la parte médica (/patients)', medPat.status === 200, `(${medPat.status})`);

  const medCosts = await req('/admin/costs', { headers: { authorization: 'Bearer ' + medicoTk } });
  check('Médico NO accede a costes (técnica) → 403', medCosts.status === 403, `(${medCosts.status})`);
  const medAudit = await req('/admin/audit', { headers: { authorization: 'Bearer ' + medicoTk } });
  check('Médico NO accede a auditoría (técnica) → 403', medAudit.status === 403, `(${medAudit.status})`);

  const admCosts = await req('/admin/costs', { headers: { authorization: 'Bearer ' + adminTk } });
  check('Admin SÍ accede a costes (técnica)', admCosts.status === 200, `(${admCosts.status})`);

  // 6b. Chat y RGPD: aislamiento entre pacientes
  console.log('\n6b) Chat y RGPD: un paciente no puede tocar datos ajenos');
  const pacTk = await login('pac@nusal.es', 'pac123');
  const ownChat = await req('/chat/pt3', { headers: { authorization: 'Bearer ' + pacTk } });
  check('Paciente SÍ lee su propio chat', ownChat.status === 200, `(${ownChat.status})`);
  const otherChat = await req('/chat/ptOtro', { headers: { authorization: 'Bearer ' + pacTk } });
  check('Paciente NO lee el chat de otro → 403', otherChat.status === 403, `(${otherChat.status})`);
  const sendOther = await req('/chat', { method: 'POST', headers: { authorization: 'Bearer ' + pacTk }, body: JSON.stringify({ patientId: 'ptOtro', texto: 'hola' }) });
  check('Paciente NO escribe en conversación ajena → 403', sendOther.status === 403, `(${sendOther.status})`);
  const ownExport = await req('/me/export', { headers: { authorization: 'Bearer ' + pacTk } });
  check('Paciente SÍ exporta sus propios datos', ownExport.status === 200, `(${ownExport.status})`);
  const expOther = await req('/patients/ptOtro/export', { headers: { authorization: 'Bearer ' + pacTk } });
  check('Paciente NO exporta datos de otro → 403', expOther.status === 403, `(${expOther.status})`);
  const delOther = await req('/patients/ptOtro/gdpr', { method: 'DELETE', headers: { authorization: 'Bearer ' + pacTk }, body: JSON.stringify({ confirmName: 'x' }) });
  check('Paciente NO ejecuta borrado RGPD de otro → 403', delOther.status === 403, `(${delOther.status})`);
  const staffChat = await req('/chat/ptOtro', { headers: { authorization: 'Bearer ' + medicoTk } });
  check('Médico SÍ abre cualquier conversación', staffChat.status === 200, `(${staffChat.status})`);

  // 6c. Protecciones nuevas: baja, 404, cabeceras, antispam
  console.log('\n6c) Bajas, errores, cabeceras y antispam');
  const pac2 = await login('pac@nusal.es', 'pac123');
  const antes = await req('/chat/pt3', { headers: { authorization: 'Bearer ' + pac2 } });
  const dis = await req('/test/disable/3', { method: 'POST', body: '{}' }); if (dis.status !== 200) console.log('   (baja simulada falló', dis.status, ')');
  const despues = await req('/chat/pt3', { headers: { authorization: 'Bearer ' + pac2 } });
  check('Cuenta dada de baja: su sesión abierta deja de valer → 401', antes.status === 200 && despues.status === 401, `(${antes.status}→${despues.status})`);
  const nf = await req('/ruta-que-no-existe');
  check('404 sin revelar rutas ni el framework', nf.status === 404 && JSON.stringify(nf.body) === '{"error":"No encontrado."}', `(${nf.status} ${JSON.stringify(nf.body)})`);
  check('La API pide no ser indexada (X-Robots-Tag)', /noindex/.test(nf.headers.get('x-robots-tag') || ''));
  check('La API envía política de contenido estricta (CSP)', /default-src 'none'/.test(nf.headers.get('content-security-policy') || ''));
  let lim = []; for (let i = 0; i < 5; i++) lim.push((await req('/test/forgot', { method: 'POST', body: JSON.stringify({ email: 'victima@correo.es' }) })).body.limited);
  check('Recuperar contraseña: máx. 3 correos por hora a la misma persona', lim.join() === 'false,false,false,true,true', `(${lim.join()})`);

  // 7. Fuerza bruta → bloqueo por IP
  console.log('\n7) Anti fuerza bruta (bloqueo tras 5 intentos)');
  let blocked = false;
  for (let i = 0; i < 7; i++) {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'nutricionista@nusal.es', password: 'malaX' + i }) });
    if (r.status === 429) blocked = true;
  }
  check('La IP se bloquea (429) tras varios fallos', blocked, '(no se activó el bloqueo)');

  // 8. Fugas de información en errores
  console.log('\n8) Los errores no filtran detalles internos');
  const notfound = await req('/patients/xxxxx', { headers: { authorization: 'Bearer falso' } });
  check('Sin stack traces ni rutas internas en la respuesta',
    !JSON.stringify(notfound.body || {}).toLowerCase().includes('prisma') &&
    !JSON.stringify(notfound.body || {}).toLowerCase().includes('/home/'));


  console.log(`\n${'─'.repeat(40)}`);
  console.log(`RESULTADO: ${pass} defensas OK, ${fail} fallos`);
  console.log('─'.repeat(40) + '\n');
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error('Error en la simulación:', e.message); process.exit(2); });
