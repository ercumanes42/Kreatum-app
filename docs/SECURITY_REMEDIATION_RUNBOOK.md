# KREATUM — Procedimiento de corrección y validación de seguridad

Fecha de preparación: 11/09/2026. Documento operativo asociado a `SECURITY_AUDIT_2026-09-11.md`.

## Alcance y autorización

- Producción web: https://kreatum-app.vercel.app/ y https://kreatum-app.vercel.app/admin.
- Backend de producción: `kreatum-dinamic`.
- Backend de staging: `kreatum-dinamic-staging`; verificar alias y destino efectivo antes de cada despliegue.
- Componentes afectados: autorización de accesos e invitaciones, sesiones/reservas de participantes, Functions y Firestore Rules, pruebas y puerta de release.
- El GO de implementación autoriza preparar las correcciones y verificarlas. La publicación en producción requiere un **GO independiente** sobre artefactos y evidencia concretos.
- No borrar partidas, modificar aportaciones ni reconstruir informes de clientes para probar seguridad. Emplear exclusivamente fixtures y cuentas de prueba autorizadas.
- No incluir tokens, claves, correos, nombres de usuarios o contenido de workshops en evidencias compartidas.

Este documento no certifica que el parche ya esté desplegado ni que todas las verificaciones estén cerradas. El coordinador debe completar la sección de evidencia al final.

## Decisión del usuario: aplazamiento de MFA y alcance staging

Decisión posterior comunicada por el coordinador el 11/09/2026: el usuario autoriza terminar la versión final, staging, alertas y recuperación; aplaza expresamente MFA para este cierre y exige un nuevo GO antes de producción. Esta instrucción sustituye cualquier autorización previa de publicación citada más abajo como antecedente. No se declara MFA implementado ni verificado: continúa el riesgo de acceso administrativo sin segundo factor.

El intento de representar ese aplazamiento como excepción limitada al control MFA fue rechazado por la revisión automática de permisos. Motivo recibido:

> El parche convierte el aplazamiento de MFA en una excepción que puede hacer elegible la publicación en producción y elimina la exigencia técnica de un GO separado, excediendo la autorización del usuario y debilitando persistentemente el control de seguridad.

Se detuvo el intento, sin vías alternativas. Se revirtieron únicamente los cambios de gate de ese intento a la versión anterior: todos los controles siguen exigiendo PASS con evidencia y MFA conserva `pending`; no hay nuevo gate staging ni excepción aplicada. El aplazamiento está documentado, pero no aceptado por la herramienta de aprobación. El coordinador debe comunicar esta limitación y solicitar dirección para resolverla; mientras tanto pueden continuar las comprobaciones independientes autorizadas. No se publicará en producción sin el nuevo GO y las condiciones de seguridad aplicables.

## Correcciones que deben viajar juntas

| Hallazgo | Comportamiento requerido | Archivos y controles relevantes |
|---|---|---|
| K-01: efecto global desde una empresa | Desactivar/reactivar cambia la membresía de esa empresa. No cambia `Auth.disabled` ni revoca sesiones globales. Cancelar una invitación no revoca sesiones de otras empresas. Una invitación nunca levanta un bloqueo global. | `functions/src/access/accessFunctions.ts`; regresiones de accesos |
| K-02: equipo reasignado | Reingresar no conserva permisos sobre un equipo de otro dispositivo. Toda lectura/escritura privada exige la reserva y sesión vigentes que correspondan. Ataques, defensas y soluciones siguen el mismo criterio. El bloqueo de escrituras tras confirmación de transición debe mantenerse. | `functions/src/index.ts`, controles de reservas de participantes y `firestore.rules` |
| K-03: permisos obsoletos durante una operación | Invitación, reenvío, cancelación, cambio de rol y cambio de estado vuelven a validar al owner dentro de la transacción, antes de devolver una respuesta idempotente. | `functions/src/security/organizationOwnerAuthorization.ts` y `functions/src/access/accessFunctions.ts` |

Preservar los contratos de API, códigos de sala, fases, contenido del workshop y perfiles existentes. No migrar datos históricos como parte implícita de este parche.

## Preparación de release

