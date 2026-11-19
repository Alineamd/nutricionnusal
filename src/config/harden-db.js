// ================================================================
// Blindaje de la base de datos (Supabase o cualquier PostgreSQL)
// ----------------------------------------------------------------
// · Activa Row Level Security (RLS) en todas las tablas de NUSAL, sin
//   políticas: nadie que no sea el dueño (el servidor de NUSAL) puede leer
//   ni escribir filas, aunque alguien consiguiera la clave pública de Supabase.
// · Retira todos los permisos a los roles públicos de Supabase (anon,
//   authenticated) y, si NUSAL usa su propio esquema, también el acceso al
//   esquema. En un PostgreSQL normal esos roles no existen y se ignora.
// El servidor sigue funcionando porque es el dueño de las tablas.
// ================================================================

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function hardeningSql(schema, tables) {
  if (!IDENT.test(schema)) throw new Error('Nombre de esquema no válido');
  const list = tables.filter((t) => IDENT.test(t));
  if (!list.length) throw new Error('Sin tablas que blindar');
  const arr = list.map((t) => `'${t}'`).join(',');
  const dedicated = schema !== 'public';
  return `DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY[${arr}]::text[] LOOP
    IF to_regclass(format('%I.%I', '${schema}', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', '${schema}', t);
      FOREACH r IN ARRAY ARRAY['anon','authenticated']::text[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM %I', '${schema}', t, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF ${dedicated ? 'true' : 'false'} THEN
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', '${schema}');
    FOREACH r IN ARRAY ARRAY['anon','authenticated']::text[] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', '${schema}', r);
      END IF;
    END LOOP;
  END IF;
END $$;`;
}

// Tablas de NUSAL = modelos de Prisma (el esquema no renombra tablas con @@map)
export function nusalTables(PrismaNs) {
  return Object.values((PrismaNs && PrismaNs.ModelName) || {}).filter((t) => IDENT.test(t));
}

export async function hardenDatabase(prisma, PrismaNs, schema) {
  const tables = nusalTables(PrismaNs);
  await prisma.$executeRawUnsafe(hardeningSql(schema, tables));
  return tables.length;
}
