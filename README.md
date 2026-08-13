# KREATUM

Plataforma web del juego de innovación KREATUM. La dinámica funcional es un contrato del producto y no debe alterarse:

- Equipos: Fuego, Agua, Aire y Tierra.
- Etapas: Selección, Calcinar, Diluir, Conjugar, Sublimar, Fermentar y Proyectar.
- Acceso: el Alquimista crea la partida; los participantes escriben el código en su PC y eligen equipo.

## Arquitectura

- React 19 + TypeScript + Vite.
- Firebase Authentication, Firestore, Cloud Functions v2 y Cloud Storage.
- Aislamiento por organización y roles administrativos `owner` y `facilitator`.
- Participantes con sesión anónima temporal, sin registro ni correo.
- Firebase Hosting para staging y cabeceras de seguridad; producción permanece separada.

Consulta [arquitectura](docs/ARCHITECTURE.md), [operación](docs/OPERATIONS.md), [seguridad](docs/SECURITY.md), [migración](docs/MIGRATION.md) e [informes](docs/REPORTS.md).

## Desarrollo local

Requisitos: Node.js 22, npm y Firebase CLI 15.2.0.

```powershell
Copy-Item .env.example .env.local
npm ci
npm --prefix functions ci
npm run dev
```

Configura `.env.local` con un proyecto de desarrollo o los emuladores. No uses credenciales de producción.

## Verificación

```powershell
npm run lint
npm run typecheck
npm run typecheck:functions
npm run test:unit
npm run test:rules
npm run build
npm run build:functions
npm run test:integration
npm run test:migration
npm run test:e2e
npm run test:load
```

`npm run verify` ejecuta el conjunto rápido de calidad. Las pruebas de integración y E2E se ejecutan por separado porque levantan emuladores o navegadores.

## Despliegue

No hay despliegue automático. Antes de producción son obligatorios staging, copia de seguridad, verificación de migración y plan de rollback. Véase [OPERATIONS.md](docs/OPERATIONS.md).

La aplicación pública de producción permanece separada y no se modifica desde este repositorio sin aprobación explícita. El entorno validado es `https://kreatum-dinamic-staging.web.app/`; `/admin` reúne el panel del facilitador y enlaza a `/platform`, visible únicamente con el claim `platformAdmin=true`.