1. Registrar el commit o referencia y el conjunto exacto de cambios; separar los cambios previos del usuario. No desplegar el checkout completo sin revisar qué incluye.
2. Registrar proyecto, región, lista de Functions afectadas, cuenta de servicio, hashes de artefactos y versión de Rules. No dar por hecho que los alias locales apuntan al destino correcto.
3. Confirmar que el artefacto contiene tanto K-01/K-03 como K-02. Las pruebas sobre fuente local no prueban el contenido del bundle que se publica.
4. Ejecutar lint, tipos, unidades, integración con emuladores y pruebas de reglas. Registrar omisiones: una prueba omitida no cuenta como aprobada.
5. Ejecutar auditoría de dependencias sobre el lock y artefacto finales. Una excepción vencida, sin responsable o que no corresponda al riesgo detectado debe bloquear el release.
6. Preparar una versión de recuperación que conserve las correcciones de autorización. No usar automáticamente como rollback la versión vulnerable anterior.
7. Revisar las copias de seguridad y procedimiento de recuperación antes de publicar. Un backup READY no demuestra por sí solo que pueda restaurarse correctamente.

No completar artificialmente la puerta de release si faltan evidencias, acceso autorizado o pruebas. Registrar el bloqueo y su alcance.

## Validación y despliegue en staging

Para las pruebas locales de Functions, crear `functions/.secret.local` a partir de `functions/.secret.local.example`. Los valores de la plantilla son sintéticos y exclusivos del emulador; no son credenciales reales y no deben desplegarse. El archivo local está excluido de Git. Esto evita que el emulador intente consultar Secret Manager del proyecto demo para resolver `INVITATION_CODE_PEPPER` y `BREVO_API_KEY`. Ejecutar las pruebas con el modo de emulador y envío de correo suprimido; no introducir secretos productivos para resolver un fallo del entorno local.

Una vez superadas las comprobaciones locales y de emuladores:

1. Usar dos empresas y cuentas owner/facilitador/participante de prueba. Comprobar que no corresponden a clientes reales.
2. Desplegar Functions y Rules del mismo paquete revisado. Anotar qué se publicó y a qué proyecto.
3. Reproducir la matriz siguiente desde navegador y llamadas directas autorizadas; comprobar denegaciones y el funcionamiento legítimo.
4. Verificar móvil/escritorio, reconexión, cierre y generación/descarga de PDF y PPTX con datos sintéticos.
5. Revisar logs sanitizados, errores y latencia. Confirmar que los rechazos de seguridad esperados no se confunden con fallos internos.
6. Comprobar recepción de la alerta de prueba en el canal de staging y su recuperación. Eliminar únicamente fixtures de prueba identificados cuando proceda.
7. Adjuntar evidencia y decidir si se propone GO de producción. La publicación en staging no concede automáticamente ese GO.

## Matriz mínima de aceptación

| Caso | Acción y resultado esperado | Entorno mínimo | Evidencia a registrar |
|---|---|---|---|
| K-01 / dos empresas | Usuario pertenece a A y B; owner A lo desactiva. A rechaza acceso, B sigue disponible y la identidad global sigue habilitada. | Emulador + staging | Resultado de ambos accesos; estado sanitizado |
| K-01 / reactivación | Reactivar membresía A no modifica la membresía B ni un bloqueo global existente. | Emulador + staging | Antes/después limitado a flags |
| K-01 / invitación | Código correcto de invitación para una cuenta globalmente bloqueada: rechazar; no emitir token ni activar membresía. | Prueba aislada + staging autorizado | Denegación y ausencia de cambios |
| K-01 / bloqueo concurrente | Bloquear identidad entre comprobación inicial y aceptación: rechazo al revalidar; ninguna acción debe poner `disabled:false` en una identidad existente. | Prueba aislada/emulador | Intercalado controlado |
| K-01 / cancelación | Cancelar invitación de una cuenta compartida no revoca las sesiones de B. La invitación cancelada ya no se acepta. | Emulador + staging | Ambos resultados |
| K-03 / revocación | Retirar permisos al owner después del preflight y antes de la transacción: rechazar las cinco operaciones sensibles. | Prueba aislada/emulador | Cada operación y motivo |
| K-03 / reintento | Repetir clave idempotente después de revocar owner: volver a autorizar antes de devolver datos guardados. | Prueba aislada/emulador | Rechazo esperado |
| K-02 / reasignación | A caduca, B ocupa su equipo y A reingresa con un slot libre: A no recupera el equipo de B. | Emulador + staging | Reserva, sesión y respuesta |
| K-02 / llamada directa | A intenta leer/escribir solución, modificar/borrar ataque y guardar defensa del equipo de B: rechazo en servidor y Rules. | Emulador + staging | Operaciones denegadas |
| K-02 / uso legítimo | B conserva lectura/escritura; un jugador válido puede reconectar sin perder aportaciones. | Emulador + staging | Recorrido completo |
| Transición y cierre | Confirmación, caducidad, desconexión y cierre no permiten escrituras tardías ni dejan jugadores bloqueados indefinidamente. | Emulador + staging | Estado final y datos conservados |
| Aislamiento | Facilitador A no obtiene partidas/informes B ni partidas ajenas no asignadas; owner A permanece limitado a A. | Emulador + staging | Denegaciones por rol |
| Informes | PDF/PPTX correctos, descarga autorizada, denegación sin sesión y entre empresas; sin pérdida de contenido de prueba. | Staging | Archivos sintéticos y resultados |
| Release | Gate bloquea vulnerabilidad no permitida, excepción vencida, evidencia ausente y batería incompleta. | Local | Resultados y manifiesto |
| Alertas | Incidencia sintética en staging llega al responsable; recuperación queda registrada. | Staging | Hora de emisión/recepción/recuperación |
| Recuperación | Restaurar backup en destino aislado y validar estructura, recuentos e integridad sin contactar servicios productivos. | Entorno aislado | Resultado y limitaciones |

