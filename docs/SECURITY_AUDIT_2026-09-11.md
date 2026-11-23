# Auditoría de seguridad KREATUM — 11/09/2026

## Veredicto

**NO-GO para dar por cerrada la seguridad multiempresa y aprobar nuevas ampliaciones de uso.** Hay dos defectos de autorización de prioridad alta presentes en el código fuente asociado a Functions desplegadas. No se ha demostrado un incidente ni una explotación en partidas reales. Este dictamen no ordena apagar el servicio.

Auditor principal y tres agentes: autenticación/backend; frontend/privacidad; dependencias/CI/QA. El principal comprobó personalmente los dos hallazgos principales, las cabeceras públicas, configuración cloud y accesos negativos. No se modificaron código, datos, permisos ni despliegues. Este informe es el único entregable añadido.

## Alcance y método

- Producción: https://kreatum-app.vercel.app/ y https://kreatum-app.vercel.app/admin.
- Repositorio: `C:\Users\JuanMartínezCarrillo\Documents\Kreatum Definitiva`.
- Backend: Firebase/Google Cloud `kreatum-dinamic`, confirmado mediante documentación y metadatos cloud.
- Código: React/Vite, Functions Node.js 22, Firestore, Storage y generación PDF/PPTX.
- Lecturas cloud con identidad ya configurada; sin extracción de credenciales, contenido de talleres ni listas de personas.
- Archivos ZIP de código de despliegue leídos en memoria para `changeMemberStatus`, `joinWorkshopByCode` y `submitWorkshopAttack`. Esto confirma presencia del defecto en el artefacto asociado al despliegue; no equivale a haberlo explotado.
- El checkout contiene 17 archivos modificados previamente y archivos no versionados. No se atribuyen estos cambios a esta auditoría. No se presume que todo el checkout coincida con producción.
- No se proporcionaron cuentas de prueba. No se crearon usuarios, empresas ni partidas. Pruebas autenticadas multirrol y multiempresa pendientes.

## Hallazgos priorizados

### K-01 — Alta: un owner de empresa puede alterar una cuenta global

**Estado: confirmado en código local y fuente del despliegue.**

Evidencia: `functions/src/access/accessFunctions.ts:823` valida el owner de una organización. Las líneas 863–864 llaman después a `getAuth().updateUser(memberId, {disabled: ...})` y revocan los tokens de toda la cuenta. La autorización pertenece a una empresa, pero el efecto pertenece a toda la plataforma.

Si una persona pertenece a A y B, el owner de A puede bloquear su acceso a B. Reactivar desde A también modifica el estado global. No se ha investigado qué personas reales cumplen esa condición. La arquitectura admite varias membresías. El flujo de plataforma ya usa modificación de membresía y `tests/platform.integration.test.ts:469–471` espera que la baja de una empresa no deshabilite Firebase Auth.

Hay caminos relacionados que reactivan usuarios existentes durante invitaciones (`accessFunctions.ts:982` y `:1120`); requieren el mismo tratamiento de alcance. No se afirma que una invitación baste por sí sola para acceder a otra empresa.

**Corrección:** separar suspensión de membresía y bloqueo de identidad global. Reservar este último a una operación de plataforma explícitamente autorizada. Evitar que la aceptación de invitaciones levante un bloqueo global.

**Contención propuesta, no aplicada:** evitar el flujo de desactivar/reactivar miembros para personas compartidas entre organizaciones hasta corregirlo; restringir operativamente su uso a un responsable.

**Prueba de aceptación:** usuario de prueba en A/B; desactivación y reactivación por owner A deben afectar solo a A. Un bloqueo global debe mantenerse ante una nueva invitación. Incluir reintentos y fallo parcial entre transacción y Auth.

### K-02 — Alta: reingreso conserva permisos sobre un equipo reasignado

**Estado: confirmado en código, guard ejecutado en memoria y fuente de despliegue. Cadena completa E2E no ejecutada.**

Secuencia: A ocupa Agua, su sesión caduca, B ocupa Agua y A vuelve a entrar con el código mientras queda un hueco de dispositivo. `functions/src/index.ts:829–847` conserva `existingTeam` y renueva la sesión sin validar quién tiene ahora el equipo.

`loadActiveParticipantForCommand`, `index.ts:1844–1868`, valida estado, fase y caducidad, pero no consulta la reserva de equipo ni dispositivo. Los comandos de ataques y defensas utilizan este guard. El heartbeat sí comprueba el propietario, pero una llamada directa no tiene que pasar por el heartbeat.

Prueba del principal: extracción de la función real, transpilación y ejecución aislada con dobles Firestore. Con una reserva asignada a otro dispositivo devuelve acceso aceptado. Resultado: `accepted=true`, `reservationChecked=false`, `cloudWrites=0`. Los datos de esta prueba son sintéticos, no datos de cliente.

Impacto: el dispositivo antiguo puede conservar capacidad de actuar como ese equipo, con riesgo para la integridad de aportaciones e informes. Las reglas locales de `solutions` (`firestore.rules:432–458`) tampoco comprueban la reserva al escribir durante Conjugar, a diferencia de `teams`. Esta extensión a escritura directa es un hallazgo local: no se pudo cotejar la versión desplegada de Rules.

