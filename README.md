# Intercambio

Migración del sitio original de VNGAS a React, TypeScript, Tailwind CSS y Supabase, preparada para Vercel. Conserva el diseño minimalista de tarjeta central, tipografía Inter, botones negros y modo oscuro.

## Funcionalidades

- Registro, confirmación de correo, inicio/cierre de sesión y recuperación de contraseña.
- Eventos propios y eventos a los que te invitaron, con fecha completa, presupuesto y tipo de regalo.
- Borradores con participantes y dependientes asociados a un adulto.
- Invitaciones personales de un solo uso, con QR generado localmente y opción de compartir/copiar.
- Sorteo transaccional en PostgreSQL: nadie se regala a sí mismo y cada persona da y recibe una vez.
- Resultado privado por cuenta, revelado con confeti y tres preferencias de regalo más información extra.
- Reasignación con confirmación y archivo/restauración de eventos.
- Permisos RLS y resultados protegidos en un esquema privado.

## Desarrollo

Node.js 24 (o una versión compatible con Vite). Dependencias fijadas en package-lock.json.

```sh
npm ci
cp .env.example .env.local
# Completar las dos variables públicas de Supabase.
npm run dev
```

Variables del cliente: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. No usar una clave secreta ni `service_role` en una variable VITE_. `.env.local` no se versiona.

```sh
npm run build
npm test
npm run db:test
```

Las pruebas de base de datos usan PostgreSQL embebido con PGlite y roles reales; verifican aislamiento entre cuentas, invitaciones, dependientes, resultados privados y sorteos. Las pruebas del importador comprueban la conservación del historial, idempotencia y rollback. No requieren credenciales ni cambian datos reales.

## Backend

La implementación está en [supabase/migrations](supabase/migrations) y su contrato en [supabase/API.md](supabase/API.md). Las tablas `intercambio_events` e `intercambio_participants`, las funciones `intercambio_*` y el esquema `intercambio_private` evitan colisiones con otras aplicaciones.

El proyecto Supabase autorizado para esta instalación es **Stocka** (`tinxltuanitszizxysjb`). Comparte Supabase Auth con Stocka: un correo identifica la misma cuenta en ambas aplicaciones. El cierre de sesión desde Intercambio usa scope local. No se modifican las tablas de negocio de Stocka ni su URL principal de autenticación.

El organizador distribuye una invitación diferente a cada adulto. Para participar en su propio evento debe abrir **Invitaciones → su nombre → Usar este perfil**. Los dependientes se vinculan automáticamente a su responsable. Las listas de nombres no se publican para visitantes y el organizador no puede consultar automáticamente los resultados de otras personas.

## Despliegue e historial anterior

[Vercel y autenticación](docs/VERCEL.md) describe el alojamiento y los ajustes de correo/redirección. [Migrar datos de Firestore](docs/MIGRATION.md) describe cómo importar un respaldo sin trasladar PIN ni credenciales antiguas. El historial real no se incluye en el repositorio: necesita un respaldo y el UUID de la cuenta que lo administrará.

El sitio de GitHub Pages sigue disponible mientras se revisa la migración. Los enlaces `?id=` antiguos se buscan por `legacy_id` después de iniciar sesión si el evento ya fue importado; las invitaciones nuevas deben usar el dominio de Vercel y los enlaces personales.
