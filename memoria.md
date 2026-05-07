# Kreatum — Memoria Técnica

> Última actualización: 7 de mayo de 2026

---

## Arquitectura General

- **Framework**: React 19 + TypeScript + Vite 6
- **Estilos**: Tailwind CSS v4 (via `@tailwindcss/vite` plugin), tema custom en `index.css` con `@theme`
- **Base de datos**: Firebase Firestore (real-time listeners via `onSnapshot`)
- **Autenticación**: Firebase Auth — jugadores anónimos, admin con email/password
- **Animaciones**: `motion/react` (Framer Motion)
- **Routing**: `react-router-dom` v7 → `/` (jugadores), `/admin` o `/alquimista` (admin)
- **Deploy**: Vercel

---

## Estructura de Archivos

```
src/
├── main.tsx                    # Entry point, routing
├── PlayerApp.tsx               # Vista jugador
├── AdminApp.tsx                # Vista admin (login + crear partida + reset)
├── types.ts                    # Team, Phase, GameState, initialState
├── index.css                   # Tailwind theme + custom colors
├── contexts/
│   └── GameContext.tsx          # Auth, create/join/leave game, attacks, solutions
├── hooks/
│   └── useRealtime.ts          # onSnapshot hooks: teams, attacks, defenses, solutions, global
├── components/
│   ├── admin/
│   │   ├── AlchemistPanel.tsx   # Dashboard admin, control de fases, progreso equipos
│   │   └── GameHistory.tsx      # Historial de partidas, exportar CSV/JSON
│   ├── phases/
│   │   ├── TeamSelection.tsx    # Código de sala + selección de equipo
│   │   ├── Calcinar.tsx         # Fase 1 - inspiración
│   │   ├── Diluir.tsx           # Fase 2 - perspectivas (CP prefix, Enter→next)
│   │   ├── Conjugar.tsx         # Fase 3 - soluciones
│   │   ├── Sublimar.tsx         # Fase 4 - ataque/defensa/reformulación
│   │   ├── Fermentar.tsx        # Fase 5 - audiencia, fortalezas, debilidades, piloto, recursos
│   │   ├── Proyectar.tsx        # Fase 6 - pitch + Ver Resumen + Finalizar
│   │   └── WorkshopClosure.tsx  # Modal de resumen completo (reutilizable)
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── Textarea.tsx
│   ├── ErrorBoundary.tsx
│   └── HeroSplash.tsx
├── lib/
│   ├── firebase.ts             # Firebase config + init
│   ├── sounds.ts               # Audio feedback
│   └── utils.ts                # cn() utility
```

---

## Modelo de Datos (Firestore)

### Colección `games/{gameId}`
```
{
  createdAt: number,
  status: 'active' | 'completed',
  currentPhase: Phase,
  roomCode: string,
  client: string,
  facilitator: string,       // OPCIONAL
  challenge: string,          // OBLIGATORIO
  unlockedPhases: string[],   // Fases desbloqueadas por admin
  sublimarDefenseUnlocked?: boolean,     // Defensa desbloqueada (separado de Fermentar)
  sublimarDefenseUnlockedAt?: number,
  completedAt?: number,
}
```

### Subcolección `games/{gameId}/teams/{teamName}`
Almacena todo el estado del equipo (GameState parcial):
- `playerId`, `team`, `currentPhase`
- Diluir: `perspectives[]`, `top3Perspectives`, `perspectiveVotes`, `selectedPerspective`
- Conjugar: `solutions[]`, `top3Solutions`, `solutionVotes`, `selectedSolution`
- Sublimar: `defenses[]`, `reformulatedSolution`, `expectedResults`, `sublimarView`, `sublimarDefenseCompleted`
- Fermentar: `audience`, `strengths`, `weaknesses`, `pilot`, `resources`
- Proyectar: `pitchStart`, `pitchProblem`, `pitchSolution`, `pitchAction`
- `isFinished?: boolean` — marcado al 100% cuando jugador finaliza

### Subcolección `games/{gameId}/attacks/{attackId}`
```
{
  fromTeam: Team,
  toTeam: Team,
  content: string,
  timestamp: number,
  playerId: string,
  editedAt?: number,    // Se añade al editar
}
```

### Subcolección `games/{gameId}/defenses/{defenseId}`
```
{
  attackId: string,
  team: Team,
  content: string,
  timestamp: number,
  playerId: string,
}
```

### Subcolección `games/{gameId}/solutions/{teamName}`
```
{
  team: Team,
  content: string,
  timestamp: number,
}
```

---

## Control de Fases (Admin)

El Alquimista controla qué fases están disponibles:

1. **`currentPhase`** — fase activa global
2. **`unlockedPhases[]`** — lista de fases desbloqueadas
3. **`sublimarDefenseUnlocked`** — flag independiente para desbloquear Defensa en Sublimar

### Reglas de Progresión
- Jugadores NO avanzan libremente a partir de Diluir→Conjugar (índice ≥ 2)
- El admin desbloquea cada fase con `unlockPhase()`
- En Sublimar: hay 2 botones separados:
  - **"Desbloquear Defensa"** → `updateGlobalState({ sublimarDefenseUnlocked: true })`
  - **"Desbloquear Fermentar"** → `unlockPhase('Fermentar')`
