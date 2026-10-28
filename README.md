# Intercambio

Aplicación de intercambios de regalos de VNGAS, migrada a React, TypeScript, Tailwind CSS y Supabase. Conserva la tarjeta central, tipografía Inter y paleta monocromática del sitio original. El tema sigue automáticamente al dispositivo y las barras de scroll están ocultas sin desactivar el desplazamiento.

Sitio publicado: https://intercambio-vngas.vercel.app/

## Cuentas, eventos e invitados

Cualquier persona puede registrarse, iniciar sesión y crear sus propios eventos. En los eventos normales, los invitados también necesitan una cuenta para vincular su perfil y consultar su resultado. Los permisos del servidor mantienen privados los eventos y perfiles ajenos.

Sólo el perfil privilegiado configurado en el servidor puede elegir **NIP sin cuenta** al crear un evento. Esa excepción se aplica al evento completo: sus invitados abren su enlace personal o QR y crean un NIP de seis dígitos, sin registrarse. Ese perfil también puede elegir el acceso normal por cuenta. Los demás usuarios no pueden habilitar NIP, ni siquiera llamando directamente a la API. Cada adulto administra sus dependientes en ambos modos.

El NIP se verifica en el servidor y se guarda como hash bcrypt con sal. Los resultados y deseos de otras personas permanecen privados. Cinco intentos incorrectos bloquean el acceso durante quince minutos. Las sesiones de invitado vencen en doce horas y sólo se recuerdan dentro de la pestaña.

## Funcionalidades

- Eventos con fecha completa, presupuesto, tipo de regalo y participantes.
- Borradores editables antes del primer sorteo y dependientes vinculados a un adulto.
- Invitaciones personales con QR generado localmente, compartir y copiar enlace.
- Sorteo transaccional: nadie se regala a sí mismo y cada persona da y recibe una vez.
- Revelado privado la primera vez; después el resultado se restaura automáticamente al volver. Un sorteo nuevo vuelve a quedar oculto. Tres preferencias de regalo e información extra.
- Restablecer el NIP de un invitado conservando sus preferencias y resultado.
- Reasignación con confirmación, archivo/restauración y eliminación definitiva de eventos.
- Borrar la cuenta y los datos de Intercambio, conservando la identidad y los datos de Stocka.

Las acciones definitivas exigen escribir `ELIMINAR` o `BORRAR CUENTA` antes de confirmar. Borrar una cuenta de Intercambio elimina sus eventos, desvincula sus perfiles de eventos ajenos y revoca su acceso a esta aplicación; iniciar sesión de nuevo no restaura ese acceso automáticamente.

## Desarrollo

Node.js 24 o una versión compatible con Vite. Dependencias fijadas en package-lock.json.

```sh
npm ci
cp .env.example .env.local
# Completar las dos variables públicas de Supabase.
npm run dev
```

Variables del cliente: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Nunca usar claves secretas ni `service_role` en una variable VITE_. `.env.local` no se versiona.

```sh
npm run build
npm test
npm run db:test
```

Las pruebas usan PostgreSQL embebido con PGlite y pgcrypto real. Cubren aislamiento entre cuentas e invitados, bcrypt, intentos en solicitudes separadas, vencimiento/revocación de sesiones, dependientes, sorteos y borrados con rollback. El importador tiene pruebas de idempotencia y conservación del historial. Las pruebas locales no requieren credenciales ni modifican datos reales.

## Backend y datos

Las migraciones están en [supabase/migrations](supabase/migrations). El contrato actual de cuentas y modos de acceso está en [supabase/MIXED_ACCESS_API.md](supabase/MIXED_ACCESS_API.md); el acceso por NIP se describe también en [supabase/PIN_API.md](supabase/PIN_API.md), y [docs/PIN_ACCESS.md](docs/PIN_ACCESS.md) describe el uso y las eliminaciones. [supabase/API.md](supabase/API.md) conserva la referencia de las operaciones iniciales de eventos.

El proyecto Supabase autorizado es **Stocka** (`tinxltuanitszizxysjb`). Tablas y funciones de Intercambio usan su propio prefijo; NIP, sesiones, cuentas de la aplicación y privilegio de NIP están en `intercambio_private`, fuera del Data API. Borrar la cuenta de Intercambio no elimina `auth.users`, perfiles, membresías ni datos de negocio de Stocka.

Las migraciones de producción se registran una sola vez. No volver a ejecutar la migración de NIP tras una baja para recrear el acceso del organizador; cualquier recuperación requiere una decisión administrativa explícita.

## Despliegue e historial anterior

[Vercel y autenticación](docs/VERCEL.md) describe el alojamiento y los ajustes de recuperación de contraseña del organizador. El correo SMTP no es necesario para el acceso por NIP de invitados; su configuración sigue pendiente para confirmaciones de registro y recuperación de contraseña con direcciones externas al equipo de Supabase.

[Migrar datos de Firestore](docs/MIGRATION.md) describe la importación de un respaldo sin trasladar PIN ni credenciales antiguas. El historial real de Firebase todavía no se ha importado. El sitio original de GitHub Pages sigue disponible mientras se revisa la migración.
