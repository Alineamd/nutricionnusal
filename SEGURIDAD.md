# NUSAL — Arquitectura de resiliencia y ciberseguridad

Cada petición atraviesa capas de defensa antes de tocar los datos. Ninguna respuesta de la IA llega al usuario sin pasar por el Tribunal. Todo el gasto de IA se registra en tiempo real.

```
Petición
   │
   ▼
┌─────────────────────────────────────────────┐
│  ADUANA DE ENTRADA  (src/plugins/security.js)│
│  · Cabeceras de seguridad (nosniff, DENY,    │
│    HSTS, no-store)                           │
│  · Rate limit global: 120 req/min por IP     │
│  · Límite de payload: 1 MB                    │
│  · IP real: la da Netlify (no falseable)      │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  VALIDACIÓN DE ESQUEMA  (por ruta)           │
│  · Tipos, longitudes, formato email          │
│  · additionalProperties:false (rechaza campos│
│    desconocidos)                             │
│  · Neutraliza inyección: Prisma parametriza  │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  AUTENTICACIÓN Y ROLES  (auth.hooks.js)      │
│  · JWT firmado, expira a 7 días              │
│  · authenticate / requireAdmin por ruta      │
│  · Login: bloqueo de IP tras 5 fallos (15min)│
│  · Mensajes que no revelan qué emails existen│
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  LÓGICA DE NEGOCIO  (routes / services)      │
└─────────────────────────────────────────────┘
   │  (si interviene la IA)
   ▼
┌─────────────────────────────────────────────┐
│  TRIBUNAL DE GUARDRAILS  (guardrails.js)     │
│  3 jueces sobre la respuesta de la IA:       │
│   1. Estructura  — forma JSON exacta         │
│   2. Nutrición   — kcal y cantidades sensatas│
│   3. Restricciones — sin alérgenos prohibidos│
│  Si condena → rechaza + 1 reintento          │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  REGISTRO DE COSTES  (costs.js → AiUsage)    │
│  · tokens in/out, coste USD, latencia,       │
│    aprobada/rechazada — por cada llamada     │
│  · Panel en tiempo real: GET /admin/costs    │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  MANEJADOR DE ERRORES  (server.js)           │
│  · Nunca filtra stack traces ni rutas        │
│  · Arranque falla si falta JWT_SECRET (prod) │
└─────────────────────────────────────────────┘
```

## Puntos flojos detectados en la auditoría y cómo se resolvieron

| Punto flojo (antes) | Riesgo | Solución aplicada |
|---|---|---|
| `JWT_SECRET` con valor por defecto | Cualquiera podía firmar tokens | El servidor **no arranca** en producción sin un secreto de 24+ caracteres |
| Sin rate limiting | Fuerza bruta, DoS básico | Límite global 120/min + **bloqueo de IP** en login tras 5 fallos |
| Sin validación de entrada | Inyección, datos basura, payloads gigantes | **Esquemas** por ruta + límite de 1 MB + `additionalProperties:false` |
| Sin cabeceras de seguridad | Clickjacking, sniffing MIME | nosniff, X-Frame-Options DENY, HSTS, no-store |
| Respuestas de IA sin validar | Dieta peligrosa o con alérgenos al paciente | **Tribunal de 3 jueces** + reintento; rechaza si no es segura |
| Sin control de costes | Factura de IA descontrolada e invisible | Registro por llamada + panel de costes en tiempo real |
| Errores con detalles internos | Fuga de información técnica | Manejador que devuelve mensajes genéricos |
| CORS abierto | Cualquier web podía llamar a la API | Aviso en producción si no se define `CORS_ORIGIN` |

## Cómo verificarlo tú mismo

```bash
# Simulación de ataques (30 comprobaciones)
npm run test:security

# Tribunal de Guardrails (8 casos)
npm run test:guardrails
```

Resultado esperado: **30/30 defensas OK** y **8/8 casos del Tribunal OK**.

## Lo que en la v1.0 quedaba fuera (ya resuelto)

