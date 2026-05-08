# Kreatum - Memoria tecnica

Ultima actualizacion: 8 de mayo de 2026

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
