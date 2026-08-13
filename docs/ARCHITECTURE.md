# Arquitectura de KREATUM

## Contratos inmutables

La secuencia del juego, los cuatro equipos y el acceso manual por código desde PC no cambian. La evolución técnica protege esos flujos; no introduce QR, invitaciones por correo ni cuentas de participante.

## Componentes

1. `src/`: SPA React. Separa las vistas de participante y Alquimista, el contexto de sesión, suscripciones Firestore y clientes de las funciones.
2. `shared/contracts.ts`: contrato único para fases, equipos, roles, límites, versiones e inputs/outputs.
3. `functions/src/index.ts`: frontera privilegiada. Crea, recupera, avanza, completa, reasigna, archiva y genera/publica informes.
4. `firestore.rules` y `storage.rules`: autorización por organización, rol y sesión temporal.
5. Firestore v2:
   - `/organizations/{orgId}` y `/members/{uid}`.
   - `/workshops/{workshopId}`.
   - Subcolecciones `participantSessions`, `teams`, `attacks`, `defenses`, `solutions`, `reports`, `auditEvents` y claves idempotentes.
   - `/activeRoomCodes/{code}` como índice privado de acceso.
6. Storage privado: `/organizations/{orgId}/workshops/{workshopId}/reports/...`.
7. Vercel sirve la SPA con CSP, HSTS y políticas restrictivas.

## Flujo de confianza

- El Alquimista usa una cuenta Firebase no anónima y debe ser miembro activo de la organización.
- El participante inicia sesión anónima, introduce el código y recibe una sesión limitada a una partida y equipo.
- Las operaciones de control pasan por callables autenticadas, con idempotencia y auditoría.
- Las escrituras colaborativas de contenido pasan por reglas estrictas y solo se permiten en la fase activa.
- Los datos `games` legados quedan bloqueados al cliente y solo son legibles por un operador con claim `platformAdmin` para migración.

## Escalado

La arquitectura actual escala horizontalmente para talleres concurrentes moderados: Cloud Functions limita instancias, Firestore pagina el historial y los contadores se materializan. Siguientes umbrales:

- Informes pesados o PDF: función encolada mediante Cloud Tasks/Pub/Sub, estado de trabajo y reintentos con clave idempotente.
- Analítica agregada: exportación a BigQuery, sin consultar contenido operativo en tiempo real.
- Organizaciones grandes: índices por organización/fecha, archivado por lotes y límites por plan.
- Requisitos regulatorios elevados: proyectos o claves separados por región/tenant y registro inmutable externo.

No se recomienda introducir un backend relacional mientras no existan relaciones transaccionales o consultas analíticas que Firestore no resuelva de forma simple.