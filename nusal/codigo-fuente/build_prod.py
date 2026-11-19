#!/usr/bin/env python3
"""Genera la versión de PRODUCCIÓN de NUSAL (lista para subir a Netlify / Cloudflare Pages).
- Código precompilado y minificado (sin compilar en el navegador: más rápido y sin 'eval').
- Todas las librerías servidas desde el propio dominio (sin CDNs de terceros).
- Cabeceras de seguridad estrictas (CSP, HSTS, anti-clickjacking...).
Uso: python3 build_prod.py <salida> [config-json-de-prueba]
"""
import sys, os, json, shutil, subprocess, hashlib, re

SRC = '/home/claude/work/fe/nusal-netlify'
NM = '/home/claude/work/node_modules'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/nusal/public'
TEST_CONFIG = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None

shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT + '/vendor'); os.makedirs(OUT + '/assets')
html = open(SRC + '/index.html').read()

# 1) Código de la app: JSX → JS minificado
m = re.search(r'<script type="text/babel">([\s\S]*?)</script>', html)
jsx = m.group(1)
VENDOR = {
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': ('pdfjs-dist/build/pdf.min.js', 'pdf.min.js'),
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': ('pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'),
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js': ('exceljs/dist/exceljs.min.js', 'exceljs.min.js'),
    'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js': ('mammoth/mammoth.browser.min.js', 'mammoth.browser.min.js'),
}
for url, (src, name) in VENDOR.items():
    assert url in jsx, 'falta ' + url
    jsx = jsx.replace(url, '/vendor/' + name)
    shutil.copy(os.path.join(NM, src), OUT + '/vendor/' + name)
# Modo demostración (sin servidor): datos de ejemplo, sin llamadas a ninguna API
if TEST_CONFIG and TEST_CONFIG.get('demo'):
    a="const API_URL = (window.NUSAL_API_URL) || (window.NUSAL_CONFIG&&window.NUSAL_CONFIG.apiUrl) || 'http://localhost:3000';"
    b="      await apiFetch('/health');\n      DB.ready = true;"
    assert a in jsx and b in jsx
    jsx=jsx.replace(a,"const API_URL = '';  // modo demostración").replace(b,"      if(!API_URL) return false;\n"+b)
# PRODUCCIÓN: fuera del paquete todo lo de la demo (credenciales de prueba, pacientes, recetas y dietas ficticias)
PROD_BUILD = (TEST_CONFIG or {}).get('produccion', True) and not (TEST_CONFIG or {}).get('demo')
if PROD_BUILD:
    STRIP = [
        (r'^const ADMIN_EMAIL=.*$', 'const ADMIN_EMAIL="",ADMIN_PW="",ADMIN_NAME="";'),
        (r'^const MEDICO_EMAIL=.*$', 'const MEDICO_EMAIL="",MEDICO_PW="",MEDICO_NAME="";'),
        (r'^const DEMO_MEAL_BANK=\[.*\];$', 'const DEMO_MEAL_BANK=[];'),
        (r'^const DEMO_RECIPES=\[.*\];$', 'const DEMO_RECIPES=[];'),
        (r'^const DEMO_DIETS=\[.*\];$', 'const DEMO_DIETS=[];'),
        (r'^const DEMO_PATIENTS=\[.*\];$', 'const DEMO_PATIENTS=[];'),
    ]
    for pat, rep in STRIP:
        jsx, n = re.subn(pat, rep, jsx, count=1, flags=re.M)
        assert n == 1, 'no se pudo quitar de producción: ' + pat
open('/tmp/app.jsx', 'w').write(jsx)
subprocess.run(['node', '-e', """
const babel=require('@babel/core');const fs=require('fs');const {minify}=require('terser');
(async()=>{const c=babel.transformSync(fs.readFileSync('/tmp/app.jsx','utf8'),{presets:[['@babel/preset-react',{runtime:'classic'}]],compact:false}).code;
const r=await minify(c,{compress:{passes:2},mangle:{toplevel:false},format:{comments:false}});fs.writeFileSync('/tmp/app.min.js',r.code)})().catch(e=>{console.error(e);process.exit(1)});
"""], check=True, cwd='/home/claude/work')
app = open('/tmp/app.min.js').read()
if PROD_BUILD:  # comprobación: ni una credencial ni un paciente de demostración en el paquete publicado
    for bad in ['admin123', 'nusal123', 'maria123', 'pac123', 'María García', 'Dra. García', 'maria@email.com', 'admin@nusal.es', 'nutricionista@nusal.es']:
        assert bad not in app, 'queda contenido de demo en producción: ' + bad