**Corrección:** comprobar propietario y vigencia de reserva en todos los comandos; al reingresar, limpiar el equipo si ya pertenece a otro dispositivo. Aplicar la misma condición a lecturas privadas y escrituras de soluciones donde corresponda.

**Contención propuesta, no aplicada:** hasta el parche, evitar reutilizar equipos con sesiones antiguas recuperables; revisar con el facilitador los dispositivos activos y las aportaciones finales. El control visual del frontend no basta como corrección.

**Prueba de aceptación:** reproducir A/caducidad/B/reingreso de A en emulador y staging. A debe perder acceso al equipo de B; B debe conservar lectura, escritura, reconexión y cierre. Cubrir ataques, defensas, soluciones y caducidad simultánea.

### K-03 — Media: autorización previa a una transacción puede quedar obsoleta

**Estado: defecto de diseño estático; carrera concurrente no reproducida.**

`accessFunctions.ts:584/661/738/774/823` valida al owner antes de la transacción. Algunas transacciones sensibles no vuelven a leer la membresía del actor. Una petición ya iniciada podría confirmar un cambio después de retirar permisos al actor.

**Corrección:** reutilizar `security/organizationOwnerAuthorization.ts` y revalidar al actor dentro de la transacción. **Prueba:** intercalar la revocación del actor entre validación inicial y commit; la operación debe abortar.

### K-04 — Media operativa: no hay políticas de alerta en Cloud Monitoring

**Estado: confirmado en consulta de producción; lista vacía.**

La API de `alertPolicies` devuelve cero políticas. No se revisaron otros proveedores de alertas, por lo que no se afirma ausencia universal de monitorización.

Impacto: fallos de acceso, informes o tareas pueden depender de que alguien los comunique. Las revisiones periódicas no sustituyen una alerta inmediata.

**Corrección:** alertas de errores y latencia de acceso/cierre/informes, fallos de colas y backups, cuotas y abuso; responsable y procedimiento de respuesta. **Prueba:** evento sintético controlado que llegue al canal elegido sin PII.

### K-05 — Dependencias vulnerables y puerta de release incoherente

**Estado: dependencias confirmadas en instalación/lock local; explotación remota no demostrada.**

`npm audit`: raíz 0 vulnerabilidades; Functions 9 paquetes afectados, 2 de severidad alta y 7 moderada, ninguno crítico. No equivale a nueve ataques independientes ni prueba que las mismas versiones estén en todos los artefactos productivos.

`image-size@2.0.2`, transitiva de `pptxgenjs@4.0.1`, tiene avisos de bucles infinitos al procesar ICNS/JXL/HEIF. El flujo revisado usa cinco PNG internos fijos (`renderReportArtifacts.ts:47–70`); no se identificó entrada de imágenes de usuario hacia ese parser. Referencias: [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).

Otros avisos afectan a `qs`, `uuid` y dependencias transitivas de Firebase/Google Cloud. Su alcanzabilidad requiere revisión específica antes de atribuir impacto explotable.

`scripts/audit-security.mjs:6–19,48–57` exceptúa los avisos altos sin vencimiento. `scripts/verify-release.mjs:130` calcula `releaseEligible` por limpieza de Git, mientras `:154–165` declara bloqueo comercial por ese riesgo. Es una debilidad media del control de publicación, no prueba de intrusión.

**Corrección:** actualizar o sustituir dependencias tras pruebas; unificar criterio de elegibilidad comercial; excepciones acotadas con responsable y vencimiento. Fijar Actions por SHA es una mejora adicional de cadena de suministro.

**Prueba:** auditoría de dependencias del artefacto final, PDF/PPTX completos, y casos de release con vulnerabilidad aceptada, expirada o no permitida.

## Controles comprobados

| Área | Evidencia | Límite |
|---|---|---|
| Web pública y admin | Ambas URLs responden 200 con CSP, HSTS, frame-ancestors none, X-Frame-Options DENY, nosniff y políticas de permisos/referrer | 200 en admin entrega la aplicación, no demuestra acceso a datos administrativos |
| Endpoints sin sesión | `listMyOrganizations`, `getReportJob`, `changeMemberStatus`: 401 con cuerpo vacío sin credenciales | No prueba todos los roles ni endpoints |
| Datos sin sesión | Lecturas de recursos inexistentes en Firestore y Storage: 403 | Un primer ID reservado dio 400 y fue excluido de la conclusión |
| Functions | 70 ACTIVE; una cuenta de servicio dedicada compartida; sin roles Owner/Editor en los roles runtime observados | Compartir identidad amplía el alcance potencial de una Function comprometida; IAM completo de cada recurso no certificado |
| Firestore | PITR y protección contra borrado habilitados | No se realizó restauración |
| Backups | Programación diaria, retención de 14 días, 13 backups READY; último 11/09/2026 00:55:52 UTC | READY no demuestra recuperabilidad de extremo a extremo |
| Buckets | Seis con UBLA; cero bindings públicos explícitos en políticas consultadas; aplicación y backup con PAP enforced | Cuatro buckets técnicos con PAP inherited; no se certificó política organizativa efectiva |
| App Check | Variable enforcement=false en las 70 Functions | Configuración observada; no se cambió. Una verificación VALID en la ventana consultada no constituye tráfico representativo |
| Logs | Consulta últimas 24 h previa a pruebas negativas: cero HTTP >=400 y cero WARNING o mayor en Functions/Cloud Run | Muy poco tráfico; no prueba ausencia histórica de incidentes ni errores frontend |
| Frontend | Sin sinks HTML/eval peligrosos encontrados; identidad Firebase separada jugador/admin; logout; errores genéricos | Inspección estática, no pentest autenticado de navegador |
| Informes | Autorización servidor; URLs firmadas cortas; restricciones de URL en descarga tenant; CSV neutraliza fórmulas habituales | Descarga completa autenticada pendiente |
| Invitaciones | HMAC, comparación constante, intentos limitados, expiración y límites por email/IP | Pendiente ensayo completo de recuperación, revocación y MFA |

