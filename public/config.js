// ============================================================
// NUSAL · Configuración (es el ÚNICO fichero que hay que editar)
// ============================================================
// apiUrl: "/api" (la API vive en esta misma web, en las funciones de Netlify). No lo cambies.
// clinica: datos de la consulta para el aviso legal y la política de privacidad.
//   Mientras falte alguno, la app lo muestra en naranja como «[Completar: …]».
// produccion: déjalo en true (sin datos de demostración).
window.NUSAL_CONFIG = {
  "produccion": true,
  "apiUrl": "/api",
  "clinica": {
    "titular": "",
    "nif": "",
    "direccion": "",
    "email": "",
    "telefono": "",
    "whatsapp": "",
    "registroSanitario": "",
    "colegiado": "",
    "proveedores": "Netlify, Inc. (alojamiento de la app y de su servidor; EE. UU., con las garantías del RGPD para transferencias internacionales) y Supabase (base de datos, región UE – París)"
  }
};
