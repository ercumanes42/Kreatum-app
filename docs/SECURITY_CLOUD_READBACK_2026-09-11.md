# KREATUM — Lectura cloud de seguridad

Fecha: 11/09/2026. Revisión de solo lectura; sin despliegues, cambios de IAM, configuración MFA ni datos de clientes.

## Decisión histórica del gate y actualización actual

**NO-GO de publicación; validación técnica local aprobada.** Actualización de decisión: 11/09/2026 17:31:57 UTC. El gate `tmp/release-evidence/release-manifest.json` terminó con los diez checks técnicos PASS, exitCode 0 y cero pruebas omitidas; log `tmp/security-release-isolated-validation.log`. Sigue `releaseEligible:false` por cuatro controles operativos pendientes (MFA, alertas, staging y recuperación integral) y checkout dirty. La autorización para publicar no elimina estos bloqueos ni demuestra que K-02 esté desplegado. No se publicó el parche. El control de lectura de Rules sí quedó verificado por el coordinador; esta actualización documental no cambia estados de controles.

Actualización posterior al gate: las cuatro categorías de alertas ya llegaron al buzón y están confirmadas por el usuario; Access a las 16:04:11 UTC, Reports/Backups a las 18:43:20 UTC y Completion a las 18:43:21 UTC. Evidencia `SECURITY_ALERT_DELIVERY_2026-09-11.md`. Cierre/recuperación del incidente aún no comprobado. El candidato se preparó aisladamente en `tmp/security-staging-candidate-20260911`, rama `codex/security-remediation-2026-09-11`; npm ci raíz y Functions PASS, confirmado por coordinador, todavía sin despliegue. El usuario aplaza MFA sin cambio del gate y exige un nuevo GO antes de producción. El manifiesto histórico no se convierte por ello en elegible.

## Método y corrección de la limitación anterior

Actualización de alcance posterior a esa decisión histórica: el usuario aplaza MFA y autoriza finalizar candidato/staging, alertas y recuperación, exigiendo un nuevo GO antes de producción. La revisión automática rechazó incorporar la excepción MFA al gate; se restauró el gate anterior sin excepciones y MFA sigue `pending`. No hubo despliegue. Detalle del rechazo y decisión en `SECURITY_REMEDIATION_RUNBOOK.md`, sección «Decisión del usuario: aplazamiento de MFA y alcance staging». Esto no altera los resultados históricos de lectura siguientes.

Se consultaron por REST las releases y rulesets de Firebase Rules y la configuración de Identity Platform de ambos proyectos. Se utilizó la identidad ya configurada mediante un token de corta duración mantenido únicamente en memoria y el encabezado `x-goog-user-project` con el proyecto consultado. No se mostraron ni guardaron credenciales o datos de usuarios.

Las lecturas devolvieron respuestas válidas en ambos proyectos. El coordinador identificó que los 403 anteriores se debían a la ausencia del encabezado de proyecto de cuota; no son evidencia de falta de permisos IAM. Esta revisión confirmó que no fue necesario ampliar permisos. La lista de releases no tenía página adicional en ninguno de los proyectos.

Endpoints leídos:

- `GET firebaserules.googleapis.com/v1/projects/{project}/releases`
- `GET firebaserules.googleapis.com/v1/projects/{project}/rulesets/{ruleset}`
- `GET identitytoolkit.googleapis.com/admin/v2/projects/{project}/config`

## Releases y comparación exacta

Hashes SHA-256 calculados sobre los bytes UTF-8 del contenido de cada fuente devuelta por Rules, sin normalizar saltos de línea. La igualdad también se comprobó sobre el texto completo frente al archivo local.

