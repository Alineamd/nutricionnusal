# NUSAL — App de la consulta (Netlify + Supabase)

Todo vive en **un solo proyecto de Netlify** y la base de datos en **Supabase**:

```
Doctora y pacientes ──▶ https://nusal-app.netlify.app ──▶ /api/* (funciones de Netlify) ──▶ Supabase (París)
```

| Carpeta | Qué es |
|---|---|
| `public/` | La app ya compilada (lo que ven la doctora y los pacientes) |
| `netlify/functions/api.mjs` | El servidor: todas las rutas `/api/*` |
| `netlify/functions/recordatorios.mjs` | Recordatorios de citas (cada 15 min) |
| `netlify/functions/mantenimiento.mjs` | Copia de seguridad diaria cifrada y limpieza (cada noche) |
| `src/` | Código del servidor (rutas, cifrado, seguridad, copias…) |
| `prisma/schema.prisma` | Tablas de la base de datos |
| `codigo-fuente/` | Código fuente de la app (solo para futuras modificaciones) |

En cada despliegue, Netlify crea o actualiza las tablas en Supabase (en un esquema propio, `nusal`, que la API pública de Supabase no expone), activa el blindaje RLS y crea los datos iniciales. No hay que tocar nada en Supabase.

---

## Puesta en marcha (una sola vez)

### 1. Supabase
1. Proyecto **NUSAL** → **Project Settings → Database → Reset database password** → *Generate a password*. Guárdala: es `DB_PASSWORD`.
2. Botón **Connect** → **Session pooler** → copia la cadena (acaba en `:5432/postgres`). Es `DATABASE_URL`; deja `[YOUR-PASSWORD]` tal cual.
3. Recomendado: **Project Settings → Data API** → desactívala (NUSAL no la usa).

### 2. GitHub
Sube esta carpeta a un repositorio **privado** (con GitHub Desktop: *File → Add local repository* o *New repository*, *Commit* y *Publish* marcando *Keep this code private*).

### 3. Netlify — variables
Proyecto **nusal-app** → **Project configuration → Environment variables → Add a variable → Import from a .env file**, y pega (cambiando los valores):

```
NODE_ENV=production
DATABASE_URL=postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
DB_PASSWORD=la-contraseña-de-supabase
JWT_SECRET=frase-aleatoria-1-de-32-caracteres-o-mas
FIELD_ENCRYPTION_KEY=frase-aleatoria-2-de-32-caracteres-o-mas
BACKUP_KEY=frase-aleatoria-3-de-32-caracteres-o-mas
ADMIN_EMAIL=tu-correo-real
ADMIN_PASSWORD=minimo-10-caracteres
MEDICO_EMAIL=correo-real-de-la-doctora
MEDICO_PASSWORD=minimo-10-caracteres
MEDICO_NAME=Nombre que verán los pacientes
```

> **Guarda `FIELD_ENCRYPTION_KEY` y `BACKUP_KEY` en un gestor de contraseñas y no las cambies nunca**: cifran la historia clínica y las copias.

### 4. Netlify — conectar el repositorio
**Project configuration → Build & deploy → Continuous deployment → Link repository** → GitHub → elige el repositorio. La configuración de compilación ya viene en `netlify.toml`: no cambies nada y despliega.

En el registro del despliegue verás: *Tablas al día*, *Blindaje aplicado*, *cuenta creada* (x2) y *Base de datos lista*.

### 5. Comprobar
- `https://nusal-app.netlify.app/api/health` → `{"status":"ok","db":"ok"}`
- Entra en la app con `ADMIN_EMAIL` / `ADMIN_PASSWORD` y con la cuenta de la doctora.
- Después, **borra `ADMIN_PASSWORD` y `MEDICO_PASSWORD`** de las variables (las cuentas ya existen; cambiarlas después no cambia ninguna contraseña).

Opcionales: correo (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`), notificaciones push (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) e IA (`ANTHROPIC_API_KEY`). Cualquier cambio de variables necesita un nuevo despliegue (**Deploys → Trigger deploy**).

---

## Cosas a tener en cuenta

- **Plan gratuito de Netlify**: 300 créditos al mes. Cada despliegue de producción cuesta 15; el uso normal de una consulta pequeña entra de sobra, pero **si se agotan, Netlify pausa todos los proyectos del equipo** hasta el mes siguiente. Despliega solo cuando haga falta y revisa el consumo en *Usage & billing*.
- Las funciones del plan gratuito se ejecutan en EE. UU. (Ohio); la base de datos y las copias siguen en la UE. La política de privacidad ya lo indica en «proveedores».
- **Vistas previas y ramas desactivadas** a propósito (`netlify.toml`): usarían la base de datos real.
- **Supabase Free** no hace copias propias; las hace NUSAL cada noche, cifradas, en Netlify Blobs (UE). El administrador puede descargarlas en *Gestión → Datos y copias*.

## Restaurar una copia
Descárgala desde la app y, en un ordenador con Node 20+ y este proyecto (`npm install`):

```bash
DATABASE_URL="…" DB_PASSWORD="…" BACKUP_KEY="…" node src/scripts/restore-backup.js nusal-AAAAMMDD-HHMMSS.json.gz.enc --confirmar
```

Sustituye todos los datos actuales por los de la copia.

## Seguridad
- Contraseñas con bcrypt (coste 12), sesiones con caducidad y verificación en dos pasos para el personal.
- Historia clínica, notas privadas y secretos 2FA cifrados (AES-256-GCM) antes de guardarse; copias cifradas.
- Límite de intentos compartido entre instancias (guardado en la base de datos como hash, sin IPs ni correos en claro).
- Tablas en un esquema no expuesto, con RLS y sin permisos para los roles públicos de Supabase.
- Cada paciente solo ve sus datos; las notas privadas de la profesional nunca se envían al paciente.
- Cabeceras de seguridad estrictas (CSP, HSTS, anti-clickjacking) en la app y en la API.
