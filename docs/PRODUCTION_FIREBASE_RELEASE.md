# Cierre Firebase de produccion

Este runbook no autoriza por si solo un despliegue. Todos los comandos con escritura remota requieren aprobacion explicita del responsable del release. No guardar tokens, secretos, correos, UIDs ni contenido de talleres en la evidencia.

## Bloqueos actuales

- El manifiesto candidato debe contener exactamente 69 endpoints. Los callables y triggers de datos deben estar en `europe-southwest1`; `markExpiredWorkshops`, `hardDeleteExpiredWorkshops` y `processReportGeneration` deben permanecer en `europe-west1`.
- Si produccion conserva Functions en `europe-west1`, el cambio de region es una migracion. No aceptar el borrado de las Functions antiguas hasta desplegar el cliente con `VITE_FIREBASE_FUNCTIONS_REGION=europe-southwest1` y completar el smoke.
- `functions/.env.kreatum-dinamic` debe conservar `KREATUM_ENFORCE_APP_CHECK=false` y contener exactamente estas URLs legales:

```dotenv
KREATUM_PRIVACY_POLICY_URL=https://gfs.es/politica-de-privacidad
KREATUM_TERMS_URL=https://gfs.es/aviso-legal
```

- El preflight avisa mientras los endpoints hereden la service account por defecto. El hardening IAM no puede considerarse terminado hasta que `node scripts/preflight-production-release.mjs --require-service-accounts` quede verde.

## 1. Candidato y puerta local

Trabajar desde el worktree principal, unido a la rama de release y sin cambios sin revisar:

```powershell
git branch --show-current
git status --short
git rev-parse HEAD
npm.cmd run verify:release
```

Editar el archivo protegido de entorno con un editor local visible; no copiar su contenido al chat ni a logs. Después regenerar el manifiesto con el entorno de produccion y ejecutar el preflight:

```powershell
npm.cmd --prefix functions run build:production
node scripts/preflight-production-release.mjs
```

El preflight debe informar `expected: 69`, `actual: 69`, cero endpoints ausentes o inesperados, cero regiones incorrectas, URLs legales correctas y enforcement `false`. El warning de service accounts bloquea solamente el hito de hardening, no debe ocultarse.

## 2. Autenticacion visible y segura

Abrir una ventana visible de PowerShell y ejecutar:

```powershell
firebase.cmd login --reauth --no-localhost
firebase.cmd login:list
firebase.cmd projects:list
```

Completar Google en el navegador y pegar el codigo solo en esa terminal. No usar `login:ci`, no generar tokens y no compartir contrasenas. Para operaciones `gcloud` y Admin SDK usar otra autenticacion visible:

```powershell
gcloud auth login
gcloud auth application-default login
gcloud config set project kreatum-dinamic
```

## 3. Inventario remoto de solo lectura

Guardar la evidencia en una carpeta local excluida de Git y revisar que no contenga datos personales:

```powershell
$releaseEvidence = Join-Path $PWD 'tmp\release-evidence\production'
New-Item -ItemType Directory -Force -Path $releaseEvidence | Out-Null
firebase.cmd functions:list --project kreatum-dinamic
gcloud functions list --gen2 --project=kreatum-dinamic --format='table(name.basename(),region,state,serviceConfig.serviceAccountEmail)'
gcloud projects get-iam-policy kreatum-dinamic --format=json | Set-Content -Encoding utf8 (Join-Path $releaseEvidence 'project-iam-before.json')
gcloud storage buckets list --project=kreatum-dinamic --format='table(name,location,uniform_bucket_level_access,public_access_prevention)'
gcloud firestore databases describe --database='(default)' --project=kreatum-dinamic
gcloud firestore backups schedules list --database='(default)' --project=kreatum-dinamic
gcloud firestore backups list --project=kreatum-dinamic --format='table(name,database,state)'
gcloud secrets versions list BREVO_API_KEY --project=kreatum-dinamic --filter='state=ENABLED' --format='value(name)'
gcloud secrets versions list INVITATION_CODE_PEPPER --project=kreatum-dinamic --filter='state=ENABLED' --format='value(name)'
vercel env ls production
```

