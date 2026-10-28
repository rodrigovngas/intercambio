# Acceso de invitados con NIP

La migración `guest_pin_access` mantiene el evento, participantes, deseos y sorteo existentes. No crea cuentas de Supabase Auth ni cambia la configuración de autenticación de Stocka. La cuenta verificada seleccionada por el propietario (UUID `ca6ba7f9-77c8-4795-9d00-fb493fa29bbb`) es el único perfil autorizado para habilitar NIP en sus eventos. Los demás usuarios pueden organizar eventos con invitados registrados; ver [MIXED_ACCESS_API.md](MIXED_ACCESS_API.md). El correo personal no se publica en el código ni en la documentación.

## Invitaciones personales

Cada adulto conserva su enlace `/#invite=TOKEN`. Su token de 64 caracteres hexadecimales identifica sólo ese perfil. La primera visita permite elegir un NIP de seis dígitos y confirmarlo en la interfaz. Las siguientes visitas al mismo enlace solicitan ese NIP. Los dependientes usan la sesión de su adulto responsable; no tienen otro NIP.

No se publica una lista general de participantes ni resultados. La vista previa de la invitación muestra únicamente los datos del evento y el nombre del destinatario, sin deseos ni asignación.

## RPC públicas de invitados

Las llamadas se hacen con `supabase.rpc('intercambio_' + nombre, argumentos)` y la clave publishable habitual. Admiten los roles `anon` y `authenticated`; la autorización real depende de la invitación o del token de sesión, no de una cuenta.

| Nombre | Argumentos | Retorno |
| --- | --- | --- |
| `guest_preview` | `p_token` | `{event_id,title,event_date,budget,gift_type,status,drawn_at,participant_id,participant_name,has_pin}` |
| `guest_register` | `p_token`, `p_pin` | Respuesta de acceso indicada abajo |
| `guest_login` | `p_token`, `p_pin` | Respuesta de acceso indicada abajo |
| `guest_profile` | `p_session_token` | `{event,participant_id,expires_at,profiles}` |
| `guest_assignment` | `p_session_token`, `p_participant_id` | `{participant_id,target_id,target_name,wishes,extra}` |
| `guest_save_wishes` | `p_session_token`, `p_participant_id`, `p_wishes`, `p_extra=''` | void |
| `guest_logout` | `p_session_token` | void |

Una respuesta de registro o inicio correcto es `{ok:true,session_token,expires_at}`. Un error esperado devuelve `{ok:false,error,retry_after_seconds?}`. Es un resultado JSON, no una excepción: así el contador de intentos fallidos se confirma en la transacción.

`guest_profile.event` contiene `{id,title,event_date,budget,gift_type,status,drawn_at,guest_access_mode}`. `profiles` contiene únicamente el adulto de la sesión y sus dependientes, cada uno `{id,name,is_child,wishes,extra,revealed}`. El primer resultado se solicita al pulsar Revelar; después se restaura mediante `guest_restore_assignment`, descrito en [MIXED_ACCESS_API.md](MIXED_ACCESS_API.md). Guardar deseos o revelar un `p_participant_id` ajeno se rechaza con SQLSTATE `42501`.

Una sesión caducada, revocada, de un evento archivado o desconocida produce SQLSTATE **`28000`** y el mensaje «Tu sesión de invitado terminó. Abre tu invitación e ingresa tu NIP de nuevo». La interfaz puede limpiar la sesión al recibir ese código. Los demás errores, por ejemplo un fallo de conexión, no deben borrar una sesión válida.

## Organizador

`intercambio_is_organizer()` retorna boolean para una cuenta activa de Intercambio. El privilegio NIP se consulta con `account_status().can_use_pin`; ver el contrato actualizado. Este privilegio comprueba tanto el UUID permitido como su correo confirmado en `auth.users`; no confía en metadatos editables ni en una comprobación del correo en React.

