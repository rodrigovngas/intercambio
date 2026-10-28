# Intercambio · contrato de datos

La migración añade solamente `public.intercambio_events`, `public.intercambio_participants`, las RPC `public.intercambio_*` y el esquema no expuesto `intercambio_private`. No modifica tablas de otras aplicaciones del proyecto.

Las operaciones iniciales de esta referencia requieren una sesión de Supabase Auth. Cada usuario registrado puede administrar sus propios eventos. `claim_participant` vincula invitados con cuenta en eventos de ese modo; los invitados de eventos NIP usan las funciones descritas en [PIN_API.md](PIN_API.md). Las reglas actuales de ambos modos están en [MIXED_ACCESS_API.md](MIXED_ACCESS_API.md). Usar la clave **publishable** en React; nunca claves secretas o `service_role`. Conservar `intercambio_private` fuera de **Data API > Exposed schemas**. No hay escrituras directas a tablas desde el navegador.

## Tablas para SELECT

`intercambio_events`: `id`, `owner_id`, `title`, `event_date` (fecha ISO completa), `budget` (texto, por ejemplo `$300` o `Libre`), `gift_type`, `status` (`draft` / `drawn` / `archived`), `invite_code`, `created_at`, `drawn_at`, `legacy_id`.

`intercambio_participants`: `id`, `event_id`, `name`, `is_child`, `user_id`, `guardian_id`, `wishes` (array de exactamente tres textos), `extra`, `created_at`, `legacy_id`.

RLS limita eventos al organizador o a una cuenta que ya reclamó un participante. El organizador ve los participantes del evento; los invitados ven solamente su propio perfil y sus dependientes. Un adulto puede reclamar un solo perfil por evento. Los dependientes no tienen cuenta, invitación propia ni `user_id`: siguen a su responsable adulto.

## RPC

Usar `supabase.rpc('intercambio_' + nombre, argumentos)`.

| Nombre | Argumentos | Retorno |
|---|---|---|
| `create_event` | `p_title`, `p_event_date`, `p_budget`, `p_gift_type`, `p_participants` | UUID del evento |
| `update_event` | `p_event_id`, `p_title`, `p_event_date`, `p_budget`, `p_gift_type` | void |
| `add_participant` | `p_event_id`, `p_name`, `p_is_child=false`, `p_guardian_id=null` | UUID participante |
| `remove_participant` | `p_participant_id` | void |
| `draw_event` | `p_event_id`, `p_expected_drawn_at=null` | nueva fecha de sorteo |
| `archive_event` | `p_event_id`, `p_archived=true` | void |
| `get_participant_invites` | `p_event_id` | JSON array de invitaciones |
| `preview_invite` | `p_token` | JSON de invitación |
| `claim_participant` | `p_token` | UUID de perfil reclamado |
| `get_my_assignment` | `p_participant_id` | JSON de destinatario |
| `save_wishes` | `p_participant_id`, `p_wishes`, `p_extra=''` | void |
| `get_event_preview` | `p_code` | JSON metadatos evento |

### Crear evento

```ts
await supabase.rpc('intercambio_create_event', {
  p_title: 'Cena de Navidad', p_event_date: '2026-12-24',
  p_budget: '$300', p_gift_type: 'Libros',
  p_participants: [
    { name: 'Ana' }, { name: 'Beto' },
    { name: 'Dani', is_child: true, guardian_index: 0 },
  ],
})
```

`guardian_index` es la posición original del adulto en el array, empezando en cero. Los nombres son únicos dentro del evento sin distinguir mayúsculas. Límite de 2–100 participantes al crear. Se crea un borrador: `draw_event` realiza el sorteo después. Las altas/bajas de participantes solamente se permiten antes del primer sorteo. Los metadatos del evento se pueden editar sin cambiar asignaciones.

### Invitaciones

`get_participant_invites` es exclusivo del organizador y devuelve `[{participant_id,name,token,claimed,revealed,has_pin,account_linked,guest_access_mode}]`. El token se conserva para volver a compartirlo; `claimed` indica NIP creado en modo `pin`, o cuenta vinculada en modo `account`. Los tokens se generan con dos UUID aleatorios seguros de PostgreSQL (244 bits aleatorios) y tienen 64 caracteres hexadecimales. Compartir mediante fragmento de URL, por ejemplo `/#invite=TOKEN`, para evitar enviarlos a registros HTTP o al encabezado Referer. Son credenciales de invitación: compartir cada uno solamente con su destinatario.

`preview_invite` devuelve `{event_id,title,event_date,budget,gift_type,participant_id,participant_name,claimed,is_mine}`. No devuelve otras identidades, deseos ni asignaciones. `claim_participant` requiere una cuenta verificada y activa, y sólo admite invitaciones de eventos con modo `account`. Las invitaciones de modo `pin` no pueden vincularse a una cuenta para eludir el NIP.

`get_event_preview` devuelve `{event_id,title,event_date,budget,gift_type,status}` para `invite_code`. El enlace general permite conocer el evento después de iniciar sesión, pero el acceso al perfil requiere la invitación individual del organizador.

### Sorteo y resultados

`draw_event` requiere ser organizador, bloquea el evento, genera una permutación aleatoria sin autorregalos, escribe todas las asignaciones de manera atómica y cambia a `drawn`. Las claves y restricciones garantizan que cada persona da y recibe exactamente una vez. Para reasignar un sorteo existente, confirmar en UI y enviar exactamente su `drawn_at` actual como `p_expected_drawn_at`. Un timestamp antiguo se rechaza. Se borran los estados de revelado al reasignar.

`get_my_assignment` devuelve `{participant_id,target_id,target_name,wishes,extra}` únicamente al titular del perfil o al responsable adulto de su dependiente. También registra `revealed_at` la primera vez. Invocar solamente después de tocar “Revelar”; el organizador no tiene acceso automático a los resultados ajenos. Las asignaciones y los tokens residen en tablas privadas sin permisos de lectura para el navegador.

`save_wishes` usa la misma autorización de titular/responsable. Cada deseo admite hasta 500 caracteres; `extra`, hasta 1000.

`archive_event(p_archived=false)` restaura el evento a `drawn` si ya tenía sorteo, o `draft` en otro caso. No elimina registros.

## Verificación

`tests/db/backend.sql` prueba aislamiento entre cuentas, permisos RLS y RPC, reclamación exclusiva e idempotente, dependientes, privacidad de resultados, tres deseos, sorteo biyectivo sin autorregalos, detección de reasignación obsoleta y restauración de archivo. Cada fixture se revierte con `ROLLBACK`.

Para un proyecto compartido, aplicar esta migración mediante la herramienta MCP y ejecutar los asesores de seguridad después. El test usa usuarios de `example.invalid` y debe ejecutarse únicamente en una base de pruebas o dentro de la transacción completa indicada.
