# Migración del historial de Firebase

El código original guarda documentos en `events/{eventId}` y en su subcolección `participants`. Esta migración de la aplicación no copia automáticamente esos documentos. El historial debe exportarse desde una cuenta autorizada de Firebase, validarse y cargarse en el proyecto de Supabase elegido. No se accedió a los datos reales durante la preparación del importador.

## Qué se conserva

- Título, fecha, presupuesto y tipo de regalo del evento.
- Nombres, dependientes y su adulto responsable.
- Tres preferencias de regalo e información adicional.
- Asignaciones anteriores, si forman un sorteo completo: cada persona regala una vez, recibe una vez y no se regala a sí misma.
- Estado de resultado revelado. Firestore sólo guardaba un booleano, así que `revealed_at` representa el momento de importación, no una fecha histórica exacta. `drawn_at` sigue la misma convención.

Los PIN, hashes, contraseñas maestras y `secretKey` antiguos se descartan. Los adultos obtienen cuentas nuevas de Supabase y reclaman su perfil con una invitación nueva; importar un documento no crea una cuenta ni autentica a nadie. Tampoco se conservan enlaces antiguos: deben reemplazarse por las nuevas invitaciones. El dueño de todos los eventos de una ejecución es el UUID explícito indicado en `--owner`.

## Formato del respaldo

Se necesita un JSON normalizado, no los archivos binarios de una exportación administrada de Firestore. El administrador de Firebase puede construirlo con su SDK administrativo, incluyendo las subcolecciones. Conserva el respaldo original separado de la copia normalizada y fuera del repositorio.

```json
{
  "events": [
    {
      "id": "evento-firebase",
      "title": "Cena de Navidad",
      "date": "2026-12-24",
      "budget": "$300",
      "giftType": "Libros",
      "createdAt": "2026-10-27T12:00:00Z",
      "participants": [
        {
          "id": "persona-ana",
          "name": "Ana",
          "isChild": false,
          "targetId": "persona-luis",
          "wish1": "Libro de cuentos",
          "wish2": "",
          "wish3": "",
          "extra": "",
          "revealed": false
        },
        {
          "id": "persona-luis",
          "name": "Luis",
          "isChild": false,
          "targetId": "persona-ana"
        }
      ]
    }
  ]
}
```

`createdAt` es opcional: acepta ISO o un objeto Firestore con `seconds`/`_seconds`. Cuando falta, se usa la fecha de importación. La fecha del evento debe ser válida e incluir el año. El original podía generar fechas imposibles con sus selectores; corrige esas entradas antes de importar.

Para dependientes, `managedBy` debe apuntar al ID de un adulto del mismo evento. Si el dependiente antiguo todavía no tenía responsable, añade `guardianLegacyId` con el adulto correcto. No se asigna un adulto por suposición.

## Validar sin conectarse

```sh
node scripts/migrate-firestore.mjs /ruta/segura/respaldo.json --owner UUID_DEL_PROPIETARIO
```

Este es el comportamiento predeterminado: sólo valida y devuelve cantidades, sin nombres, deseos ni resultados. No lee credenciales, no abre una conexión y no escribe archivos. Comprueba IDs duplicados, fechas, dependientes y sorteos inválidos. Si el origen es otro proyecto de Firebase, añade `--source ID_DEL_PROYECTO` y conserva ese mismo valor en futuras ejecuciones.

Si decides descartar expresamente las asignaciones antiguas y volver a sortear, añade `--without-assignments`. Los eventos se importarán como borradores; se mantienen sus preferencias.

## Aplicar

1. Activa Supabase y aplica primero las migraciones del directorio `supabase/migrations`.
2. Crea y confirma la cuenta del propietario; copia su UUID desde Supabase Auth.
3. Usa un proyecto de prueba y compara las cantidades e información antes de hacerlo en producción.
4. Configura `INTERCAMBIO_DATABASE_URL` mediante un gestor de secretos o un archivo local ignorado, por ejemplo `.env.migration.local`. Obtén la conexión PostgreSQL del proyecto correcto. La conexión debe tener acceso a `auth.users`, tablas públicas de Intercambio y su esquema privado.
5. Ejecuta con Node compatible con `--env-file`:

```sh
node --env-file=.env.migration.local scripts/migrate-firestore.mjs /ruta/segura/respaldo.json --owner UUID_DEL_PROPIETARIO --apply
```

`pg` se necesita sólo para aplicar. La conexión remota usa TLS y valida el certificado; si requiere una CA específica, `INTERCAMBIO_DATABASE_CA` puede contener la ruta al certificado oficial. No desactives la verificación de TLS. No uses estas variables con prefijo `VITE_`, no las añadas a Vercel y no publiques el respaldo.

Una transacción cubre toda la ejecución. Cualquier error revierte las inserciones de esa ejecución. Los UUID se calculan de manera determinista y `legacy_id` identifica el origen: repetir el mismo archivo y propietario omite eventos ya importados, sin sobrescribir perfiles reclamados o cambios posteriores. El importador no sincroniza modificaciones de un respaldo ya cargado. Una colisión de propietario o identidad aborta la transacción.

Después de importar, comprueba como propietario que aparecen los eventos; reclama dos perfiles con cuentas distintas, verifica que cada cuenta ve sólo sus resultados y preferencias permitidas y distribuye invitaciones nuevas. Los adultos responsables reclamarán también la gestión de sus dependientes a través del perfil adulto. No desactives Firebase hasta terminar esa revisión y confirmar un respaldo recuperable.