digest = hashlib.sha256(app.encode()).hexdigest()[:10]
open(OUT + f'/assets/app.{digest}.js', 'w').write(app)

# 2) Librerías base, servidas desde el propio dominio (versiones fijadas)
BASE = [('react/umd/react.production.min.js', 'react.production.min.js'),
        ('react-dom/umd/react-dom.production.min.js', 'react-dom.production.min.js'),
        ('prop-types/prop-types.min.js', 'prop-types.min.js'),   # Recharts la necesita (antes faltaba)
        ('recharts/umd/Recharts.js', 'Recharts.js')]
for src, name in BASE: shutil.copy(os.path.join(NM, src), OUT + '/vendor/' + name)

# 3) index.html sin scripts en línea ni CDNs
head_end = html.find('<script src=')
page = html[:head_end]
page += '<script src="/config.js"></script>\n' + ''.join(f'<script src="/vendor/{n}"></script>\n' for _, n in BASE)
page += f'<script src="/assets/app.{digest}.js"></script>\n</body>\n</html>\n'
assert '<script>' not in page and 'unpkg.com' not in page and 'text/babel' not in page
open(OUT + '/index.html', 'w').write(page)

# 4) Configuración de la instalación (lo único que hay que editar)
cfg = TEST_CONFIG or {"produccion": True, "apiUrl": "/api",
       "clinica": {"titular": "", "nif": "", "direccion": "", "email": "", "telefono": "", "whatsapp": "",
                   "registroSanitario": "", "colegiado": "",
                   "proveedores": "Netlify, Inc. (alojamiento de la app y de su servidor; EE. UU., con las garantías del RGPD para transferencias internacionales) y Supabase (base de datos, región UE – París)"}}
open(OUT + '/config.js', 'w').write(
    '// ============================================================\n'
    '// NUSAL · Configuración (es el ÚNICO fichero que hay que editar)\n'
    '// ============================================================\n'
    '// apiUrl: "/api" (la API vive en esta misma web, en las funciones de Netlify). No lo cambies.\n'
    '// clinica: datos de la consulta para el aviso legal y la política de privacidad.\n'
    '//   Mientras falte alguno, la app lo muestra en naranja como «[Completar: …]».\n'
    '// produccion: déjalo en true (sin datos de demostración).\n'
    'window.NUSAL_CONFIG = ' + json.dumps(cfg, ensure_ascii=False, indent=2) + ';\n')

# 5) Cabeceras de seguridad y redirecciones
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self'; connect-src 'self' https://world.openfoodfacts.org; worker-src 'self' blob:; manifest-src 'self'; "
       "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests")
if TEST_CONFIG: open(OUT + '/_headers_csp.txt', 'w').write(CSP)  # solo para las pruebas locales
# Mismas reglas en formato estándar (_headers/_redirects): válidas en Netlify y en Cloudflare Pages
open(OUT + '/_headers', 'w').write('/*\n' + ''.join(f'  {k}: {v}\n' for k, v in [
    ('Content-Security-Policy', CSP), ('Strict-Transport-Security', 'max-age=63072000; includeSubDomains'),
    ('X-Frame-Options', 'DENY'), ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'strict-origin-when-cross-origin'),
    ('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()'),
    ('Cross-Origin-Opener-Policy', 'same-origin'), ('X-Robots-Tag', 'noindex, nofollow, noarchive')])
    + '/vendor/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    + '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    + '/config.js\n  Cache-Control: no-cache\n'
    + '/index.html\n  Cache-Control: no-cache\n')
open(OUT + '/robots.txt', 'w').write('# App privada con datos de salud: no debe aparecer en buscadores\nUser-agent: *\nDisallow: /\n')

# 6) Manifest, iconos (optimizados) y service worker
man = json.load(open(SRC + '/manifest.json'))
man.update({"description": "Tu espacio de nutrición y salud", "background_color": "#F2F2F7", "orientation": "any"})
json.dump(man, open(OUT + '/manifest.json', 'w'), ensure_ascii=False, indent=2)
from PIL import Image
for ic in ['icon-192.png', 'icon-512.png']:
    im = Image.open(SRC + '/' + ic).convert('RGBA'); im.save(OUT + '/' + ic, optimize=True)
shutil.copy(SRC + '/sw.js', OUT + '/sw.js')
tot = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print(f'Producción generada en {OUT} · app.{digest}.js {len(app)//1024} KB · total {tot//1024} KB')
