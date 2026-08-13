# Puerta de piloto empresarial y release

Este runbook no despliega nada. Un piloto o release solo se aprueba con evidencia del mismo commit y del mismo conjunto de artefactos.

## Contratos inmutables

- Siete fases: Selección, Calcinar, Diluir, Conjugar, Sublimar, Fermentar y Proyectar.
- Cuatro equipos: Agua, Aire, Fuego y Tierra.
- Un dispositivo activo por equipo y máximo cuatro dispositivos por partida.
- Entrada manual mediante código de sala.
- Informes construidos exclusivamente con datos persistidos.

## Puerta automática

Usar Node 22 desde una copia limpia del commit candidato:

```powershell
npm ci
npm --prefix functions ci
npm run verify
npm run test:integration
npm run test:e2e
npm run test:e2e:access
npm run test:e2e:report
npm run test:load
npm run test:migration
npm run audit:security
```

Las suites Firebase locales se ejecutan en serie porque comparten puertos. Un fallo, una prueba omitida inesperadamente o una vulnerabilidad alta bloquea la promoción.

La puerta `audit:security` permite exclusivamente los advisories `1138808` y `1138809` de `image-size` heredados por `pptxgenjs`; cualquier vulnerabilidad alta adicional o crítica bloquea el release.

### Riesgo temporal aceptado: generador de informes

El lockfile actual de Functions mantiene dos hallazgos altos derivados de `image-size <=2.0.2`, dependencia transitiva de `pptxgenjs 4.0.1`. Ambas versiones son las últimas disponibles; no se aplica `npm audit fix`, downgrade ni override inseguro. Las siete vulnerabilidades moderadas adicionales son transitivas del SDK de Firebase y se monitorizan.

Esta excepción permite únicamente pilotos gestionados y exige:

- procesar solo imágenes y assets internos controlados;
- bloquear uploads y URLs de imágenes externas en el generador;
- revisar el advisory y las versiones upstream antes de cada release;
- bloquear la monetización comercial hasta parchear upstream o sustituir la dependencia.

Cualquier hallazgo alto o crítico adicional bloquea también el piloto.

## Matriz anti-freeze

| Caso | Evidencia de aceptación |
| --- | --- |
| Escritura en los últimos 750 ms | El valor confirmado permanece tras avanzar y finalizar |
| Pérdida de red durante guardado | Se muestra sin conexión, no se confirma guardado y se recupera |
| Cambio de equipo con escritura pendiente | No aparece contenido del equipo anterior en el nuevo |
| Segundo dispositivo para un equipo | Rechazado; el dispositivo original reconecta |
| Sesión expirada | Edición bloqueada y recuperación explícita |
| Transición de fase | Cuatro ACK antes del commit |
| Override | Motivo, equipos pendientes y revisión auditados |
| Dos facilitadores | Una transición gana; no hay doble avance |
| Ataques y defensas | Máximo 10 ataques/equipo y una defensa/ataque |
| Informe superior a 70 s | El trabajo persiste y la UI recupera progreso/resultado |

No existe garantía literal de que un sistema conectado “jamás se congele”. El objetivo verificable es que ninguna espera quede indefinida: toda operación tiene timeout, estado visible, reintento seguro o recuperación.

## Responsive y accesibilidad

Validar Administrador, Control Room y cada fase en 320×568, 390×844, 768×1024, 1024×768, 1440×900 y 1920×1080.

Criterios: cero overflow horizontal, contenido bajo la cabecera, CTA legibles, controles táctiles de al menos 44 px, foco visible y cero incidencias Axe graves o críticas.

## Carga y estabilidad

La carga local representa 100 partidas, 100 administradores y 400 sesiones. Umbrales:

- p95 join/control menor de 1,5 s.
- p95 de guardado menor de 2 s.
- tasa de error menor de 1 %.
- cero pérdida o mezcla de contenido.

Antes de monetizar en staging:

1. Carga escalonada 25/50/100 partidas.
2. Soak mínimo de 8 horas con heartbeats, escrituras y transiciones.
3. Medir lecturas/escrituras, instancias, memoria, latencia y errores.
4. Revisar cuotas y alertas de presupuesto al 50/75/90 %.

## App Check

1. Registrar aplicaciones web separadas para staging y producción.
2. Configurar claves distintas sin guardarlas en Git.
3. Observar siete días con enforcement desactivado.
4. Investigar clientes legítimos sin token.
5. Activar primero en staging y repetir integración, E2E, carga y smoke.
6. Activar en producción con ventana de rollback.

Rollback: desactivar enforcement, confirmar recuperación y registrar el incidente. App Check complementa Auth, reglas y rate limits; no los sustituye.

## IAM mínimo

| Cuenta | Capacidades |
| --- | --- |
| gameplay | Partidas, sesiones, equipos y auditoría |
| access | Auth, invitaciones, membresías y firma de tokens |
| reports | Informes en Firestore/Storage, sin gestión de usuarios |
| tasks | Encolar o ejecutar tareas, sin acceso administrativo |

Procedimiento: inventariar permisos, crear roles mínimos, asociar cada Function a su cuenta, retirar `roles/editor`, ejecutar smoke y conservar rollback IAM. No retirar permisos y desplegar código simultáneamente.

## TTL y limpieza

Configurar y verificar TTL para:

- `participantSessions.expiresAt`;
- invitaciones consumidas, canceladas o expiradas;
- usuarios anónimos sin sesión vigente;
- documentos de rate limit;
- trabajos de informe terminados según retención.

El TTL no es inmediato. Los callables deben rechazar documentos expirados aunque todavía existan.

## Backup y restauración

1. Confirmar PITR y backup programado de Firestore.
2. Exportar Firestore y copiar Storage crítico a ubicación separada.
3. Restaurar en un proyecto aislado.
4. Comparar recuentos, checksums, membresías, partidas e informes.
5. Ejecutar smoke de lectura sin datos personales reales.
6. Registrar RPO, RTO, operador, fecha y evidencia.

Una copia no restaurada no cuenta como backup verificado.

## Release reproducible

Guardar: commit limpio, versiones Node/npm/Firebase CLI, ambos lockfiles, hashes SHA-256 de `dist` y `functions/lib`, resultados de puertas, IDs de despliegue anterior/candidato, reglas, índices, migración y rollback.

No versionar secretos, tokens, códigos, correos de participantes ni contenido del taller.

## Orden de promoción

1. Backup y restauración ensayada.
2. Migración dry-run y verify.
3. Backend, reglas, índices y configuración.
4. Smoke de propietario, participante y Control Room.
5. Frontend.
6. Smoke completo con cuatro equipos.
7. Observación intensiva o rollback.

Producción requiere autorización expresa y queda bloqueada si falta evidencia.
