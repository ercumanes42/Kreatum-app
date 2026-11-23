# Kreatum - Memoria tecnica

Ultima actualizacion: 16 de noviembre de 2026 (incidencia de acceso y continuidad operativa).

## Actualizacion operativa — 16 de noviembre de 2026

### Incidencia de acceso: resuelta

- Produccion: proyecto Google Cloud `kreatum-dinamic`, web `https://kreatum-app.vercel.app/admin`.
- Sintoma: «Acceso no disponible. No se pudo validar tu acceso».
- La pagina y sus archivos cargaban, pero `listMyOrganizations` devolvia errores de infraestructura antes de validar membresias. Tambien fallaban las comprobaciones de entrada a partidas, cierre y consulta de informes.
- Causa confirmada: finalizo la prueba gratuita de Google Cloud. La consola lo indico expresamente; la API devolvia `billingEnabled: false` y la cuenta vinculada `open: false`. Los registros mostraban «The request failed because billing is disabled for this project».
- Primera evidencia encontrada en la busqueda del 1 al 16 de noviembre: 4 de noviembre a las 08:26:55, hora de Madrid. No demuestra una caida continua desde ese dia ni el instante exacto del cierre de facturacion.
- El usuario actualizo la cuenta a pago por uso desde la consola de Google Cloud. El asistente no realizo pagos ni cambios en la cuenta.
- Recuperacion tecnica verificada el 16 de noviembre a las 17:52, hora de Madrid: `billingEnabled: true`, cuenta `open: true` y respuestas OPTIONS HTTP 204 con CORS correcto en `listMyOrganizations`, `joinWorkshopByCode`, `completeWorkshop` y `getReportJob`.
- Confirmacion funcional posterior del usuario: «listo ya pude entrar al panel». La incidencia de acceso administrativo queda resuelta.
- Los OPTIONS no certifican por si solos la ejecucion de partidas, cierres o informes. No se ejecutaron operaciones de negocio como prueba ni se certifico recuperacion integral de datos o infraestructura.
- No se cambiaron codigo, datos, permisos, despliegues, App Check ni MFA durante el diagnostico y la verificacion.
- Informe de auditoria previo a la reactivacion: `C:/Users/JuanMartínezCarrillo/.codex/visualizations/2026/08/09/019fe5f6-4417-76d3-bdf4-4ee6d625e1a2/KREATUM_ACCESS_AUDIT_2026-11-16.md`. Su estado de cierre describe el momento anterior a la recuperacion; este apartado documenta la resolucion posterior.

### Defecto de vigilancia y estado de Eventarc — corregido y verificado (16/11/2026 20:27 Madrid)

- Se actualizo `scripts/lib/security-alert-policies.mjs:17` y sus pruebas en `scripts/security-alert-policies.test.mjs:27-31` para incluir `listmyorganizations`, `getinvitationactivation`, `listteamaccess` y `listplatformorganizations` en la politica `KREATUM security access`.
- Se actualizaron y verificaron por readback las politicas `KREATUM security access` desplegadas en Cloud Monitoring tanto en staging (`projects/kreatum-dinamic-staging/alertPolicies/5904356453047946880`) como en produccion (`projects/kreatum-dinamic/alertPolicies/17995710671952793129`), ambas `enabled: true` y vinculadas a su canal verificado.
- Comprobacion del endpoint `listMyOrganizations` en staging y produccion: `OPTIONS` devuelve `HTTP 204` con CORS valido y `POST` sin credenciales devuelve `HTTP 401` controlado por la funcion (no `5xx` de infraestructura).
- Estado de las cinco funciones Eventarc (`indexWorkshopAuditEvent`, `countWorkshopAttackCreated`, `countWorkshopAttackDeleted`, `countWorkshopTeamCreated`, `countWorkshopTeamDeleted`): tras la reactivacion de facturacion (`2026-11-16T16:49:46Z`), Google Cloud reconcilio automaticamente los 5 triggers en `europe-southwest1` tanto en staging como en produccion. Las 70 funciones de cada entorno figuran `ACTIVE` con `stateMessages: []` y sus triggers/topicos Pub/Sub devuelven HTTP 200. No fue necesario redesplegar funciones ni alterar el aislamiento entre staging y produccion.
- Reconciliacion en modo lectura (`dry-run`): `reconcile-workshop-summary.mjs` confirmo `driftCount: 0` en staging (5 partidas) y en produccion (14 partidas de `gfs`). `backfill-workshop-audit.mjs` confirmo `missingEvents: 0` en staging; en produccion detecto 12 eventos historicos sin `actorId` (`reviewRequired: 12`), por lo que no se mutaron datos historicos.

