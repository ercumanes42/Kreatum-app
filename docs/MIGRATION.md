# Migración de `games` a `workshops`

La migración copia datos; nunca modifica ni elimina `/games`. Usa el mismo ID de partida, checksum de origen, lotes limitados y un índice transaccional de códigos activos.

## Preparación

- Usar credenciales de operador solo en staging.
- Crear organización y membresía mediante el bootstrap.
- Exportar Firestore antes de `--apply`.
- No ejecutar mientras se crean o editan partidas legadas.

## Bootstrap

```powershell
npm --prefix functions run bootstrap:membership -- --project <staging-id> --organization <org-id> --organization-name "KREATUM" --uid <uid> --role owner
npm --prefix functions run bootstrap:membership -- --apply --project <staging-id> --confirm-project <staging-id> --organization <org-id> --organization-name "KREATUM" --uid <uid> --role owner
```

El primer comando es dry-run. Un cambio de rol exige además `--allow-role-change`. La herramienta valida que el usuario existe, está habilitado y no es anónimo; no imprime correo ni UID en claro.

## Ejecución

```powershell
npm --prefix functions run migrate:legacy -- --project <staging-id> --organization <org-id>
npm --prefix functions run migrate:legacy -- --apply --project <staging-id> --confirm-project <staging-id> --organization <org-id>
npm --prefix functions run migrate:legacy -- --verify --project <staging-id> --organization <org-id>
```

El dry-run informa de listos, conflictos y revisiones. `--apply` requiere repetir el project id. `--verify` compara checksum, recuentos de subcolecciones y códigos activos. Un exit code `2` indica conflictos o diferencias.

## Casos de revisión

- Estado o fase desconocidos.
- Código de partida activa inválido u ocupado.
- Defensa sin ataque inequívoco o sin equipo válido.
- Un participante presente en varios equipos.
- Documento destino ya existente con checksum distinto.

No resolver automáticamente estos casos. Corregir el origen con procedimiento autorizado o documentar una transformación explícita y repetir desde backup.

## Corte

1. Verificación sin diferencias.
2. Prueba manual completa en staging.
3. Activar `VITE_KREATUM_DATA_MODEL=v2` en staging.
4. Observar al menos una sesión real controlada.
5. Repetir backup, dry-run, apply y verify en producción con aprobación.
6. Conservar `/games` en solo lectura durante la ventana de rollback.
## Migración de acceso de plataforma

Esta migración convierte los términos comerciales existentes y la asignación de facilitador antes de activar las reglas multiempresa. No modifica fases, equipos, códigos de sala ni respuestas.

Orden obligatorio en staging:

1. Exportar Firestore y detener temporalmente altas/reasignaciones.
2. Ejecutar dry-run y resolver todos los casos de revisión.
3. Ejecutar `--apply` con confirmación exacta del proyecto.
4. Ejecutar `--verify` hasta obtener `verified: true`.
5. Desplegar Functions/callables auditadas.
6. Desplegar índices y después Firestore/Storage Rules.
7. Ejecutar smoke de empresa A/B, facilitadores A1/A2 y participante suspendido.

```powershell
node functions/scripts/migrate-platform-access.mjs --project kreatum-dinamic-staging
node functions/scripts/migrate-platform-access.mjs --apply --project kreatum-dinamic-staging --confirm-project kreatum-dinamic-staging
node functions/scripts/migrate-platform-access.mjs --verify --project kreatum-dinamic-staging
```

Para limitar el análisis a una empresa, añadir `--organization <org-id>`. El script solo acepta `demo-*`, `kreatum-dinamic-staging` o IDs incluidos expresamente en `KREATUM_MIGRATION_ALLOWED_PROJECTS`; producción se rechaza.

La precedencia comercial es `commercial`, después `commercialPlan` y finalmente campos legacy. Una fuente prioritaria presente pero inválida nunca cae silenciosamente a otra. Se conservan estado, vigencia y partidas usadas; un conflicto o valor incompleto exige revisión y devuelve código 2.

`facilitatorUid` solo se añade cuando `facilitatorAssignment.facilitatorUid` o, en su ausencia, `createdBy` identifica un miembro `facilitator` activo de la misma empresa. Un UID inactivo, desconocido, contradictorio o perteneciente a otro tenant bloquea toda la aplicación. Los resultados solo muestran hashes, nunca correos, códigos o respuestas.

No desplegar las reglas nuevas antes del `--verify`: las organizaciones sin `commercial` canónico y las partidas sin `facilitatorUid` quedan bloqueadas de forma intencionada.