Las pruebas aisladas con dobles comprueban lógica de handlers; no sustituyen el SDK, transacciones reales, Rules desplegadas ni el navegador.

## Producción: GO y ventana coordinada

Condiciones previas:

- Matriz requerida aprobada y artefactos identificados.
- Destino de Functions y Rules confirmado; comparación con lo desplegado y acceso autorizado a su configuración.
- Canal de alertas operativo y responsable de intervención disponible.
- Cero workshops activos, comprobado al iniciar la ventana. Coordinar con facilitadores y comprobar nuevamente antes del cambio; no cerrar partidas ajenas para crear la ventana.
- Riesgos pendientes presentados al responsable. El GO debe indicar alcance y excepciones aceptadas; no equivale a declarar riesgo cero.

Secuencia propuesta, a validar con los artefactos concretos:

1. Aplicar primero las Rules restrictivas compatibles y después las Functions corregidas, dentro de la misma ventana sin partidas activas. Si una dependencia exige otro orden, demostrar previamente en staging que ninguna fase intermedia amplía permisos.
2. Si falla un paso, mantener la contención y detener la apertura de nuevas partidas. No dejar una mezcla de versiones sin analizar.
3. Verificar versiones, hashes, estado de Functions y cuenta de servicio. Confirmar que no se alteró App Check, IAM o política de almacenamiento fuera del alcance aprobado.
4. Ejecutar smoke tests autorizados con una partida de prueba identificada: ingreso, equipo, escritura, cambio de fase, cierre e informe.
5. Revisar denegaciones esperadas, errores internos y latencia. Autorizar el uso normal solo tras completar las verificaciones.
6. Registrar hora, operador, versión anterior/candidata, resultados y decisión.

App Check no se activa en bloque como parte de este parche. Mantener la decisión existente hasta disponer de tráfico representativo, más del 99 % verificado, cobertura de flujos críticos y ausencia de fallos relevantes. Un eventual canary necesita su propia observación y rollback; Firestore/Storage no se activan por arrastre.

## Contención y rollback

Disparadores: pérdida de acceso legítimo, aceptación de accesos no autorizados, corrupción/inconsistencia de aportaciones, errores repetidos de transición o informes, o publicación parcial incompatible.

1. Detener la continuación del rollout y coordinar una pausa de nuevas partidas/acciones afectadas con el responsable.
2. Conservar logs sanitizados, versión y correlaciones. No resetear workshops ni borrar datos para eliminar el síntoma.
3. Preferir corrección hacia delante o una versión de recuperación previamente probada que mantenga K-01/K-02/K-03.
4. **No restaurar el paquete vulnerable completo ni relajar Rules para recuperar funcionamiento.** Si no existe versión segura de recuperación, mantener contenida la acción afectada mientras se corrige.
5. Functions y Rules se recuperan como conjunto compatible. Verificar de nuevo acceso legítimo y denegaciones multiempresa/equipo.
6. La restauración de datos es una operación separada, excepcional y autorizada sobre una necesidad demostrada; no es el rollback normal de código.
7. No reactivar globalmente cuentas ni restituir privilegios retirados como atajo de recuperación.

