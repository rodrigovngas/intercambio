# Eventos con cuenta y privilegio de invitados por NIP

Todos los usuarios de Supabase Auth con correo verificado y una cuenta activa de Intercambio pueden crear sus propios eventos. La autorización de cada operación conserva la comprobación de propiedad; una cuenta no puede leer ni administrar eventos ajenos salvo su perfil de una invitación aceptada.

El perfil incluido en la lista privada `organizer_access` es el único que puede crear eventos con acceso de invitados por NIP. La lista se verifica mediante UUID y huella privada del correo confirmado. No se acepta un atributo editable del usuario ni un modo enviado por React sin esa comprobación.

## Entrada a la aplicación

`intercambio_account_status()` devuelve `{can_organize, can_use_pin, deleted}`. La primera entrada de un usuario verificado inscribe su cuenta en `intercambio_private.application_accounts`. Una baja conserva un marcador privado `deleted_at` para impedir que iniciar sesión vuelva a activar automáticamente la cuenta eliminada. Los usuarios sin confirmar o de Supabase Anonymous Auth no se inscriben.

`intercambio_is_organizer()` conserva el nombre anterior, pero ahora indica que la cuenta está activa; no significa que tenga el privilegio NIP. React debe usar `account_status` para obtener ambos permisos por separado.

## Crear eventos

Los eventos tienen `guest_access_mode: 'account' | 'pin'`, asignado en el servidor al crearlos y no editable por el cliente después.

- `intercambio_create_event(p_title,p_event_date,p_budget,p_gift_type,p_participants)` mantiene compatibilidad: el perfil privilegiado obtiene modo `pin` por defecto; los demás, `account`.
- `intercambio_create_event_with_access` recibe los mismos cinco argumentos más `p_guest_access_mode`. El perfil privilegiado puede elegir `account` o `pin`; cualquier otra cuenta que solicite `pin` recibe `42501`.

Los eventos anteriores del perfil privilegiado mantienen acceso por NIP. Las tablas expuestas siguen permitiendo únicamente SELECT sujeto a RLS; el navegador no puede cambiar la columna directamente.

## Abrir invitaciones

`intercambio_guest_preview(p_token)` funciona sin sesión y devuelve los metadatos del evento, identidad del destinatario y:

```ts
{
  guest_access_mode: 'account' | 'pin',
  has_pin: boolean,
  claimed: boolean,
  is_mine: boolean
}
```

En modo `pin`, la app usa el flujo NIP existente sin pedir cuenta. En modo `account`, debe pedir registro/inicio de sesión y comprobar `account_status` antes de confirmar la entrada con `intercambio_claim_participant(p_token)`. Esta reclamación es idempotente para la misma cuenta, exclusiva entre cuentas y limitada a un adulto por evento. Los dependientes siguen a su responsable. Un evento `pin` rechaza cualquier reclamación por cuenta nueva para evitar eludir el NIP.

Las RPC `guest_register`, `guest_login` y el contexto de sesiones de invitado rechazan eventos `account`, incluso si existiera una credencial o sesión privada antigua. El modo del evento se verifica en el servidor en cada acceso.

`get_participant_invites` siempre devuelve el enlace para que el organizador pueda compartirlo de nuevo. `claimed` indica NIP creado en modo `pin`, o perfil vinculado en modo `account`; `has_pin`, `account_linked` y `guest_access_mode` permiten representar la diferencia. `reset_pin` sólo funciona para el dueño de un evento `pin`.

## Resultado visto y sorpresa inicial

El estado definitivo está en `intercambio_private.assignments.revealed_at`. Las RPC de primer revelado (`get_my_assignment` y `guest_assignment`) siguen marcándolo al pulsar revelar.

- `guest_profile` incluye `profiles[].revealed` para el adulto y sus dependientes.
- `my_profile_state(p_event_id)` requiere cuenta y devuelve `{drawn_at, profiles:[{id,revealed}]}` exclusivamente para los perfiles propios y dependientes del solicitante. Ser organizador no revela los estados privados de otros participantes mediante esta RPC.
- `restore_my_assignment(p_participant_id,p_expected_drawn_at)` y `guest_restore_assignment(p_session_token,p_participant_id,p_expected_drawn_at)` devuelven `Assignment | null` y **nunca marcan un resultado como visto**.

Para restaurar automáticamente, enviar el `drawn_at` original sin convertirlo con JavaScript `Date`, que truncaría microsegundos. La restauración bloquea el evento en lectura y devuelve `null` si el sorteo cambió o la asignación actual todavía no se reveló. Por ello una respuesta atrasada no destapa el resultado de un nuevo sorteo. Reasignar borra las asignaciones anteriores y su estado de revelado; la sorpresa empieza otra vez.

## Borrar una cuenta

`delete_account('BORRAR CUENTA')` está disponible para cualquier cuenta activa. Elimina sus eventos propios y sus datos asociados. En eventos ajenos, conserva el evento, los nombres y las asignaciones, pero retira la vinculación de cuenta, preferencias y estado de revelado de sus perfiles; también rota sus invitaciones para revocar los enlaces anteriores. Elimina sus sesiones NIP vinculadas si existieran y marca su cuenta de Intercambio como eliminada.

La identidad compartida de Supabase Auth y las tablas de Stocka permanecen intactas. Si se elimina el perfil privilegiado, también se retira su permiso NIP privado.

## Verificación

`tests/db/mixed_access.sql` comprueba usuarios normales, privilegio NIP exclusivo, RLS, invitaciones con cuenta, rechazo de NIP en eventos normales, revelado persistente, restauración sin carreras tras reasignación y baja con preservación de eventos ajenos. Toda la suite se ejecuta dentro de `BEGIN`/`ROLLBACK`.
