import React, { useState, useEffect, useRef } from 'react';
import { GameState, initialState, Phase, Team, PHASES } from './types';
import { Button } from './components/ui/Button';
import { Hexagon, Moon, Sun } from 'lucide-react';
import { cn } from './lib/utils';
import { TeamSelection } from './components/phases/TeamSelection';
import { Calcinar } from './components/phases/Calcinar';
import { Diluir } from './components/phases/Diluir';
import { Conjugar } from './components/phases/Conjugar';
import { Sublimar } from './components/phases/Sublimar';
import { Fermentar } from './components/phases/Fermentar';
import { Proyectar } from './components/phases/Proyectar';

import { AnimatePresence, motion } from 'motion/react';
import { useTeamSync, useGameGlobal } from './hooks/useRealtime';
import { useGame } from './contexts/GameContext';

export default function PlayerApp() {
  const { gameId, team, isAlchemist, leaveGame, roomCode } = useGame();
  const [state, setState] = useState<GameState>({ ...initialState, team: team || null });
  const [isDark, setIsDark] = useState(false);

  const { teamState, updateTeamSync } = useTeamSync(gameId, team || state.team);
  const { globalState, isLoading: isGlobalLoading } = useGameGlobal(gameId);

  const challenge = globalState?.challenge || '';

  // Ref to hold the latest leaveGame function so the timeout always uses the current one
  // without causing the useEffect to re-run (leaveGame is not memoized in GameContext).
  const leaveGameRef = useRef(leaveGame);
  useEffect(() => { leaveGameRef.current = leaveGame; }, [leaveGame]);

  const updateState = (updates: Partial<GameState>) => {
    setState(prev => {
      const newState = { ...prev, ...updates };
      updateTeamSync(updates);
      return newState;
    });
  };

  // Sync context team into local state
  useEffect(() => {
    if (team) {
      setState(prev => ({ ...prev, team }));
    }
    if (!team && !gameId && state.team) {
      setState({ ...initialState });
    }
  }, [team, gameId]);

  // The Alchemist owns the canonical phase. Players mirror it automatically.
  useEffect(() => {
    if (globalState?.currentPhase && !isAlchemist && globalState.currentPhase !== state.currentPhase) {
      updateState({ currentPhase: globalState.currentPhase as Phase });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [globalState?.currentPhase, isAlchemist]);

  // When the Alchemist closes the workshop, players return to the code screen.
  useEffect(() => {
    if (globalState?.status === 'completed' && !isAlchemist && gameId) {
      setState({ ...initialState });
      leaveGameRef.current();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [globalState?.status, isAlchemist, gameId]);

  // Sync Firestore team state to local state
  useEffect(() => {
    if (teamState && Object.keys(teamState).length > 0) {
      setState(prev => ({ ...prev, ...teamState }));
    }
  }, [teamState]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const currentIndex = PHASES.indexOf(state.currentPhase);

  const getTeamColor = (team: Team | null) => {
    switch (team) {
      case 'Fuego': return 'text-kreatum-red bg-kreatum-red/10 border-kreatum-red/20';
      case 'Agua': return 'text-kreatum-blue bg-kreatum-blue/10 border-kreatum-blue/20';
      case 'Tierra': return 'text-kreatum-green bg-kreatum-green/10 border-kreatum-green/20';
      case 'Aire': return 'text-kreatum-turquoise bg-kreatum-turquoise/10 border-kreatum-turquoise/20';
      default: return 'text-kreatum-gray dark:text-white/60 bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10';
    }
  };

  const TeamIcon = ({ team, className }: { team: Team | null, className?: string }) => {
    if (team) {
      return (
        <img 
          src={`/assets/logos/${team.toLowerCase()}.png`} 
          alt={team} 
          className={cn("object-contain", className)} 
        />
      );
    }
    return <Hexagon className={className} />;
  };

  // Evitar parpadeo de Selección al recargar con sesión activa
  const isRecoveringSession = gameId && team && isGlobalLoading;

  if (isRecoveringSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kreatum-bg-light dark:bg-kreatum-bg-dark">
        <div className="w-8 h-8 border-2 border-kreatum-purple/30 border-t-kreatum-purple rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] text-kreatum-gray transition-colors duration-300 dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)] dark:text-white font-sans">
      
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/[0.92] backdrop-blur-md transition-colors duration-300 dark:border-white/[0.08] dark:bg-[#0f1117]/95">

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <img 
                src="/logo.png" 
                alt="Kreatum Logo" 
                className="h-9 w-auto object-contain" 
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {gameId && (
              <div className="hidden md:flex h-9 items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.03] px-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <span className="text-xs font-semibold text-kreatum-gray/55 dark:text-white/45">Sala</span>
                <span className="font-mono font-bold text-kreatum-purple">{roomCode || '---'}</span>
              </div>
            )}
            
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors text-kreatum-gray dark:text-white/60 focus:outline-none"
              aria-label="Toggle Theme"
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {gameId && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={leaveGame}
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-xl"
              >
                Salir
              </Button>
            )}

            {state.team && state.currentPhase !== 'Selección' && (
              <div className={cn("flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold", getTeamColor(state.team))}>
                <TeamIcon team={state.team} className="w-4 h-4" />
                Equipo {state.team}
              </div>
            )}
          </div>
        </div>
        
        {/* Progress Stepper — desktop: full labels, mobile: compact dots */}
        {state.currentPhase !== 'Selección' && (
          <div className="border-t border-black/[0.06] bg-white/70 transition-colors duration-300 dark:border-white/[0.08] dark:bg-white/[0.03]">
            {/* Desktop stepper */}
            <div className="hidden md:flex max-w-7xl mx-auto px-6 lg:px-8 py-3 items-center gap-5 text-xs font-semibold whitespace-nowrap overflow-x-auto">
              {PHASES.slice(1).map((phase, idx) => {
                const isActive = phase === state.currentPhase;
                const isPassed = PHASES.indexOf(phase) < currentIndex;
                return (
                  <div key={phase} className={cn(
                    "flex items-center gap-2 transition-colors",
                    isActive ? "text-kreatum-purple" : isPassed ? "text-kreatum-gray dark:text-white/60" : "text-kreatum-gray-light/60 dark:text-white/30"
                  )}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors border",
                      isActive ? "bg-kreatum-purple text-white border-kreatum-purple" : isPassed ? "bg-white dark:bg-white/[0.08] text-kreatum-gray dark:text-white/80 border-black/[0.08] dark:border-white/[0.08]" : "bg-transparent text-kreatum-gray-light dark:text-white/30 border-black/[0.08] dark:border-white/[0.08]"
                    )}>
                      {isPassed ? <span className="text-[10px]">✓</span> : idx + 1}
                    </div>
                    <span className="hidden lg:block">{phase}</span>
                  </div>
                );
              })}
            </div>
            {/* Mobile stepper: compact progress bar + current phase name */}
            <div className="md:hidden flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-kreatum-purple rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((currentIndex / (PHASES.length - 1)) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-kreatum-purple whitespace-nowrap">
                {currentIndex}/{PHASES.length - 1} &middot; {state.currentPhase}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Challenge Banner */}
      {challenge && state.team && !['Selección', 'Calcinar', 'Diluir'].includes(state.currentPhase) && (
        <div className="sticky top-16 z-20 px-4 md:px-6 py-3 pointer-events-none">
          <div className="max-w-7xl mx-auto flex justify-end">
            <motion.div 
              initial={{ x: 16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-auto"
            >
              {/* Mobile: compact pill */}
              <div className="md:hidden relative flex items-center gap-3 pl-4 pr-3 py-2 bg-white/95 dark:bg-[#11141b] rounded-xl border border-black/[0.08] dark:border-white/[0.08] shadow-[0_14px_30px_-24px_rgba(16,47,64,0.55)]">
                <div className="w-6 h-6 bg-kreatum-purple rounded-lg flex items-center justify-center shrink-0">
                  <Hexagon className="w-3 h-3 text-white" />
                </div>
                <p className="text-xs font-semibold text-kreatum-dark dark:text-white leading-tight max-w-[180px] line-clamp-1">
                  "{challenge}"
                </p>
              </div>

              {/* Desktop: full pill */}
              <div className="hidden md:flex relative items-center gap-4 pl-5 pr-4 py-3 bg-white/95 dark:bg-[#11141b] rounded-2xl border border-black/[0.08] dark:border-white/[0.08] shadow-[0_16px_36px_-28px_rgba(16,47,64,0.6)]">
                <div className="flex flex-col items-end">
                  <span className="text-xs font-bold text-kreatum-purple/80 mb-1">
                    Reto Activo
                  </span>
                  <p className="text-sm font-semibold text-kreatum-dark dark:text-white leading-snug text-right max-w-[360px] line-clamp-2">
                    "{challenge}"
                  </p>
                </div>
                <div className="w-10 h-10 bg-kreatum-purple rounded-xl flex items-center justify-center shrink-0">
                  <Hexagon className="w-5 h-5 text-white" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 md:py-12 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={state.currentPhase}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            className="reveal-cascade"
          >

            {state.currentPhase === 'Selección' && <TeamSelection state={state} updateState={updateState} />}
            {state.currentPhase === 'Calcinar' && <Calcinar />}
            {state.currentPhase === 'Diluir' && <Diluir state={state} updateState={updateState} />}
            {state.currentPhase === 'Conjugar' && <Conjugar state={state} updateState={updateState} />}
            {state.currentPhase === 'Sublimar' && <Sublimar state={state} updateState={updateState} />}
            {state.currentPhase === 'Fermentar' && <Fermentar state={state} updateState={updateState} />}
            {state.currentPhase === 'Proyectar' && <Proyectar state={state} updateState={updateState} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer / Status */}
      {state.team && !state.isFinished && (
        <footer className="bg-white/[0.88] dark:bg-[#0f1117]/[0.92] border-t border-black/[0.06] dark:border-white/[0.08] mt-auto relative z-20 transition-colors duration-300">

          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-center">
            <div className="px-5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] text-center">
              <p className="text-xs font-bold text-kreatum-purple">
                Fase controlada por el Alquimista
              </p>
              <p className="text-sm text-kreatum-gray/60 dark:text-white/50 mt-1">
                Avanzareis automaticamente cuando el facilitador abra la siguiente fase.
              </p>
            </div>
          </div>
        </footer>
      )}

    </div>
  );
}