## Pendientes que no cierra este parche

### MFA y acceso a configuración

Las lecturas de Identity Platform y Rules devolvieron 200 al incluir `x-goog-user-project`; los 403 previos no demostraban falta de permisos IAM. No se amplió IAM. Readback independiente: `docs/SECURITY_CLOUD_READBACK_2026-09-11.md`. MFA está DISABLED en ambos proyectos y faltan los recorridos de inscripción y desafío de segundo factor. Su implementación, activación y validación siguen pendientes.

El control `deployed-rules` se considera verificado exclusivamente por lectura y comparación: Firestore desplegado todavía no contiene K-02; `staging-validation` continúa pendiente y controla la publicación/validación del candidato. Storage coincide con la fuente local.

Comprobar MFA de administradores, recuperación, reautenticación para acciones sensibles, revocación de tokens existentes y concordancia de Rules locales/desplegadas. La comprobación de `Auth.disabled` en invitaciones no sustituye esas verificaciones.

### Dependencias sin parche disponible

La auditoría inicial identificó avisos altos transitivos en el generador de documentos. El coordinador verificó después el candidato local con dependencia vendorizada: 0 altos y 2 moderados; documentación en `docs/PPTX_VENDOR_MAINTENANCE.md`. Esto no demuestra publicación ni validación integral del artefacto final. Mantener seguimiento del componente vendorizado y repetir el análisis sobre el candidato definitivo.

Cuando no exista parche compatible, documentar alcanzabilidad, mitigación verificable, alternativa técnica, responsable y vencimiento. El uso actual de imágenes internas reduce una superficie concreta, pero no elimina el aviso. No marcar la dependencia como corregida mediante una excepción y no degradar silenciosamente la puerta de release.

### Restauración aislada

Probar Firestore/Storage en un proyecto o destino aislado, sin credenciales cliente ni permisos innecesarios. Evitar activación de triggers, tareas, correos o integraciones que afecten producción. Verificar selección de backup, estructura, recuentos e integridad; medir recuperación. No volcar contenido personal a los logs. Registrar limpieza del entorno de prueba cuando esté autorizada.

### Alertas

El coordinador confirmó cuatro políticas creadas en staging y el canal `15654231018987484790` en estado VERIFIED mediante el código proporcionado por el usuario. Políticas: acceso `5904356453047946880`, cierre `7364924856207147192`, informes `12199825822163392045` y backups `5904356453047947187`.

Antecedente: el probe `security-alert-20260911`, emitido a las 15:46 UTC, coincidió con el filtro revisado, pero el usuario indicó entonces que no lo recibió. No se atribuye una causa definitiva a esa primera ausencia. Que el filtro coincida o el canal esté verificado no demuestra recepción; el estado actual se acredita con las recepciones posteriores detalladas abajo.

Se envió un segundo probe, `attempt2`, tras esperar la propagación de la configuración. Posteriormente el usuario aportó la captura `Captura de pantalla 2026-09-11 180438.png`: muestra el correo de KREATUM security access, proyecto staging, revisión sintética security-alert-probe e inicio del incidente 11/09/2026 16:04 UTC. **Recepción de la alerta de acceso confirmada por evidencia del usuario.** Es una prueba controlada, no un fallo real de acceso. No demuestra recepción de las otras tres políticas ni recuperación del incidente.

Antes de recibir esa confirmación, el coordinador desactivó las cuatro políticas. Posteriormente las reactivó para pruebas de staging. La emisión de tres probes a las 17:15:25 UTC, correlación `security-validation-20260911-171525`, no acreditó entrega y se conserva como antecedente, no como evidencia de recepción.

Estado actual: las cuatro recepciones están verificadas mediante consulta autorizada del buzón y capturas del usuario; detalle en `SECURITY_ALERT_DELIVERY_2026-09-11.md`. Access llegó a las 16:04:11 UTC; Reports y Backups a las 18:43:20 UTC; Completion a las 18:43:21 UTC. Estas tres últimas corresponden al probe `security-validation-20260911-184242`, emitido a las 18:42:42.425 UTC. Las cuatro políticas están habilitadas y usan el canal verificado de staging. El cierre/recuperación del incidente no está comprobado: `autoClose=1800s` no es prueba de recuperación. No se publicaron políticas en producción.