Además exige una fila en `intercambio_private.organizer_access`, inicialmente creada sólo para esa cuenta existente. La fila conserva únicamente su UUID y el SHA-256 del correo normalizado, calculado dentro de la base de datos al instalar la migración. El servidor compara ese valor con el correo confirmado actual; cambiarlo impide acceder aunque el UUID sea el mismo. La baja de Intercambio elimina esa fila sin borrar la identidad de Supabase Auth. Los roles del navegador no pueden consultar el hash ni recrear o modificar el acceso.

Las funciones de creación, edición, altas/bajas, sorteo, archivo, invitaciones y vinculación legacy exigen una cuenta activa de Intercambio y conservan las comprobaciones de propiedad. Cada usuario administra sus propios eventos; sólo el perfil privilegiado puede crear eventos NIP. Tener una cuenta en Stocka no concede acceso a eventos ajenos de Intercambio.

`intercambio_reset_pin(p_participant_id)` permite al organizador propietario restablecer sólo el NIP de un adulto. Revoca sus sesiones; no elimina deseos, dependientes ni asignaciones. El mismo enlace podrá usarse para elegir un nuevo NIP.

`intercambio_delete_event(p_event_id,p_confirmation)` elimina definitivamente un evento del organizador autorizado, sólo cuando `p_confirmation` sea exactamente `ELIMINAR`. Las relaciones de la base eliminan sus participantes, invitaciones, asignaciones, NIP y sesiones. La interfaz debe pedir confirmación antes de llamarla. `archive_event` continúa siendo la opción reversible.

`intercambio_delete_account(p_confirmation)` exige exactamente `BORRAR CUENTA`. Elimina todos los eventos del organizador y sus cascadas, además de su acceso en `organizer_access`. **Conserva la identidad de `auth.users`, credenciales compartidas y todas las tablas de Stocka**. La autorización vuelve a comprobarse en el servidor; una sesión de Supabase todavía abierta no recupera el acceso a Intercambio. La operación se serializa con la creación y administración de eventos para evitar que una solicitud concurrente deje datos después de la baja.

`claim_participant` se admite para usuarios registrados en eventos de modo `account`; se rechaza en eventos `pin`. No se pueden reclamar perfiles con una cuenta para eludir el NIP.

`get_participant_invites` mantiene `participant_id`, `name`, `token`, `claimed` y `revealed`, y añade `has_pin`, `account_linked` y `guest_access_mode`. El token siempre está presente para volver a compartir la invitación. En modo `pin`, `claimed` indica NIP creado; en modo `account`, indica cuenta vinculada. `has_pin` y `account_linked` muestran cada estado por separado.

## Protección del servidor

- El NIP sólo se almacena como bcrypt con sal aleatoria y costo 10, mediante `pgcrypto` en el esquema `extensions`.
- Cinco NIP incorrectos bloquean ese perfil durante 15 minutos. El bloqueo también impide acceder con el NIP correcto hasta que expire; el organizador puede restablecerlo.
- Los intentos concurrentes se serializan con bloqueo de fila. Los caminos bloquean primero el evento y después invitación, credencial o sesión para evitar interbloqueos con sorteo, borrado y reset.
- Cada acceso correcto entrega un token aleatorio de 244 bits con vencimiento de 12 horas. La base guarda sólo su SHA-256. El token bruto se mantiene en memoria o `sessionStorage`, nunca en una URL ni en registros de consola.
- `pin_credentials` y `guest_sessions` residen en `intercambio_private`, con RLS y sin permisos de tabla para `anon` o `authenticated`. Este esquema debe seguir fuera de los esquemas expuestos por la Data API.
- Los wrappers públicos son `SECURITY INVOKER`; las operaciones privilegiadas se mantienen privadas con `search_path=''`, grants por firma y comprobaciones de alcance. Los helpers que emiten sesiones o validan contexto no tienen EXECUTE para roles del navegador.

Una invitación continúa siendo una credencial personal: el organizador debe compartir cada enlace solamente con su destinatario. El NIP no se importa de la antigua versión; sus hashes de cliente no ofrecen las mismas garantías.
