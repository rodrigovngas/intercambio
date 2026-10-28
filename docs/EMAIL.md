# Correo de autenticación con Resend

Estado actual: Resend todavía no está configurado. La cuenta no tiene un dominio
verificado y el propietario aún no cuenta con un dominio propio. El registro de
Intercambio conserva la confirmación por correo de Supabase.

## Requisito pendiente

Hace falta un dominio propio y acceso a sus registros DNS. Los subdominios de
GitHub Pages y Vercel no permiten publicar los registros necesarios. El remitente
de prueba `onboarding@resend.dev` sólo puede enviar al correo de la cuenta Resend;
no permite confirmar registros públicos.

Fuentes: [verificación de dominios](https://resend.com/docs/dashboard/domains/introduction)
y [restricción del remitente de prueba](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## Activación cuando exista el dominio

1. Agregar el dominio en [Resend](https://resend.com/domains) y publicar los registros
   DNS que indique el panel. Esperar a que aparezca como verificado.
2. Abrir [Resend → Integrations](https://resend.com/settings/integrations) y conectar
   Supabase con la cuenta del propietario.
3. Elegir el proyecto existente **Stocka** y el dominio verificado. No crear otro
   proyecto ni cambiar sus tablas, usuarios o URL principal de autenticación.
4. Definir una dirección del dominio y un nombre de remitente apropiados para
   ambas aplicaciones. El SMTP de Supabase se configura por proyecto: el cambio
   se aplicará a los correos de autenticación de **Intercambio y Stocka**.
5. Usar **Add API Key** en la integración y completar **Configure SMTP Integration**.
   Revisar sus permisos antes de autorizarla. No compartir la clave en el chat ni
   guardarla en el repositorio o en variables `VITE_*`.
6. Comprobar la confirmación de un registro externo y su retorno a
   `https://intercambio-vngas.vercel.app/`. Verificar también la recuperación de
   contraseña y el acceso de Stocka. Para una cuenta creada antes de activar SMTP,
   reenviar su confirmación mediante la API `auth.resend` de Supabase.

La integración oficial configura el proveedor de correo de Supabase; no requiere
un SDK Resend en React ni un endpoint de envío público.

Fuente: [integración oficial Resend con Supabase](https://resend.com/docs/knowledge-base/getting-started-with-resend-and-supabase).

## Configuración manual equivalente

Si se elige configurar SMTP directamente en Supabase, los parámetros son:

| Campo      | Valor                                                   |
| ---------- | ------------------------------------------------------- |
| Host       | `smtp.resend.com`                                       |
| Puerto     | `465`                                                   |
| Usuario    | `resend`                                                |
| Contraseña | API key de Resend, introducida directamente en el panel |
| Remitente  | Dirección del dominio verificado                        |

La clave sólo pertenece a la configuración del servidor de Supabase. No debe
añadirse a `.env.local` del frontend ni a Vercel para este flujo.

Fuentes: [Resend SMTP para Supabase](https://resend.com/docs/send-with-supabase-smtp),
[SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp)
y [reenviar confirmación](https://supabase.com/docs/reference/javascript/auth-resend).