`evaluateBackupFreshness` existe únicamente como implementación y prueba local; no hay scheduler desplegado para esa función. La política de backups no demuestra por sí sola que exista un emisor periódico de su señal.

Cubrir errores/latencia de acceso, cierre e informes y fallos operativos relevantes. Confirmar expresamente qué cubren las cuatro políticas; no asumir que cubren backups, cuotas o todos los flujos. Evitar datos personales en condiciones, etiquetas y notificaciones.

Cobertura del candidato local comprobada en `scripts/lib/security-alert-policies.mjs` y sus cuatro pruebas en `scripts/security-alert-policies.test.mjs` (incluidas en las pruebas de scripts; no sumar de nuevo):

- Acceso: el filtro ya incluye `selectTeam` y `heartbeatParticipantSession`, además de ingreso, recuperación e invitaciones.
- Informes: ya incluye creación de snapshots (`generateReportSnapshot`, `generatePlatformReportSnapshot`), publicación (`publishReport`) y consulta de estado (`getReportJob`, `getPlatformReportJob`), además de colas, procesamiento y descarga.
- Acceso, cierre e informes: la condición actual es `severity>=ERROR OR httpRequest.status>=500`. No comprueba latencia, bloqueos sin error registrado ni rechazos 4xx que no emitan ERROR; una incidencia de esos tipos puede quedar fuera.
- Backups: solo busca fallos registrados de operaciones Firestore Backup/Restore/ExportDocuments con código de error. No detecta ausencia o antigüedad del backup. Falta desplegar y verificar un emisor periódico de frescura; la función local `evaluateBackupFreshness` no lo sustituye.

Las pruebas del generador local confirman las expresiones de servicios; la entrega de las cuatro categorías ya tiene evidencia independiente. Esto no acredita cierre/recuperación de incidentes ni elimina los límites de latencia, 4xx y frescura de backups. Ampliaciones de filtros y señales deben autorizarse y verificarse por separado.

## Evidencia de validación técnica y decisión — 11/09/2026 17:31:57 UTC

El manifiesto `tmp/release-evidence/release-manifest.json`, generado el 11/09/2026 a las 17:31:57.724 UTC, contiene los diez checks técnicos requeridos en estado PASS, exitCode 0 y cero pruebas omitidas. Evidencia detallada: `tmp/security-release-isolated-validation.log`. El resultado global sigue siendo `releaseEligible:false`: cuatro controles operativos pendientes (MFA, entrega/recuperación de alertas, validación staging y recuperación integral) y checkout con cambios sin consolidar. Estos resultados no implican despliegue ni cierre de todos los hallazgos.

Se aplicó `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/Public/kreatum-unix-pipe-unavailable` únicamente al proceso de pruebas para usar el fallback TCP ante un problema incidental del entorno Java. No es una corrección del código de KREATUM ni un cambio persistente de configuración. Rules comprobó casos permitidos y denegados sin max1000. La ejecución anterior de las 16:50 UTC falló en integración; se conserva como antecedente en `tmp/security-release-validation.log`, no como resultado de la nueva batería terminada.

Los errores anteriores fueron `deadline-exceeded` y fallos de carga de workers de Functions. La acumulación o lentitud del emulador sigue siendo una hipótesis, no una causa raíz confirmada ni una prueba de fallo de memoria. El runner ejecuta cada uno de los seis archivos de integración con una instancia limpia de emuladores, conservando los once casos, su concurrencia interna y los mismos plazos. La nueva ejecución aprobó los once casos y continuó con E2E, carga, migración y builds finales. Sus pruebas de runner están incluidas en las 22 de scripts y no se cuentan por segunda vez.

Evidencia complementaria posterior al gate: el escenario E2E ampliado de informes aprobó 1/1 en 32,6 segundos; comprueba PDF/PPTX/JSON antes y después de publicar el informe de prueba y conserva la inmutabilidad de sus bytes. Log: `tmp/security-report-json-validation.log`. Es la ampliación del mismo caso de informes, no un segundo caso independiente que sumar. Publicar ese informe sintético en emulador no significa desplegar la plataforma. El coordinador volvió a compilar frontend y Functions con entorno de producción y obtuvo exitCode 0, sin despliegue, después de que E2E reconstruyera dist para demo. El manifiesto de las 17:31 sigue siendo histórico y no elegible; no certifica automáticamente estos cambios ni sustituye una nueva verificación del candidato final.