| Entorno | Reglas | Actualización UTC | Ruleset | Igual al local |
|---|---|---|---|---|
| Producción, kreatum-dinamic | Firestore | 2026-08-14T14:50:19.162928Z | a4e96dfc-e739-4814-a19e-a8d5199d3700 | No |
| Staging, kreatum-dinamic-staging | Firestore | 2026-08-10T14:27:04.246364Z | bbdeeaa1-2014-47cf-a2fd-d370b781c558 | No |
| Producción | Storage | 2026-08-13T14:06:59.950232Z | 0d5947ba-5ec4-4caf-b8a5-397dfdf2a9c2 | Sí |
| Staging | Storage | 2026-08-09T14:45:22.301562Z | fff8737b-8a7a-44ee-ba71-5933454efb0f | Sí |

| Fuente | SHA-256 |
|---|---|
| Firestore producción | e182b3b31203153c2ff24826c43166e3e6c2b16a1aab5c72e517e484fc905bb6 |
| Firestore staging | 46f842ff61329e36dab32c83fa7781f76a1824156a94ed457eda90df7081eabd |
| Firestore local candidato | 79373ed00c46f5e3fd31be7cc6b74a1811ad3435cddfafcb57ac6c85e13e7970 |
| Storage local, producción y staging | 9582f34a1f5acf9e4740e0804de68133ce57959743c22832a620823d8f6a3c0e |

## Diferencias de seguridad K-02 confirmadas en fuente desplegada

Las referencias remotas siguientes son líneas del contenido recuperado de los rulesets anteriores, no líneas del candidato local.

| Control | Producción / staging desplegados | Candidato local firestore.rules |
|---|---|---|
| Sesión de participante y slot | `isWorkshopParticipant` (producción:153; staging:130) comprueba sesión activa/caducidad, pero no proveedor anónimo ni propiedad/vigencia del slot | Líneas 153–180: proveedor anónimo, tipos/vigencia de sesión, `ownsDeviceSlot` e `isAssignedParticipant` |
| Lecturas de equipo, ataques, defensas y soluciones | Dependen del equipo de la sesión sin revalidar propiedad de su reserva en esas lecturas | Líneas 406–453: exigen participante asignado y reserva vigente |
| Escritura de solución | Producción:445; staging:422: sesión y fase Conjugar, pero sin propiedad de reserva ni bloqueo tras ACK | Líneas 455–456: exige `isAssignedParticipant` y ausencia de ACK de la transición pendiente |
| Escritura de ficha del equipo | Ya comprobaba reserva y bloqueo tras ACK (producción:403; staging:380), pero no el nuevo control conjunto de sesión/slot | Líneas 413–416: usa el control conjunto antes de validar contenido de fase |

Conclusión limitada y verificable: las reglas activas **no contienen todavía el endurecimiento K-02 local**. Esto confirma la divergencia de autorización en la configuración real; no se realizó una explotación sobre partidas de clientes. La corrección debe publicarse junto con las Functions compatibles, después de aprobar pruebas y staging.

Staging también difiere de producción fuera de K-02: sus lecturas de informes usan `isWorkshopAdmin` (staging:439 y siguientes), mientras producción usa `canReadWorkshopReports` (producción:462 y siguientes). Debe validarse el cambio completo, no asumir equivalencia entre entornos.

Storage mantiene denegación de lectura/escritura directa del cliente en todas las rutas. La igualdad de Rules no demuestra por sí sola IAM del bucket, URLs firmadas ni seguridad del código servidor.

## MFA: estado y mínimo pendiente

Identity Platform devuelve `mfa.state = DISABLED` tanto en producción como en staging. Estado confirmado de la configuración del proyecto; no se consultaron datos de inscripción de personas ni se activó MFA.

Revisión frontend: `src/AdminApp.tsx:687` inicia sesión con correo/contraseña; `:688` solicita token y `:697–698` presenta errores genéricos. La búsqueda en fuente frontend/backend no encontró flujo de inscripción, desafío de segundo factor, resolución de `multi-factor-auth-required` ni comprobación de segundo factor en permisos. Activar MFA sin desarrollar y probar estos recorridos puede bloquear accesos legítimos.

Mínimo para proponer su activación, pendiente de diseño autorizado e implementación:

