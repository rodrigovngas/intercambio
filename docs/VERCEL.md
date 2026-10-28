# Publicar Intercambio en Vercel

El frontend es una SPA de React con Vite. Supabase se encarga de Auth, PostgreSQL y las operaciones del sorteo. El alojamiento del frontend no necesita una contraseña de base de datos ni una clave administrativa.

## Destinos elegidos

La URL publicada es **https://intercambio-vngas.vercel.app/**. Vercel confirmó el despliegue como `READY` y se verificó una respuesta HTTP 200 y su vista de escritorio y móvil. El proyecto se llama `intercambio` (`prj_27eaqEi9p0EvJdcye0FaNcOcwcZd`). La base de datos autorizada es `Stocka` (`tinxltuanitszizxysjb`); la migración `20261027223953_intercambio_backend` quedó aplicada y registrada allí. Tablas y funciones usan el prefijo `intercambio_` y el esquema privado `intercambio_private`. Estos identificadores no son credenciales.

## Configuración del proyecto

El primer despliegue se hizo con los archivos fuente a través de la API de Vercel. El código está respaldado en la rama `codex/react-supabase` y el PR https://github.com/rodrigovngas/intercambio/pull/1. Para despliegues automáticos posteriores, conectar esa rama al proyecto de Vercel. La configuración es:

| Campo | Valor |
| --- | --- |
| Framework | Vite |
| Directorio raíz | Raíz del repositorio |
| Instalación | `npm ci` |
| Compilación | `npm run build` |
| Directorio de salida | `dist` |

El archivo `vercel.json` de la aplicación mantiene el fallback de rutas a `index.html` para poder abrir directamente enlaces de la SPA. Vercel admite despliegues desde Git y genera vistas previas para ramas. Fuente: [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## Variables públicas

Configura para el entorno que vayas a desplegar:

```text
VITE_SUPABASE_URL=https://REFERENCIA.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Vite incorpora los valores `VITE_*` al JavaScript durante la compilación, así que un cambio exige un despliegue nuevo. Estas dos variables identifican el proyecto y permiten el acceso cliente sujeto a RLS; nunca uses ahí `service_role`, claves secretas, una URL PostgreSQL o credenciales SMTP. En desarrollo local usa `.env.local`, ignorado por Git. Fuente: [Variables de entorno de Vite](https://vite.dev/guide/env-and-mode).

## Autenticación del organizador

Las pruebas SQL pasaron en PGlite y en Supabase con rollback de sus fixtures. En Authentication → URL Configuration, **conservar el Site URL de Stocka y sus URLs existentes**, porque el proyecto es compartido. Añadir a Redirect URLs `https://intercambio-vngas.vercel.app/` para los retornos explícitos de Intercambio; si se usará también el alias `https://intercambio-five.vercel.app/`, añadirlo de forma exacta. Para desarrollo pueden añadirse `http://127.0.0.1:5173/` y `http://localhost:5173/`. No permitir globalmente cualquier dominio de Vercel. Fuente: [Redirect URLs de Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

Intercambio no ofrece registro público: sólo inicia sesión el organizador existente, y los invitados usan NIP sin correo. Supabase conserva su configuración compartida con Stocka. El SMTP propio sigue pendiente para la recuperación de contraseña del organizador. El servicio predeterminado está destinado a pruebas: actualmente sólo envía a direcciones que pertenecen al equipo del proyecto y limita los envíos a dos por hora. Los datos SMTP se configuran en Supabase, nunca en el frontend, y el cambio afectará al correo de ambas aplicaciones. Fuente: [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Comprobación del despliegue

En la URL publicada, verificar inicio/cierre de sesión del organizador, creación de evento, invitación sin cuenta, creación/ingreso de NIP, preferencias, dependientes y sorteo. Verificar también archivo, restauración y las confirmaciones de eliminación sin borrar datos reales durante QA. Prueba además que esa otra cuenta no puede editar eventos ajenos ni consultar otros resultados. Revisa un teléfono y un navegador de escritorio, ambos temas y un enlace abierto directamente.

Si todavía no hay un proyecto de Supabase activo o falta su configuración, un frontend publicado es sólo una vista del trabajo; no implica que registro, persistencia y sorteos estén operativos. El historial de Firestore requiere además el procedimiento de [MIGRATION.md](MIGRATION.md).