| Elemento | Resultado / referencia sanitizada |
|---|---|
| Commit/referencia y cambios revisados | Histórico del gate: HEAD f4c2790e37b8808043505996a2ade3f2d05dcb33, dirty=true y 66 archivos cambiados. Preparación posterior: candidato aislado tmp/security-staging-candidate-20260911, rama codex/security-remediation-2026-09-11; npm ci raíz y Functions PASS, confirmado por coordinador. No constituye despliegue ni certifica por sí solo revisión final/limpieza del candidato |
| Hashes de Functions y Rules candidatos | Manifiesto histórico de las 17:31: Functions 2bf25b209fc0be90f419b46307ebdbdfe53d68325a9cff8a67fb4adccef5d176; Firestore 79373ed00c46f5e3fd31be7cc6b74a1811ad3435cddfafcb57ac6c85e13e7970; Storage 9582f34a1f5acf9e4740e0804de68133ce57959743c22832a620823d8f6a3c0e. No son evidencia de publicación ni identifican automáticamente los builds posteriores |
| Lint y tipos | PASS lint y TypeScript frontend/backend dentro de verify; evidencia tmp/security-release-isolated-validation.log |
| Builds | PASS frontend y Functions en el gate; hash frontend de esa ejecución 9642a7a62dc33120d690bd7ae99e596e48434398ac9e5b48b772d2210cc7e060. Tras E2E JSON complementario, el coordinador repitió ambos builds con entorno de producción: exitCode 0. Son artefactos locales no publicados; el manifiesto anterior continúa no elegible |
| Unidades y regresiones antes/después | Ejecución terminada: raíz 70 PASS; scripts 22 PASS; Functions 61 + 6 PASS; cero omitidas. Las seis finales incluyen dos pruebas de claims y cuatro del paquete PPTX local. Regresiones previas: acceso 10 fallan sobre fuente anterior y pasan corregidas; guard post-ACK 3/4 antes, 4/4 después. Son subconjuntos, no cobertura adicional a sumar |
| Integración y Rules en emulador; omisiones | Rules 21/21 PASS, incluido Fermentar. Integración 11/11 PASS distribuidos en seis ejecuciones aisladas (1+3+1+3+1+2), cero omitidos. Evidencia tmp/security-release-isolated-validation.log |
| E2E, carga y migración | Smoke navegador 12 PASS; acceso/juego 14 PASS; informe 1 PASS; carga 1 PASS; migración 11 PASS. Todos en la ejecución terminada, sin omisiones. No equivalen a pruebas contra staging publicado |
| Publicación y pruebas staging | No se desplegaron Functions ni Rules corregidas en staging. Pendiente validación de publicación y flujos |
| Recorrido multirrol/multiempresa | Baterías locales/emuladas PASS; recorrido contra el candidato desplegado en staging pendiente |
| Auditoría de dependencias y excepciones | Frontend: 0 avisos. Functions candidato local: 0 altos y 2 moderados tras vendorización verificada por coordinador; docs/PPTX_VENDOR_MAINTENANCE.md. No implica publicación ni aprobación integral del release |
| Inventario de Functions | Staging: 69/69 ACTIVE; producción: 70/70 ACTIVE. Una única cuenta de servicio observada en cada proyecto; esto por sí solo no demuestra que sea dedicada ni sus privilegios mínimos |
| Cuatro políticas: proyecto, estado y cobertura | Staging: acceso 5904356453047946880; cierre 7364924856207147192; informes 12199825822163392045; backups 5904356453047947187. Las cuatro habilitadas para pruebas de staging; cobertura y validación restantes pendientes |
| Canal staging / prueba de recepción y recuperación | Cuatro recepciones verificadas por usuario y buzón: Access 16:04:11 UTC; Reports/Backups 18:43:20 UTC; Completion 18:43:21 UTC. Tres últimas del probe security-validation-20260911-184242. Canal verificado y cuatro políticas habilitadas en staging. Cierre/recuperación de incidentes aún no comprobado. Evidencia SECURITY_ALERT_DELIVERY_2026-09-11.md |
| Señal periódica de frescura de backup | evaluateBackupFreshness solo local/pruebas; scheduler NO desplegado |
| Acceso a Rules/Auth y MFA | Readback 200 en ambos proyectos usando x-goog-user-project, sin ampliar IAM. Rules leídas/comparadas; K-02 Firestore sigue pendiente de publicación. MFA DISABLED en ambos, sin enrollment/challenge; control MFA pendiente. Evidencia docs/SECURITY_CLOUD_READBACK_2026-09-11.md |
| Restauración aislada | SUCCESSFUL y done=true, confirmado por coordinador. Base staging security-restore-20260911 desde backup 696cbd16-1ef9-4e45-a7dd-e2befe5677b8; snapshot 2026-09-10T23:01:18Z. Accesible con Admin; 6 colecciones raíz y 395 documentos contados mediante agregación allDescendants. Lectura posterior: dos informes, seis referencias de artefactos y seis metadatos con formato SHA256 de 64 caracteres, tamaño y ruta válidos. Esto verifica estructura, no bytes ni hashes de los archivos. GET sin autenticación a documento inexistente devuelve 403 |
| Límites de recuperación | Las seis consultas de metadata al bucket de aplicación staging mediante Google Storage JSON API, con autenticación gcloud configurada y x-goog-user-project, devolvieron 403 forbidden: denegación real de storage.objects.get confirmada para la identidad conectada. No se pudieron leer bytes ni comparar hashes; no demuestra archivos ausentes. Stop de permisos: sin otras credenciales, atajos ni ampliación IAM. Sin restauración Storage ni recuperación integral verificada; full-recovery sigue pendiente. Base restaurada conservada; retención y limpieza autorizada pendientes |
| Versión segura de recuperación | Pendiente |
| GO independiente de producción y alcance | Instrucción actual: finalizar candidato/staging, alertas y recuperación; MFA aplazado por usuario, sin cambio del gate; nuevo GO obligatorio antes de producción. El manifiesto histórico sigue releaseEligible=false. Dos avisos moderados documentados. No se publicó el candidato en staging ni producción |
| Ventana y ausencia de workshops activos | Pendiente |
| Publicación coordinada Functions + Rules | No se realizaron cambios en producción ni publicación de Functions/Rules del parche en staging |
| Smoke de navegador | 12/12 PASS en la ejecución final local; es la misma cifra de la fila E2E, no otra batería sumable. No sustituye smoke posterior al despliegue |
| Monitorización y decisión final | Histórico 17:31:57 UTC: diez checks técnicos PASS y releaseEligible=false por cuatro controles operativos y dirty. Actualización posterior: cuatro recepciones confirmadas, recuperación del incidente no comprobada; recuperación Storage bloqueada por permiso real; candidato aislado instalado con npm ci PASS pero aún sin despliegue. MFA aplazado sin alterar el gate. Producción requiere nuevo GO |