### Prevencion aplicada — autorizada por el usuario (16/11/2026)

1. Usuario: mantener vigente el metodo de pago y valorar una tarjeta de respaldo en `https://console.cloud.google.com/billing` (los datos bancarios los gestiona exclusivamente el titular).
2. Canal de avisos verificado en Cloud Monitoring (`1786957118986185177` en produccion y `15654231018987484790` en staging).
3. Se habilito `billingbudgets.googleapis.com` y se creo el presupuesto mensual de **SOLO AVISOS** `KREATUM — Presupuesto solo avisos (20 EUR)` (`billingAccounts/014DA8-A69E75-6C5022/budgets/8c2f9786-ea82-4e42-ba26-718fb6d88b09`) por **20 EUR/mes**, con avisos al 50 % (10 EUR), 90 % (18 EUR) y 100 % (20 EUR), destinatarios IAM de facturacion activos (`disableDefaultIamRecipients: false`), canal de monitoreo vinculado y **sin topico Pub/Sub ni apagado automatico** (`hasPubsubTopic: false`).
- Ninguna de estas medidas garantiza cero caidas, pero aseguran aviso inmediato ante errores de acceso administrativo (`/admin`, `/platform`, equipo) y control de consumo sin cortes automaticos.

### Costes: aclaracion acordada

- El coste nuevo tratado es Google Cloud por consumo, no una cuota mensual fija por actualizar la cuenta.
- Segun el usuario, actualmente no pagan Vercel; Brevo se gestiona por separado. No sumar una suscripcion Vercel Pro hipotetica ni presentar Brevo como gasto nuevo de esta reactivacion.
- Las cifras de 10–20 EUR/mes mencionadas fueron una reserva orientativa, no una estimacion calculada ni una factura confirmada. No repetirlas como coste real.
- El numero de partidas varia segun el mes. Para estimar importes reales, revisar el consumo y la facturacion despues de la reactivacion; el historial con dias de indisponibilidad no representa un mes operativo normal.
- Comprobado en produccion el 16 de noviembre: 70 funciones sin instancias minimas positivas y Cloud Run con CPU ociosa no facturada como instancia permanente; base de datos de unos 9 MB, archivos de menos de 1 GB y 14 backups READY. Son una fotografia de ese dia, no limites de gasto ni garantia de coste cero.
- Almacenamiento, PITR y backups pueden generar cargos incluso sin partidas. Las cuotas gratuitas dependen del servicio; algunas se comparten por cuenta de facturacion.

### Restricciones que siguen vigentes

- Vigilancia diaria en solo lectura; no activar App Check automaticamente. Produccion mantiene enforcement desactivado y staging lo mantiene exigido.
- MFA sigue excluida por decision del usuario. La prueba manual A/B esta superada y no se repite.
- No equiparar backups READY a recuperacion completa de identidades e infraestructura. No cambiar ni restaurar recursos sin autorizacion.

## Registro historico — 8 de mayo de 2026

El contenido que sigue se conserva como historial. No se ha revalidado como arquitectura o lista de pendientes actual; no ejecutar sus recomendaciones antiguas por iniciativa propia.

## Objetivo de la plataforma

Kreatum es una plataforma de workshop en tiempo real con dos superficies:

- Jugadores: entran desde `/`, introducen codigo de sala, eligen equipo y trabajan las fases.
- Alquimista/admin: entra desde `/admin` o `/alquimista`, crea la partida y controla el avance global.

La regla central es que el Alquimista es la fuente de verdad de la fase activa. Los jugadores no avanzan fases manualmente: cuando el admin cambia la fase global, todos los equipos pasan automaticamente a esa fase.

## Flujo funcional

