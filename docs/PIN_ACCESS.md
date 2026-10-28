# Acceso de invitados con NIP

Todos los usuarios pueden registrarse y organizar sus propios eventos. Sólo el perfil privilegiado configurado en el servidor puede habilitar invitados con NIP sin cuenta. Los eventos de los demás usuarios y los eventos configurados con acceso por cuenta exigen registro o inicio de sesión a los invitados. El privilegio se verifica en el servidor y no depende de ocultar botones.

## Para el organizador

1. Iniciar sesión con la cuenta organizadora.
2. Crear el evento, agregar adultos y vincular cada dependiente a su responsable. El perfil privilegiado puede elegir NIP o cuenta; los demás usan cuenta.
3. Abrir las invitaciones y compartir con cada adulto su enlace personal o QR.
4. Realizar el sorteo cuando la lista esté lista.

En eventos configurados con NIP, las personas invitadas no necesitan correo ni cuenta de usuario. Los enlaces de invitación son personales: sólo el invitado que tenga ese enlace puede iniciar el proceso de creación o validación de su NIP.

## Para el invitado

En la primera visita al enlace, elegir y confirmar un NIP de seis dígitos. En las siguientes visitas, usar ese mismo enlace y NIP. Los ceros iniciales forman parte del NIP. Después de entrar se puede revelar el amigo secreto la primera vez. Al volver a entrar, ese resultado se muestra directamente; al volver a sortear se restablece la sorpresa. También se pueden editar las tres preferencias de regalo, además de las de los dependientes vinculados al adulto.

El NIP no se guarda en el navegador ni se incluye en la URL. La sesión del invitado se conserva solamente en la pestaña actual y vence en doce horas. Cerrar la sesión o restablecer el NIP invalida el acceso correspondiente.

Si se olvida el NIP, el organizador puede restablecerlo desde la invitación del participante. Esto permite elegir uno nuevo y revoca las sesiones anteriores de ese adulto; conserva las preferencias y el resultado del sorteo.

## Protección y verificación

Supabase guarda un hash bcrypt con sal y costo 10, nunca el NIP original. Cinco intentos incorrectos bloquean temporalmente el acceso durante quince minutos. Los errores de autenticación devuelven una respuesta controlada para conservar el contador de intentos en la base de datos.

Las sesiones se identifican mediante tokens aleatorios de alta entropía; sólo se conserva su hash en el esquema privado. Las funciones de invitado comprueban el token, su vencimiento y el adulto o dependiente permitido en cada operación. Los invitados no pueden leer tablas privadas, crear eventos ni acceder al perfil de otra persona.

`npm run db:test` ejecuta primero la suite del backend original, y después la suite de acceso por NIP. Las pruebas usan PostgreSQL embebido mediante PGlite y la extensión real `pgcrypto`, sin simular bcrypt. Los datos de prueba se revierten y no envían correo.

El acceso con NIP sólo afecta a Intercambio. No se deshabilita el registro global de Supabase ni se eliminan cuentas de Stocka, que comparte el proyecto.

## Eliminaciones

Eliminar un evento exige escribir `ELIMINAR`. La operación borra ese evento y sus participantes, preferencias, invitaciones, NIP, sesiones y asignaciones; conserva los demás eventos.

Eliminar la cuenta de Intercambio exige escribir `BORRAR CUENTA`. Se eliminan los eventos del organizador y se revoca su acceso a esta aplicación. Se conservan la identidad compartida de Supabase Auth y los datos de Stocka. Tras esa eliminación, iniciar sesión otra vez con el mismo correo no recupera automáticamente el permiso para organizar eventos.

El acceso por cuenta, la selección del modo al crear eventos y la restauración del resultado están documentados en [MIXED_ACCESS_API.md](../supabase/MIXED_ACCESS_API.md).