No usar comandos que impriman valores de secretos. Confirmar en Vercel, sin copiarlos a evidencia, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_APPCHECK_SITE_KEY` y `VITE_FIREBASE_FUNCTIONS_REGION`.

## 4. App Check sin enforcement

Registro completado el 13 de agosto de 2026 en Firebase Console, proyecto `kreatum-dinamic`:

1. Abrir **Security > App Check > Apps**.
2. Seleccionar la app web real con ID `1:997151085311:web:4eb0963c4f75c293bfb2ca`.
3. Verificar que el proveedor registrado sea reCAPTCHA Enterprise y que la site key web basada en puntuacion incluya `kreatum-app.vercel.app`, sin `localhost`.
4. Mantener enforcement desactivado para Functions, Firestore, Storage y Authentication.
5. Desplegar el cliente, completar smoke y revisar **Security > App Check > APIs**. No activar mientras existan clientes legitimos sin token.

Rollback: mantener o volver a `KREATUM_ENFORCE_APP_CHECK=false`, redesplegar Functions afectadas y desactivar enforcement del producto en Console. App Check complementa Auth y Rules; nunca los sustituye.

## 5. Backup verificable

Usar un bucket de backup ya creado, privado, con UBLA y PAP, preferiblemente en un proyecto de recuperacion separado. Los nombres se introducen de forma interactiva para impedir que un placeholder se ejecute por accidente:

```powershell
$releaseId = Get-Date -Format 'yyyyMMdd-HHmmss'
$sourceBucket = Read-Host 'Bucket Storage exacto de kreatum-dinamic'
$backupBucket = Read-Host 'Bucket privado de backup, distinto del origen'
if (-not $sourceBucket -or -not $backupBucket -or $sourceBucket -eq $backupBucket) { throw 'Buckets invalidos' }
gcloud storage buckets describe "gs://$sourceBucket"
gcloud storage buckets describe "gs://$backupBucket"
gcloud firestore export "gs://$backupBucket/kreatum/$releaseId/firestore" --database='(default)' --project=kreatum-dinamic
gcloud storage rsync "gs://$sourceBucket/organizations" "gs://$backupBucket/kreatum/$releaseId/storage/organizations" --recursive
gcloud storage du "gs://$backupBucket/kreatum/$releaseId/**"
```

Una exportacion no basta: restaurar Firestore en una base nueva o proyecto aislado, copiar Storage a un bucket de recuperacion y comparar recuentos, membresias, cinco partidas y hashes de PDF/PPTX/JSON. No restaurar sobre `(default)` durante un incidente:

```powershell
$restoreProject = Read-Host 'Proyecto aislado de restauracion'
$restoreDatabase = "restore-$releaseId"
$restoreLocation = Read-Host 'Ubicacion Firestore del proyecto aislado'
gcloud firestore databases create --database=$restoreDatabase --location=$restoreLocation --type=firestore-native --project=$restoreProject
gcloud firestore import "gs://$backupBucket/kreatum/$releaseId/firestore" --database=$restoreDatabase --project=$restoreProject
gcloud firestore operations list --database=$restoreDatabase --project=$restoreProject
```

Registrar RPO, RTO, operador, ruta exacta y resultado del smoke de restauracion.

## 6. Despliegue controlado

Capturar primero el inventario de Functions y deployments de Vercel anteriores. Desplegar por capas; no mezclar hardening IAM o UBLA en esta ventana:

```powershell
firebase.cmd deploy --project kreatum-dinamic --only functions
firebase.cmd functions:list --project kreatum-dinamic
firebase.cmd deploy --project kreatum-dinamic --only firestore:indexes
firebase.cmd deploy --project kreatum-dinamic --only firestore:rules
firebase.cmd deploy --project kreatum-dinamic --only storage
vercel deploy --prod
```

Si Firebase propone borrar las Functions existentes de `europe-west1`, responder no y detener el release si las nuevas no estan ya sanas o el frontend sigue llamando a `europe-west1`. En migracion de region:

1. Crear/verificar las 66 Functions nuevas en `europe-southwest1`, manteniendo las antiguas.
2. Desplegar Vercel con `VITE_FIREBASE_FUNCTIONS_REGION=europe-southwest1`.
3. Completar smoke de dos tenants y observar errores/latencia.
4. Solo entonces borrar las duplicadas antiguas mediante nombres y regiones explicitamente revisados. No borrar las tres Functions que deben permanecer en `europe-west1`.

Rollback de aplicacion: usar `vercel rollback <deployment-url-anterior>` y redesplegar el commit/artefacto Firebase anterior documentado. No revertir datos en caliente; restaurar primero en aislamiento y reconciliar con procedimiento aprobado.

## 7. Resolucion comercial 5/5/0

Ejecutar desde el mismo commit y conservar solo los hashes emitidos:

```powershell
$env:KREATUM_MIGRATION_ALLOWED_PROJECTS = 'kreatum-dinamic'
npm.cmd --prefix functions run migrate:resolve-commercial -- --project kreatum-dinamic --organization <organization-id-real> --contracted 5 --used 5
npm.cmd --prefix functions run migrate:resolve-commercial -- --apply --project kreatum-dinamic --confirm-project kreatum-dinamic --organization <organization-id-real> --contracted 5 --used 5 --confirm-analysis-hash <analysis-hash> --reason 'Alta comercial GFS aprobada'
npm.cmd --prefix functions run migrate:resolve-commercial -- --verify --project kreatum-dinamic --organization <organization-id-real> --contracted 5 --used 5
Remove-Item Env:KREATUM_MIGRATION_ALLOWED_PROJECTS
```

Debe informar cinco partidas, cinco usadas, cero disponibles y `verified: true`. La operacion solo puede escribir la organizacion y su auditoria; no debe escribir `workshops`. Las partidas permanecen sin asignar/bloqueadas hasta que Joaquin y Tomas acepten sus invitaciones reales.

## 8. `platformAdmin` exclusivo y auditado

Seleccionar manualmente en Firebase Authentication la cuenta real JU, activa, verificada y con MFA. Copiar el UID en una variable local; nunca escribir correo o UID en logs. La herramienta preserva claims ajenos, bloquea un segundo `platformAdmin`, exige dry-run/hash/proyecto, revoca refresh tokens y crea `platformSecurityAuditEvents/<event-id>` antes de mutar Auth.

```powershell
$juUid = Read-Host 'UID real de JU'
$env:KREATUM_PLATFORM_ADMIN_ALLOWED_PROJECTS = 'kreatum-dinamic'
node functions/scripts/manage-platform-admin.mjs --grant --project kreatum-dinamic --uid $juUid
node functions/scripts/manage-platform-admin.mjs --grant --apply --project kreatum-dinamic --confirm-project kreatum-dinamic --uid $juUid --operator-uid $juUid --confirm-analysis-hash <analysis-hash> --reason 'Acceso de plataforma aprobado para operacion de produccion'
node functions/scripts/manage-platform-admin.mjs --grant --verify --project kreatum-dinamic --uid $juUid --event-id <event-id>
Remove-Item Env:KREATUM_PLATFORM_ADMIN_ALLOWED_PROJECTS
Remove-Variable juUid
```

El `operator-uid` es la referencia de aprobacion de aplicacion; Cloud Audit Logs conserva la identidad Google que ejecuta realmente la llamada. Tras el grant, cerrar sesion y volver a autenticar. Probar `/platform`, una callable de lectura, denegacion directa de Firestore/Storage y auditoria. Para revocar, repetir con `--revoke` y un motivo nuevo.

## 9. Hardening IAM y Storage en ventanas separadas

### Runtime service accounts

El codigo dispone de `KREATUM_RUNTIME_SERVICE_ACCOUNT`, pero el manifiesto debe demostrar `serviceAccountEmail` user-managed en los 69 endpoints. Antes de retirar `roles/editor`:

1. Añadir identidades user-managed separadas para gameplay, access, reports y tasks en las opciones de despliegue.
2. Conceder solo los permisos realmente observados. Firestore IAM no sustituye el aislamiento tenant de Functions/Rules.
3. `verifyInvitationCode` necesita `iam.serviceAccounts.signBlob` sobre su propia identidad. La firma V4 de descargas necesita permiso de lectura del objeto y capacidad de firma; la cola necesita `cloudtasks.tasks.create` y `iam.serviceAccounts.actAs` con alcance limitado.
4. Desplegar un grupo, ejecutar su smoke, observar logs y solo despues retirar Editor de esa identidad.
5. Exigir `node scripts/preflight-production-release.mjs --require-service-accounts` verde antes de declarar terminado el hardening.

Rollback IAM: conservar `project-iam-before.json`; reasignar temporalmente la identidad runtime anterior al grupo afectado y redesplegar solo ese grupo. No restaurar Editor a todas las cuentas como primer paso.

### PAP y UBLA

Obtener bucket e IAM antes de tocarlo:

```powershell
$bucket = Read-Host 'Bucket Storage exacto de produccion'
gcloud storage buckets describe "gs://$bucket" --format=json | Set-Content -Encoding utf8 (Join-Path $releaseEvidence 'storage-before.json')
gcloud storage buckets get-iam-policy "gs://$bucket" --format=json | Set-Content -Encoding utf8 (Join-Path $releaseEvidence 'storage-iam-before.json')
```

Aplicar PAP y UBLA por separado, con smoke PDF/PPTX/JSON entre ambos. PAP no bloquea signed URLs; UBLA desactiva ACL y no puede revertirse tras 90 dias:

```powershell
gcloud storage buckets update "gs://$bucket" --public-access-prevention
# smoke completo de informes y descargas
gcloud storage buckets update "gs://$bucket" --uniform-bucket-level-access
# repetir smoke completo
```

Rollback, solo tras revisar que no se reactivan bindings o ACL publicos:

```powershell
gcloud storage buckets update "gs://$bucket" --no-uniform-bucket-level-access
gcloud storage buckets update "gs://$bucket" --no-public-access-prevention
```

## 10. Criterio final

No declarar produccion lista sin: `verify:release` verde del mismo commit, preflight verde, backup restaurado, 69 Functions/regiones verificadas, migracion 5/5/0 verificada, `platformAdmin` unico y auditado, y smoke real con dos tenants/dos facilitadores, jugador/reconexion/cierre, PDF/PPTX/JSON, suspension y auditoria. App Check permanece sin enforcement hasta disponer de telemetria suficiente y una ventana de rollback.
