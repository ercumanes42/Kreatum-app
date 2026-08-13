# Equipo, accesos y registro de actividad

## Contrato de autorización

- `owner` se muestra como **Administrador** y es el único rol que gestiona cuentas, invitaciones y el registro organizacional.
- `facilitator` se muestra como **Facilitador** y puede crear/controlar partidas y generar/publicar informes.
- No existe registro público, contraseña provisional ni elección de rol por la persona invitada.
- Los roles históricos `analyst` no son válidos. La migración los reporta y no los cambia silenciosamente.
- El dominio permitido es exactamente `gfs.es`, normalizado a minúsculas; no se admiten subdominios.

## Modelo de datos

- `organizations/{orgId}`: `allowedEmailDomains`, `minimumActiveOwners`, `recommendedActiveOwners`, estado y versión.
- `organizations/{orgId}/members/{uid}`: correo, nombre, apellidos, rol, estado, aceptación legal y fechas.
- `organizations/{orgId}/invitations/{emailHmac}`: correo normalizado, rol asignado, hash HMAC del código, estado, intentos, reenvíos y caducidad. Nunca contiene el código en claro.
- `organizations/{orgId}/auditEvents/{eventId}`: actor, acción, objetivo, estados antes/después y motivo. No contiene respuestas ni datos de participantes.
- Los `auditEvents` de cada partida se conservan. Un trigger idempotente crea el índice organizacional legible para las acciones aprobadas.

Todas las mutaciones de miembros, invitaciones y auditoría pasan por Functions. Firestore impide su escritura directa desde el cliente.

## Invitación y activación

1. Un Administrador crea la invitación con correo y rol.
2. El backend genera un código criptográfico de seis dígitos, almacena solo un HMAC y envía el código mediante Brevo.
3. El código caduca en 10 minutos, admite 5 intentos y queda invalidado al verificarlo. Cada reenvío rota el código y se permiten 3 por hora.
4. Tras verificar el código, el backend crea o recupera la identidad Firebase, marca el correo como verificado y entrega una sesión de activación limitada.
5. La persona define su contraseña en el cliente y acepta privacidad/condiciones.
6. El backend activa la membresía de forma transaccional e idempotente.

Desactivar una cuenta también deshabilita la identidad Firebase y revoca sus refresh tokens. El backend impide degradar o desactivar al último Administrador activo.

## Configuración de staging

### 1. Brevo

1. Autenticar `gfs.es` en Brevo mediante código Brevo, DKIM y el DMARC existente.
2. Registrar y verificar `KREATUM | GFS Consulting Group <accesos@gfs.es>` como remitente transaccional.
3. Crear una API key exclusiva para KREATUM. El plan gratuito admite hasta 300 envíos diarios; revisar el plan antes de superar ese volumen.
4. Configurar secretos mediante el prompt del CLI; no pegarlos en archivos ni en logs:

```powershell
firebase.cmd functions:secrets:set BREVO_API_KEY --project kreatum-dinamic-staging
firebase.cmd functions:secrets:set INVITATION_CODE_PEPPER --project kreatum-dinamic-staging
```

`INVITATION_CODE_PEPPER` debe ser aleatorio, exclusivo del entorno y tener al menos 32 caracteres. Rotarlo invalida códigos y activaciones todavía pendientes.

### Permiso para crear la sesión de activación

`verifyInvitationCode` crea un custom token de Firebase después de validar el código. El service account de ejecución necesita `iam.serviceAccounts.signBlob` sobre sí mismo. Concédele `roles/iam.serviceAccountTokenCreator` solo en ese service account, no en todo el proyecto:

```powershell
$runtimeServiceAccount = '<project-number>-compute@developer.gserviceaccount.com'
gcloud iam service-accounts add-iam-policy-binding $runtimeServiceAccount `
  --member=serviceAccount:$runtimeServiceAccount `
  --role='roles/iam.serviceAccountTokenCreator' `
  --project='<staging-id>'
```

Comprueba el service account efectivo con `gcloud functions describe verifyInvitationCode --gen2 --region=<region> --project=<staging-id> --format='value(serviceConfig.serviceAccountEmail)'`. Tras rotar `INVITATION_CODE_PEPPER`, redespliega juntas `inviteMember`, `resendInvitation`, `verifyInvitationCode` y `acceptInvitation`, y reenvía las invitaciones pendientes.

Configurar valores no secretos en `functions/.env.kreatum-dinamic-staging` antes de generar el manifiesto:

```dotenv
KREATUM_APP_BASE_URL=https://<frontend-staging>
KREATUM_ACCESS_EMAIL_FROM=KREATUM | GFS Consulting Group <accesos@gfs.es>
KREATUM_ACCESS_EMAIL_REPLY_TO=administracion@gfs.es
KREATUM_PRIVACY_VERSION=<version-aprobada>
KREATUM_TERMS_VERSION=<version-aprobada>
KREATUM_ENFORCE_APP_CHECK=true
```

La dirección predeterminada es `accesos@gfs.es`, verificada en Brevo. Las respuestas se dirigen a `administracion@gfs.es` para no depender de que `accesos@gfs.es` tenga buzón propio.

### 2. App Check / reCAPTCHA Enterprise

1. Crear una clave web basada en puntuación en reCAPTCHA Enterprise para el dominio de staging.
2. Registrar la app web en Firebase App Check con esa clave.
3. Configurar en el frontend de staging:

```dotenv
VITE_FIREBASE_APPCHECK_SITE_KEY=<site-key-publica>
VITE_PRIVACY_POLICY_URL=https://<url-legal-aprobada>/privacidad
VITE_TERMS_URL=https://<url-legal-aprobada>/condiciones
```

4. Construir el frontend y comprobar que las callables incluyen token App Check.
5. Ejecutar integración y E2E contra staging antes de desplegar Functions con `KREATUM_ENFORCE_APP_CHECK=true`.

El repositorio deja staging preparado para enforcement. No se debe desplegar esa configuración si el frontend de staging aún no tiene la site key registrada.

### 3. Validación sin correo real

La integración local usa `KREATUM_EMAIL_DELIVERY_MODE=suppressed` y un código fijo únicamente dentro del emulador. Esos valores se inyectan desde el runner de pruebas y no deben configurarse en staging ni producción.

El correo real solo puede considerarse validado después de enviar a una cuenta `@gfs.es` con el secreto y dominio Brevo reales, comprobar recepción, DKIM/DMARC, caducidad, reenvío y cancelación. Esta validación no se ha realizado desde el repositorio.

## Migración

Dry-run:

```powershell
npm --prefix functions run migrate:access -- --project <staging-id> --organization gfs --organization-name KREATUM
```

Apply explícito:

```powershell
npm --prefix functions run migrate:access -- --apply --project <staging-id> --confirm-project <staging-id> --organization gfs --organization-name KREATUM
```

La herramienta configura `allowedEmailDomains: ['gfs.es']`, mantiene activa `juanmartinez@gfs.es` como owner, completa metadatos seguros de membresías válidas y no elimina datos. Usuarios Auth sin membresía, documentos huérfanos, estados inválidos y roles `analyst` aparecen en el informe para resolución manual.

Resolución recomendada de un `analyst` histórico:

1. Confirmar con un responsable si necesita acceso operativo.
2. Si lo necesita, un owner debe asignar explícitamente `facilitator` o `owner` mediante el backend y dejar motivo en auditoría.
3. Si no lo necesita, desactivar la identidad/membresía y revocar sesiones mediante el backend.
4. Repetir dry-run hasta que no queden revisiones pendientes.