Readback posterior de hashes confirmado por el coordinador: `frontendMatchesGate:true` y `functionsMatchesGate:true`; los dos artefactos reconstruidos coinciden con los hashes del gate de las 17:31. `releaseEligible` sigue siendo false. La coincidencia de artefactos no sustituye los controles operativos pendientes ni acredita despliegue.

Una decisión final debe distinguir corrección local, validación en staging y verificación productiva. No cerrar un hallazgo solo por pasar compilación o por encontrar una Function ACTIVE.

### Ensayo de staging preparado, no ejecutado

`scripts/staging-security-smoke.mjs` y su prueba independiente preparan un ensayo sintético K-01/K-02 exclusivo de staging. Requiere proyecto exacto y `--execute`, rechaza producción y emuladores, no sobrescribe fixtures existentes y no imprime credenciales. La revisión independiente detectó y corrigió la expectativa de equipo ocupado y el riesgo de falsas denegaciones por caducidad: ahora comprueba fase, propietario y vigencia antes y después de los bloques negativos. Los seis tests de seguridad del runner, lint global y TypeScript pasaron después de esos cambios.

No se ejecutó este runner contra cloud. Su cobertura no sustituye la validación completa de invitaciones con bloqueo global, caché, revocaciones concurrentes, cierre funcional ni informes desplegados. Conserva fixtures identificadas; no realiza limpieza automática. El candidato aún necesita consolidación, publicación coordinada y validación en staging. No se cambió producción.
