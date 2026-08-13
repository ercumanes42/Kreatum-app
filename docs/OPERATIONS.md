# Operación y despliegue

## Entornos

Mantener proyectos Firebase y Vercel independientes para `development`, `staging` y `production`. Nunca reutilizar datos, cuentas de servicio ni buckets entre entornos. Todos los comandos destructivos o de despliegue deben incluir `--project` explícito.

## Puerta de promoción

### Estado verificado en staging (2026-08-10)

- Las 69 Functions están desplegadas en Node.js 22; App Check está activo en todas.
- Hosting sirve `/`, `/admin` y `/platform` con CSP, HSTS, anti-framing, no-sniff, política de permisos y HTML sin caché.
- Firestore tiene PITR, protección contra borrado y backup diario con retención de siete días.
- Storage impide acceso público, usa acceso uniforme y conserva soft-delete durante siete días.
- La cuenta runtime ya no tiene `Editor`; usa permisos específicos de Firestore, Auth, Tasks, Logging, Build y buckets necesarios.
- El smoke real validó token App Check, autenticación anónima, callable, guard de `/platform` y ausencia de errores runtime.
- La migración de plataforma queda en cero cambios y `verified: true`.

### Pendiente para producción

1. Mantener producción intacta hasta aprobación explícita.
2. Configurar secretos, URLs/versiones legales, dominio/remitente y App Check exclusivos de producción.
3. Resolver o sustituir la dependencia `image-size` heredada por `pptxgenjs` antes del release comercial.
4. Repetir backup, migración, matriz completa y smoke en producción dentro de una ventana de rollback aprobada.

Este repositorio no despliega automáticamente.

## Comandos de comprobación

```powershell
npm ci
npm --prefix functions ci
npm run verify
npm run test:integration
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:e2e:access
npm run test:load
npm run audit:security
```

La puerta `audit:security` permite exclusivamente los advisories `1138808` y `1138809` de `image-size` heredados por `pptxgenjs`; cualquier vulnerabilidad alta adicional o crítica bloquea el release.

## Despliegue manual controlado

Tras superar la puerta:

```powershell
firebase deploy --only firestore:rules,firestore:indexes,storage --project <staging-id>
firebase deploy --only functions --project <staging-id>
vercel --target preview
```

Repetir contra producción solo con backup confirmado y aprobación. No ejecutar migración y despliegue simultáneamente.

## Rollback

- Frontend: promover el último deployment Vercel validado.
- Rules/indexes: redesplegar la revisión Git anterior compatible.
- Functions: redesplegar la revisión anterior; no borrar funciones hasta confirmar compatibilidad.
- Datos: desactivar `VITE_KREATUM_DATA_MODEL=v2` solo si la versión anterior todavía admite legado. La migración no modifica `/games`, por lo que el origen permanece disponible.
- Si hubo escrituras v2, no sobrescribirlas con el backup: detener acceso, comparar checksums y restaurar de forma selectiva.

## App Check

1. Mantener `KREATUM_ENFORCE_APP_CHECK=false` y configurar `VITE_FIREBASE_APPCHECK_SITE_KEY`.
2. Observar durante al menos siete días el porcentaje de llamadas sin token.
3. Corregir navegadores/orígenes legítimos.
4. Activar enforcement en staging y repetir E2E.
5. Activar en producción con ventana de rollback.

## SLO y alertas

Objetivos iniciales:

- Disponibilidad de join/cambio de fase: 99,9 % mensual.
- p95 de join y controles: menor de 1,5 s.
- Errores de callables: menor de 1 % en 15 minutos.
- Generación de snapshot: menor de 30 s.

Configurar Cloud Monitoring para tasa de errores, latencia p95, instancias máximas, rechazos de Auth/App Check, fallos de tareas programadas y consumo/cuotas Firestore/Storage. Las alertas deben llegar a dos responsables y enlazar este runbook. No registrar contenido de retos, soluciones, correos, UID, códigos o IDs sin hash.

## Incidentes

1. Congelar despliegues y anotar hora, entorno y correlación.
2. Determinar si afecta acceso, integridad o confidencialidad.
3. Revocar credenciales o sesiones si procede.
4. Recuperar servicio con rollback compatible.
5. Comparar auditoría y checksums; evitar correcciones masivas no verificadas.
6. Documentar causa, alcance, acciones y prevención.