- NO se usa `Fermentar` como bandera para abrir Defensa

### Progreso del Equipo en Dashboard
- `getTeamProgress()` devuelve 100% si `isFinished === true`
- En caso contrario: `(phaseIndex / totalPhases) * 100`
- Colores de barra de progreso: mapeo literal `TEAM_BAR_COLORS` (evita clases Tailwind dinámicas)

---

## Fase 2 — Diluir

- Cada input de perspectiva tiene prefijo visual **CP** (¿Cómo podríamos...?)
- Ayuda visible: "Inicia cada idea con: ¿Cómo podríamos...?"
- **Enter** → foco automático al siguiente campo (refs + setTimeout)
- El guardado de perspectivas no se ve afectado por el prefijo (el valor NO incluye "CP")

---

## Fase 4 — Sublimar

### Ataque
- Se muestra la solución definitiva propia del equipo
- Se muestra la solución del equipo rival (según `ATTACK_MAP`)
- Máximo 10 ataques por equipo
- Los ataques se pueden **editar** inline (botón lápiz → input → guardar)
- Los ataques se pueden **borrar** (botón X)
- `editAttack()` usa `updateDoc()` en Firestore

### Defensa
- Solo visible si: `attacksSent.length >= 10 && globalState.sublimarDefenseUnlocked === true`
- Layout horizontal: ataque a la izquierda ↔ mitigación a la derecha (grid 2 cols)
- Se muestra la solución definitiva propia como referencia
- Si ataques completos pero defensa no desbloqueada → mensaje de espera

### Reformulación
- `reformulatedSolution` + `expectedResults`
- Se guarda en `teams/{teamName}` con merge

---

## Fase 5 — Fermentar

Campos:
- Audiencia
- Fortalezas
- **Debilidades** (campo añadido, card amarilla)
- Prueba Piloto / Prototipo
- Recursos Necesarios

---

## Fase 6 — Proyectar

- Estructura del pitch: 4 cards (Inicio, Problema, Solución, Acción)
- **Botón "Ver Resumen"**: abre `WorkshopClosure` como modal/portal
- **Botón "Finalizar Workshop"**:
  1. Guarda el pitch
  2. Marca `isFinished: true` en Firestore
  3. Muestra pantalla de felicitación: "¡Enhorabuena! Vamos a las votaciones."
  4. NO llama `leaveGame()` — el jugador ve la pantalla de éxito
  5. Admin ve progreso 100% en tiempo real

### WorkshopClosure (Modal Resumen)
- Reutilizable por jugadores y admin
- NO llama `leaveGame()` internamente — solo `onClose()`
- Muestra: Diluir, Conjugar, Sublimar, Fermentar (con debilidades), Proyectar
- El padre decide qué hacer al cerrar

---

## Seguridad

### AdminApp
- Facilitador: **OPCIONAL** (no validación obligatoria)
- Reto/Challenge: **OBLIGATORIO**
- `KREATUM2026` **ELIMINADO** completamente
- Reset usa confirmación **"BORRAR TODO"** (no código secreto)
- Función renombrada a `purgeAllGames()` — no expuesta como acción normal
- Modales propios en lugar de `alert()`/`confirm()` nativos

### Room Codes
- Al crear partida: se valida unicidad del código
- Código automático: reintenta hasta 10 veces si existe
- Código personalizado: error claro si ya existe

### Firestore Rules
- Games: read=auth, create=auth, update/delete=admin (email)
- Teams: create=auth, update=owner OR admin
- Attacks: create=owner, update=owner (editar), delete=owner OR admin
- Defenses: create=owner, update=owner, delete=owner OR admin
- Solutions: read=auth, write=auth

---

## Colores de Equipo (Tailwind)

| Equipo | Color | Clase |
|--------|-------|-------|
| Fuego  | Rojo  | `kreatum-red` (#E73F1E) |
| Agua   | Azul  | `kreatum-blue` (#4486C6) |
| Tierra | Verde | `kreatum-green` (#59B7A9) |
| Aire   | Turquesa | `kreatum-turquoise` (#17ABBD) |

⚠️ Las barras de progreso usan `TEAM_BAR_COLORS` (mapeo literal) para evitar clases Tailwind dinámicas que no se generan en producción.

---

## Assets

- **Logos de equipo**: `/public/assets/logos/{fuego,agua,tierra,aire}.png`
- **Logos de fases**: Están en el archivo PPTX `Logo Kreatum/Logos de las fases.pptx` — pendiente de extraer a PNG individuales
- **Logo principal**: `/public/logo.png`
- **Video hero**: `/public/assets/hero-video.mp4`

---

## Decisiones Técnicas

1. **Hooks antes de returns condicionales** — Sublimar mueve todos los hooks antes del `if (!myTeam) return`
2. **Refs para focus** — Diluir usa `useRef<HTMLInputElement[]>` para Enter→next
3. **Portal para modales** — WorkshopClosure y Proyectar summary usan `createPortal` para evitar issues con `transform` de motion.div
4. **Debounce implícito** — updateTeamSync es merge, no replace
5. **Estado global vs local** — `sublimarDefenseUnlocked` en doc de game (global), `defenses[]` en doc de team (local)
6. **Build**: Vite build pasa sin errores TS (los errores de ErrorBoundary son pre-existentes y no afectan la build)
