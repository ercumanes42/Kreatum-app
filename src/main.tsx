// Force redeploy - Phase 4 Fixes
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import PlayerApp from './PlayerApp';
import { GameProvider } from './contexts/GameContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const AdminApp = lazy(() => import('./AdminApp'));
const ActivationApp = lazy(() => import('./ActivationApp'));
const PlatformApp = lazy(() => import('./PlatformApp'));

function KreatumRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin' || path === '/alquimista') return <AdminApp />;
  if (path === '/activar') return <ActivationApp />;
  if (path === '/platform') return <PlatformApp />;
  if (path === '/') return <PlayerApp />;

  return (
    <main className="min-h-screen grid place-items-center bg-kreatum-bg-light px-6 text-center">
      <div>
        <h1 className="text-3xl font-extrabold text-kreatum-dark">Página no encontrada</h1>
        <p className="mt-3 text-kreatum-gray/70">La dirección solicitada no existe.</p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-xl bg-kreatum-purple px-5 py-3 font-bold text-white"
        >
          Volver a KREATUM
        </a>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <GameProvider>
        <Suspense
          fallback={(
            <div
              className="min-h-screen grid place-items-center bg-kreatum-bg-light"
              role="status"
            >
              Cargando KREATUM...
            </div>
          )}
        >
          <KreatumRoute />
        </Suspense>
      </GameProvider>
    </ErrorBoundary>
  </StrictMode>,
);