## Pruebas ejecutadas

- Lint y TypeScript raíz/Functions: correctos.
- 70 pruebas raíz, 47 Functions y 2 de protección de claims: correctas. Tres pruebas transaccionales omitidas por ausencia de emulador.
- Agente frontend: 10 pruebas focalizadas correctas, solapadas con parte de la batería raíz; no se suman como cobertura independiente.
- Prueba adicional en memoria del guard de participante: reprodujo la omisión K-02.
- Lectura de fuentes asociadas a tres Functions desplegadas y consultas cloud descritas arriba.
- No se ejecutaron builds que sobrescribiesen artefactos, pruebas de carga, emuladores, integración cloud, E2E autenticado ni restauraciones. Los resultados unitarios no cierran estos huecos.

## Resumen por interfaz

**Administrador:** controles web y rechazo sin sesión correctos en la muestra. Prioridades: alcance tenant/global de bajas y altas, revalidación de permisos concurrentes y comprobar MFA/reautenticación de operaciones sensibles. La lectura de configuración Auth devolvió 403; MFA no se declara ausente ni activado.

**Jugador:** renderizado y separación de identidad razonables en código. Prioridad: el equipo y dispositivo deben validarse en el servidor en cada operación. La persistencia de una sesión en navegador no es por sí sola una vulnerabilidad.

Mejoras menores pendientes: usar el mismo validador de descarga en `WorkshopDirectory.tsx:259`; revisar salto de línea inicial en CSV (`gameCsv.ts:36`) con software de hoja de cálculo real. No se clasifican como exploits confirmados.

## Cobertura pendiente y límites

- Rules desplegadas e Identity Platform config: HTTP 403. No se cambiaron roles ni se intentó eludir esa restricción. Se necesita lectura autorizada de esas configuraciones para cerrar la comprobación.
- Sin cuentas de prueba para owner, facilitador, usuario y dos empresas; no se probó login/recuperación/MFA/revocación real ni protección de reportes entre roles.
- No se certifican XSS/CSRF/SSRF/inyecciones inexistentes: se revisaron superficies de código; no se ejecutó una batería dinámica autenticada. No se encontraron cargas de archivo de usuario en frontend revisado.
- Estado de ramas protegidas, permisos GitHub/Vercel, restricciones de claves web, secreto histórico en Git y configuración de proveedores externos no verificados exhaustivamente.
- No se descargaron informes de clientes ni se comprobaron sus datos; ninguna conclusión implica pérdida o acceso efectivo a contenido real.
- Restauración de Firestore/Storage y canales de alertas externos pendientes. La documentación de operaciones contiene estados de agosto y retenciones distintas: no debe sustituir la evidencia actual.

## Plan de corrección propuesto — requiere GO

| Orden | Trabajo | Esfuerzo relativo | Dependencia y cierre |
|---|---|---|---|
| P1 | K-01 alcance de baja/alta y activaciones | Medio | Tests A/B, bloqueo global e invitación; staging antes de producción |
| P1 | K-02 reserva vigente en join/comandos/Rules | Medio | Tests A/B/dispositivo, reconexión, fase y solución; cotejo Rules live |
| P2 | K-03 permisos dentro de transacciones | Bajo–medio | Prueba de carrera revocación/commit |
| P2 | K-04 alertas y ensayo de recepción | Bajo–medio | Canal y responsable definidos |
| P2 | K-05 dependencias y puerta de release | Medio | Auditoría de artefactos y regresión PDF/PPTX |
| P2 | Verificar MFA, sesiones y revocación | Medio | Acceso de lectura Auth y cuentas de prueba autorizadas |
| P3 | Restauración, IAM por funciones y mejoras menores | Medio | Entorno de restauración aislado; validar funcionalidad |

**Criterio para reconsiderar GO:** K-01/K-02 corregidos y reproducidos primero como fallos y después como denegaciones correctas en staging; validación multirrol/multiempresa; configuraciones pendientes comprobadas; alertas probadas; riesgos residuales de dependencias explícitamente resueltos o aceptados con alcance. No se promete riesgo cero.