1. Definir roles obligatorios y un mecanismo de segundo factor; mantener intacto el ingreso anónimo de jugadores.
2. Incorporar inscripción guiada, confirmación y desafío al iniciar sesión, con cancelación/reintento y mensajes claros.
3. Establecer recuperación y sustitución del factor con verificación de identidad, auditoría y controles contra desbloqueos indebidos; no usar desactivación global improvisada.
4. Exigir y comprobar el segundo factor en servidor para las operaciones administrativas definidas, no solo ocultar botones.
5. Probar enrollment, login, sesión caducada, revocación, recuperación y aislamiento de roles en staging antes de cualquier activación productiva.

No se declara MFA implementado, obligatorio o probado.

## Límites y seguimiento

- Este documento sustituye únicamente la conclusión de «Rules/Auth no legibles por 403». Los documentos anteriores deben reconciliarse con este readback.
- No valida todavía la ejecución real de todos los permisos ni modifica Rules, Auth, IAM, App Check o producción.
- El fallo anterior de integración (3 PASS, 7 FAIL y 1 cancelado) es histórico. La ejecución terminada a las 17:31:57 UTC aprobó integración 11/11 con el runner aislado, Rules 21/21, E2E, carga, migración, lint, tipos, unidades y builds finales. No sumar resultados históricos a los actuales; cifras por batería en `SECURITY_REMEDIATION_RUNBOOK.md`.
- Dependencias del candidato: frontend sin avisos; Functions sin altos/críticos y con dos moderados tras la distribución local PPTX revisada. No equivale a aprobación de producción ni elimina los cuatro controles operativos pendientes.
- Lectura adicional de Storage staging, confirmada por el coordinador el 11/09/2026: cinco buckets observados; bucket de aplicación con UBLA=true, PAP=enforced, soft delete de siete días y versionado de objetos no habilitado. No se observó un bucket de backup separado dentro de ese inventario. Esto no demuestra ausencia universal de backups, ni descarta copias en otros proyectos; tampoco verifica recuperación de los informes.
- Lectura posterior de la base aislada security-restore-20260911: dos informes, seis referencias de artefactos y seis metadatos con SHA256 de 64 caracteres, tamaño y ruta válidos. Es una comprobación estructural; no acredita la integridad de los archivos.
- Las seis lecturas de metadata del bucket de aplicación staging por Google Storage JSON API con autenticación gcloud configurada y x-goog-user-project devolvieron 403 forbidden. Se confirmó una denegación real de storage.objects.get para la identidad conectada, distinta del problema anterior del encabezado de cuota en Rules/Auth. No se leyeron bytes ni se compararon hashes; no hay evidencia de archivos inexistentes. Stop de permisos: sin otras credenciales, atajos ni ampliación IAM. La recuperación integral permanece pendiente.
- Evidencia complementaria: E2E informes ampliado, 1/1 PASS en 32,6 segundos, valida PDF/PPTX/JSON antes/después de publicar el informe sintético y la inmutabilidad de bytes; log tmp/security-report-json-validation.log. Es ampliación del caso existente, no otro caso para sumar, y no es un despliegue. Después, el coordinador reconstruyó frontend y Functions con entorno de producción, ambos con exitCode 0 y sin publicar, para sustituir los artefactos demo dejados por E2E.
- Readback posterior confirmado por el coordinador: frontendMatchesGate=true y functionsMatchesGate=true. Ambos artefactos reconstruidos coinciden con los hashes del gate de las 17:31, sin despliegue y con releaseEligible=false.
- Mantener NO-GO hasta consolidar un candidato limpio, validar staging y cerrar con evidencia los controles operativos requeridos. El manifiesto de las 17:31:57 UTC es histórico y sigue releaseEligible=false; la coincidencia de hashes no cierra controles operativos ni incorpora automáticamente las pruebas posteriores. Actualizar evidencia y repetir las pruebas afectadas sobre el candidato final.
