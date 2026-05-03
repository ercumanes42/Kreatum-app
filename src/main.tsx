import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PlayerApp from './PlayerApp';
import AdminApp from './AdminApp';
import { GameProvider } from './contexts/GameContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <GameProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<PlayerApp />} />
            <Route path="/admin" element={<AdminApp />} />
            <Route path="/alquimista" element={<AdminApp />} />
          </Routes>
        </BrowserRouter>
      </GameProvider>
    </ErrorBoundary>
  </StrictMode>,
);