1. El admin inicia sesion con Firebase Auth email/password.
2. El admin crea una partida con reto obligatorio, cliente/facilitador opcionales y codigo automatico o personalizado.
3. Firestore crea `games/{gameId}` con `status: active`, `currentPhase: Selección`, `roomCode` y `unlockedPhases`.
4. Los jugadores introducen el codigo, eligen equipo y se crea/actualiza `games/{gameId}/teams/{teamName}`.
5. El admin cambia fases desde el panel. `currentPhase` en `games/{gameId}` mueve a todos los jugadores.
6. En Sublimar, Defensa se desbloquea con un flag independiente: `sublimarDefenseUnlocked`.
7. Cuando el admin finaliza el workshop, la partida pasa a `status: completed` y los jugadores salen automaticamente a la pantalla inicial de codigo.

## Fases

Orden oficial:

1. Selección
2. Calcinar
3. Diluir
4. Conjugar
5. Sublimar
6. Fermentar
7. Proyectar

`PHASES` esta definido en `src/types.ts`.

## Modelo Firestore

### `games/{gameId}`

Campos principales:

- `createdAt`
- `status`: `active` o `completed`
- `currentPhase`
- `roomCode`
- `client`
- `facilitator`
- `challenge`
- `unlockedPhases`
- `sublimarDefenseUnlocked`
- `sublimarDefenseUnlockedAt`
- `completedAt`

### `games/{gameId}/teams/{teamName}`

Guarda el estado del equipo:

- `playerId`
- `team`
- `currentPhase`
- respuestas de Diluir, Conjugar, Sublimar, Fermentar y Proyectar
- `isFinished`

El modelo actual es un documento por equipo. Si en el futuro se quiere multiples jugadores por equipo, habria que anadir una subcoleccion de miembros.

### `games/{gameId}/attacks/{attackId}`

Campos:

- `fromTeam`
- `toTeam`
- `content`
- `timestamp`
- `playerId`
- `editedAt`

El jugador puede editar y borrar solo sus propios ataques. El admin tambien puede borrar.

### `games/{gameId}/solutions/{teamName}`

Guarda la solucion definitiva de cada equipo para que otros equipos puedan verla en Sublimar.

## Seguridad Firestore

Reglas locales actualizadas:

- `games`: lectura para usuarios autenticados; creacion, actualizacion y borrado solo admin con email.
- `teams`: creacion por jugador autenticado con `playerId == request.auth.uid`; actualizacion solo propietario del equipo o admin.
- `attacks`: creacion/edicion/borrado restringido al propietario del ataque/equipo; admin puede borrar.
- `defenses`: mismo patron de propietario/equipo.
- `solutions`: escritura solo por propietario del equipo o admin.

Importante: despues de cambiar `firestore.rules` en local hay que desplegarlas en Firebase para que produccion las aplique.

## Codigos de sala

Longitud permitida: 4 a 10 caracteres.

Permitido: letras mayusculas y numeros.

Constantes:

- `ROOM_CODE_MIN_LENGTH`
- `ROOM_CODE_MAX_LENGTH`

Ambas estan en `src/types.ts` y se usan en admin, jugador y contexto.

## Assets publicos

Vite usa `public-app` como `publicDir`.

Eso evita que el build copie contenido antiguo de `public/Generador de Hablidiades`. La carpeta antigua puede seguir existiendo en disco, pero no entra en `dist` al construir con la configuracion actual.

Assets activos:

- `/logo.png`
- `/assets/hero-video.mp4`
- `/assets/logos/{agua,aire,fuego,tierra}.png`
- `/assets/logos/fases/{calcinar,conjugar,diluir,fermentar,proyectar,sublimar}.png`

## Validacion tecnica

Scripts:

- `npm run lint`: TypeScript sin emitir archivos.
- `npm run build`: build de Vite con `--configLoader runner`.

Se instalaron `@types/react` y `@types/react-dom` para que TypeScript valide correctamente React.

## Pendientes recomendados

- Desplegar reglas Firestore actualizadas.
- Probar flujo completo en entorno real con 4 equipos.
- Considerar code splitting porque el bundle principal supera 500 kB minificado.
- Resolver warnings CSS menores del build si se quiere dejar el pipeline completamente limpio.