- **Cifrado a nivel de campo**: historia clínica, notas privadas y secretos 2FA se cifran con AES-256-GCM (`FIELD_ENCRYPTION_KEY`) antes de guardarse.
- **Registro de auditoría** de quién accede a cada ficha (ver v1.2).
- **Copias de seguridad automáticas** cifradas, con descarga y script de restauración.
- **2FA** para el personal (ver v1.2).
- **RGPD**: consentimiento explícito, exportación de datos por el propio paciente y derecho de supresión.

Pendiente fuera del código: firmar el acuerdo de encargado del tratamiento (DPA) con Netlify y Supabase, activar 2FA en esas cuentas y en GitHub, y que un profesional revise los textos legales.

---

# Actualización v1.2 — Roles, 2FA, auditoría y consentimiento

## Tres tipos de acceso
| Rol | Ve la parte médica | Ve la parte técnica (costes, auditoría) |
|---|---|---|
| **Admin** | Sí | **Sí** |
| **Médico** | Sí | **No** |
| **Paciente** | Solo sus datos | No |

La separación se aplica en el backend con guardas `requireStaff` (médico+admin) y `requireAdmin` (solo admin). Verificado con la simulación: el médico recibe **403** al intentar acceder a costes o auditoría.

## 2FA (verificación en dos pasos)
- TOTP compatible con Google Authenticator / Authy (implementado con `crypto` nativo, sin dependencias).
- El personal clínico lo activa desde **Gestión → Seguridad**.
- Si está activo, el login pide el código de 6 dígitos tras la contraseña.

## Registro de auditoría (RGPD)
- Cada acción sensible deja rastro: quién, qué, sobre quién, IP y cuándo.
- Se registran: inicios de sesión (ok/fallido), consultas y ediciones de fichas, registro de peso, aceptación de consentimiento y cambios de 2FA.
- Solo el admin lo consulta en **Gestión → Auditoría**.

## Consentimiento del paciente
- Al entrar por primera vez, el paciente debe aceptar el tratamiento de sus datos de salud (RGPD) antes de usar la app.
- La aceptación se guarda con fecha y versión, y queda registrada en la auditoría.

## Verificación
`npm run test:security` → **30/30 defensas OK** (incluye separación de roles, chat y RGPD entre pacientes, bajas y antispam).

---

# Actualización v2.0 — Todo en Netlify + Supabase

```
Navegador ──HTTPS──▶ Netlify (app + /api/* en funciones) ──TLS──▶ Supabase PostgreSQL (UE, París)
                         │
                         └──▶ Netlify Blobs (UE, Frankfurt): copias cifradas
```

- **Sin servidor propio**: la API corre en funciones de Netlify (`netlify/functions/api.mjs`); recordatorios cada 15 min y mantenimiento nocturno como funciones programadas.
- **IP del cliente**: la da la plataforma (`context.ip`); no se aceptan cabeceras `x-forwarded-for` que un atacante podría falsear.
- **Bloqueo de fuerza bruta compartido**: como cada petición puede ir a una instancia distinta, los contadores de intentos y límites se guardan en la base de datos (tabla `RateLimit`) como hash SHA-256, sin IPs ni correos en claro. Se limpian solos cada noche.
- **Base de datos no expuesta**: tablas en el esquema propio `nusal`, que la API pública de Supabase no publica; RLS activo en todas y sin permisos para los roles `anon` y `authenticated`. Solo el servidor (dueño de las tablas) puede leerlas.
- **Conexión cifrada** con Supabase (TLS) a través de su pooler; la contraseña va aparte (`DB_PASSWORD`) y nunca aparece en los registros.
- **Copias**: cada noche, comprimidas y cifradas (AES-256-GCM, `BACKUP_KEY`) en Netlify Blobs, región UE. Solo el admin las lista y descarga; nombres validados (sin rutas maliciosas).
- **Despliegues seguros**: si un cambio de tablas fuera a borrar datos, el despliegue se detiene y sigue la versión anterior. Vistas previas y ramas desactivadas porque usarían la base de datos real.
- **Registros sin datos personales**: los correos aparecen enmascarados (`a***@dominio`).
- **Cabeceras** de seguridad (CSP estricta, HSTS, anti-clickjacking, no-store) en la app (`_headers`) y en la API (en el código, porque Netlify no aplica `_headers` a las funciones).

