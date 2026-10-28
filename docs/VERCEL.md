# Publicar Intercambio en Vercel

El frontend es una SPA de React con Vite. Supabase se encarga de Auth, PostgreSQL y las operaciones del sorteo. El alojamiento del frontend no necesita una contraseña de base de datos ni una clave administrativa.

## Destinos elegidos

El proyecto de Vercel creado para esta migración se llama `intercambio` (`prj_27eaqEi9p0EvJdcye0FaNcOcwcZd`). La base de datos autorizada por el propietario es el proyecto de Supabase `Stocka` (`tinxltuanitszizxysjb`). Las tablas y funciones nuevas usan el prefijo `intercambio_` y el esquema privado `intercambio_private` para convivir con la aplicación existente. Estos identificadores no son credenciales. La creación del proyecto de alojamiento por sí sola no confirma un despliegue operativo; la URL y el resultado de publicación deben verificarse al terminar.

## Configuración del proyecto

Usa el repositorio y la rama de esta migración en el equipo de Vercel elegido. La configuración esperada es:

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

## Supabase antes de abrir registros

Aplica las migraciones y verifica sus pruebas. En Authentication → URL Configuration configura `Site URL` con el dominio final HTTPS. Añade a Redirect URLs las direcciones exactas usadas por confirmación de correo y recuperación de contraseña y la URL local de desarrollo. Si necesitas vistas previas, autoriza un patrón limitado a tu propio proyecto/equipo, sin permitir globalmente cualquier dominio de Vercel. Fuente: [Redirect URLs de Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

Configura un proveedor SMTP propio en Supabase para registros públicos y recuperación. El servicio predeterminado de Supabase está destinado a pruebas: actualmente sólo envía a direcciones que pertenecen al equipo del proyecto y limita los envíos a dos por hora. Los datos SMTP se configuran en Supabase, nunca en el frontend. Fuente: [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Comprobación del despliegue

Antes de dar el sitio por operativo, verifica en la URL publicada: registro y confirmación por correo, inicio/cierre de sesión, recuperación, creación de un evento, invitación con otra cuenta, reclamación de perfiles, preferencias y sorteo. Prueba además que esa otra cuenta no puede editar eventos ajenos ni consultar otros resultados. Revisa un teléfono y un navegador de escritorio, ambos temas y un enlace abierto directamente.

Si todavía no hay un proyecto de Supabase activo o falta su configuración, un frontend publicado es sólo una vista del trabajo; no implica que registro, persistencia y sorteos estén operativos. El historial de Firestore requiere además el procedimiento de [MIGRATION.md](MIGRATION.md).
