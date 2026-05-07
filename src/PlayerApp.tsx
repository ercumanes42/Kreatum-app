import React, { useState, useEffect, useRef } from 'react';
import { GameState, initialState, Phase, Team, PHASES } from './types';
import { Button } from './components/ui/Button';
import { ChevronRight, ChevronLeft, Hexagon, Moon, Sun } from 'lucide-react';
import { cn } from './lib/utils';
import { TeamSelection } from './components/phases/TeamSelection';
import { Calcinar } from './components/phases/Calcinar';
import { Diluir } from './components/phases/Diluir';
import { Conjugar } from './components/phases/Conjugar';
import { Sublimar } from './components/phases/Sublimar';
import { Fermentar } from './components/phases/Fermentar';
import { Proyectar } from './components/phases/Proyectar';

import { sounds } from './lib/sounds';
import { AnimatePresence, motion } from 'motion/react';
import { useAttacksSent, useTeamSync, useGameGlobal } from './hooks/useRealtime';
import { useGame } from './contexts/GameContext';
import { HeroSplash } from './components/HeroSplash';



const MIN_ATTACKS_PER_TEAM = 10;

export default function PlayerApp() {
  const { gameId, team, isAlchemist, leaveGame, roomCode } = useGame();
  const [state, setState] = useState<GameState>({ ...initialState, team: team || null });
  const [isDark, setIsDark] = useState(false);
  const [workshopEnded, setWorkshopEnded] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    if (localStorage.getItem('kreatum_splash_seen') === 'true') {
      return false;
    }
    return true;
  });

  const { teamState, updateTeamSync } = useTeamSync(gameId, team || state.team);
  const { attacks: attacksSent } = useAttacksSent(gameId, team || state.team);
  const { globalState, isLoading: isGlobalLoading } = useGameGlobal(gameId);

  const challenge = globalState?.challenge || '';
  // Para compatibilidad hacia atrás: si no existe unlockedPhases, permitir progreso libre
  const hasUnlockedPhases = globalState?.unlockedPhases && globalState.unlockedPhases.length > 0;
  const unlockedPhases = hasUnlockedPhases ? (globalState.unlockedPhases as string[]) : PHASES;

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
      setWorkshopEnded(false);
    }
  }, [team, gameId]);

  // Sync Global Phase and Status to local state for regular players
  useEffect(() => {
    if (globalState?.currentPhase && !isAlchemist && globalState.currentPhase !== state.currentPhase) {
      // Intercept transition from Sublimar to Fermentar if they haven't seen 'Defensa'
      if (
        state.currentPhase === 'Sublimar' && 
        globalState.currentPhase === 'Fermentar' && 
        state.sublimarView !== 'Defensa'
      ) {
        // Keep them in Sublimar but switch to Defensa
        updateState({ currentPhase: 'Sublimar', sublimarView: 'Defensa' });
        return;
      }
      
      updateState({ currentPhase: globalState.currentPhase as Phase });
      // Scroll to top when the Alchemist changes the phase remotely
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [globalState?.currentPhase, isAlchemist]);

  // Handle workshop completion by admin
  useEffect(() => {
    if (globalState?.status === 'completed' && !isAlchemist && !workshopEnded) {
      setWorkshopEnded(true);
      // Brief message, then redirect via ref (avoids effect re-run cycle)
      const timer = setTimeout(() => {
        leaveGameRef.current();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [globalState?.status, isAlchemist, workshopEnded]);

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

  const nextPhase = () => {
    if (currentIndex < PHASES.length - 1) {
      if (currentIndex === PHASES.length - 2) sounds.playSuccess();
      else sounds.playClick();
      updateState({ currentPhase: PHASES[currentIndex + 1] });
      window.scrollTo(0, 0);
    }
  };

  const prevPhase = () => {
    // Si estamos en Sublimar y en la vista de Defensa, volver a Ataque en lugar de cambiar de fase
    if (state.currentPhase === 'Sublimar' && state.sublimarView === 'Defensa') {
      updateState({ sublimarView: 'Ataque' });
      return;
    }

    const currentIndex = PHASES.indexOf(state.currentPhase);
    if (currentIndex > 0) {
      sounds.playClick();
      const prevPhaseName = PHASES[currentIndex - 1];
      updateState({ currentPhase: prevPhaseName });
      window.scrollTo(0, 0);
    }
  };

  const isNextDisabled = () => {
    if (currentIndex === PHASES.length - 1) return true;
    if (state.currentPhase === 'Selección' && !state.team) return true;
    
    const nextPhaseName = PHASES[currentIndex + 1];
    // Bloquear a partir de pasar de Diluir a Conjugar (índice 2 en adelante)
    if (currentIndex >= 2) {
      if (!unlockedPhases.includes(nextPhaseName)) return true;
    }

    if (state.currentPhase === 'Sublimar') {
      if (!state.team) return true;
      return attacksSent.length < MIN_ATTACKS_PER_TEAM;
    }

    return false;
  };

  const blockedByAlchemist = () => {
    if (currentIndex === PHASES.length - 1) return false;
    const nextPhaseName = PHASES[currentIndex + 1];
    // Mostrar bloqueo a partir de Diluir a Conjugar
    if (currentIndex >= 2) {
      return nextPhaseName && !unlockedPhases.includes(nextPhaseName);
    }
    return false;
  };

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

  const getBgColors = (phase: Phase) => {
    switch(phase) {
      case 'Selección': return { bg1: 'bg-kreatum-blue/10 dark:bg-kreatum-blue/20', bg2: 'bg-kreatum-turquoise/10 dark:bg-kreatum-turquoise/10' };
      case 'Calcinar': return { bg1: 'bg-kreatum-red/10 dark:bg-kreatum-red/20', bg2: 'bg-kreatum-orange/10 dark:bg-kreatum-orange/10' };
      case 'Diluir': return { bg1: 'bg-kreatum-turquoise/10 dark:bg-kreatum-turquoise/20', bg2: 'bg-kreatum-blue/10 dark:bg-kreatum-blue/10' };
      case 'Conjugar': return { bg1: 'bg-kreatum-purple/10 dark:bg-kreatum-purple/20', bg2: 'bg-kreatum-blue/10 dark:bg-kreatum-blue/10' };
      case 'Sublimar': return { bg1: 'bg-kreatum-red/10 dark:bg-kreatum-red/20', bg2: 'bg-black/10 dark:bg-white/5' };
      case 'Fermentar': return { bg1: 'bg-kreatum-green/10 dark:bg-kreatum-green/20', bg2: 'bg-kreatum-turquoise/10 dark:bg-kreatum-turquoise/10' };
      case 'Proyectar': return { bg1: 'bg-amber-500/10 dark:bg-amber-500/20', bg2: 'bg-kreatum-purple/10 dark:bg-kreatum-purple/10' };
      default: return { bg1: 'bg-kreatum-purple/10 dark:bg-kreatum-purple/20', bg2: 'bg-kreatum-orange/10 dark:bg-kreatum-orange/10' };
    }
  };

  const { bg1, bg2 } = getBgColors(state.currentPhase);

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
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-kreatum-bg-light dark:bg-kreatum-bg-dark text-kreatum-gray dark:text-white transition-colors duration-500 font-sans">
      <div className="grain-overlay" />
      
      {/* Hero Video Splash */}
      {showSplash && <HeroSplash onDismiss={() => {
        setShowSplash(false);
        localStorage.setItem('kreatum_splash_seen', 'true');
      }} />}

      {/* Immersive background orbs - Refined for senior depth */}
      <div className={cn("fixed -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[200px] pointer-events-none z-0 transition-colors duration-1000 opacity-30", bg1)}></div>
      <div className={cn("fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[200px] pointer-events-none z-0 transition-colors duration-1000 opacity-30", bg2)}></div>

      {/* Header */}
      <header className="bg-white/60 dark:bg-black/60 backdrop-blur-3xl border-b border-black/5 dark:border-white/10 sticky top-0 z-20 transition-colors duration-500">

        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <img 
                src="/logo.png" 
                alt="Kreatum Logo" 
                className="h-10 w-auto object-contain transition-transform duration-500 group-hover:scale-105" 
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {gameId && (
              <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-black/5 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-50">Sala:</span>
                <span className="font-mono font-bold text-kreatum-purple">{roomCode || '---'}</span>
              </div>
            )}
            
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-kreatum-gray dark:text-white/60 focus:outline-none"
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
              <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium backdrop-blur-md", getTeamColor(state.team))}>
                <TeamIcon team={state.team} className="w-4 h-4" />
                Equipo {state.team}
              </div>
            )}
          </div>
        </div>
        
        {/* Progress Stepper — desktop: full labels, mobile: compact dots */}
        {state.currentPhase !== 'Selección' && (
          <div className="bg-black/5 dark:bg-white/5 border-t border-black/5 dark:border-white/5 transition-colors duration-300">
            {/* Desktop stepper */}
            <div className="hidden md:flex max-w-7xl mx-auto px-6 lg:px-8 py-3 items-center gap-6 text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap overflow-x-auto">
              {PHASES.slice(1).map((phase, idx) => {
                const isActive = phase === state.currentPhase;
                const isPassed = PHASES.indexOf(phase) < currentIndex;
                return (
                  <div key={phase} className={cn(
                    "flex items-center gap-2 transition-colors",
                    isActive ? "text-kreatum-purple" : isPassed ? "text-kreatum-gray dark:text-white/60" : "text-kreatum-gray-light/60 dark:text-white/30"
                  )}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                      isActive ? "bg-kreatum-purple/20 text-kreatum-purple border border-kreatum-purple/50 shadow-[0_0_15px_rgba(162,84,156,0.3)]" : isPassed ? "bg-black/10 dark:bg-white/10 text-kreatum-gray dark:text-white/80" : "bg-black/5 dark:bg-white/5 text-kreatum-gray-light dark:text-white/30"
                    )}>
                      {isPassed ? <span className="text-[8px]">✓</span> : idx + 1}
                    </div>
                    <span className="hidden lg:block">{phase}</span>
                  </div>
                );
              })}
            </div>
            {/* Mobile stepper: compact progress bar + current phase name */}
            <div className="md:hidden flex items-center gap-3 px-4 py-2">
              <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-kreatum-purple rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((currentIndex / (PHASES.length - 1)) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono font-bold text-kreatum-purple whitespace-nowrap">
                {currentIndex}/{PHASES.length - 1} &middot; {state.currentPhase}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Premium Challenge Banner */}
      {challenge && state.team && !['Selección', 'Calcinar', 'Diluir'].includes(state.currentPhase) && (
        <div className="sticky top-[80px] z-20 px-4 md:px-6 py-3 pointer-events-none">
          <div className="max-w-7xl mx-auto flex justify-end">
            <motion.div 
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="pointer-events-auto relative group"
            >
              {/* Glow */}
              <div className="absolute -inset-0.5 bg-gradient-to-r from-kreatum-purple to-kreatum-turquoise rounded-[2rem] blur opacity-20 group-hover:opacity-40 transition duration-500" />
              
              {/* Mobile: compact pill */}
              <div className="md:hidden relative flex items-center gap-3 pl-4 pr-3 py-2 bg-white/90 dark:bg-black/70 backdrop-blur-xl rounded-full border border-white/20 dark:border-white/10 shadow-xl shadow-kreatum-purple/10">
                <div className="w-6 h-6 bg-gradient-to-br from-kreatum-purple to-kreatum-purple-dark rounded-full flex items-center justify-center shrink-0">
                  <Hexagon className="w-3 h-3 text-white" />
                </div>
                <p className="text-xs font-serif text-kreatum-dark dark:text-white leading-tight italic opacity-90 max-w-[160px] line-clamp-1">
                  "{challenge}"
                </p>
              </div>

              {/* Desktop: full pill */}
              <div className="hidden md:flex relative items-center gap-6 pl-8 pr-4 py-2.5 bg-white/80 dark:bg-black/60 backdrop-blur-xl rounded-[2rem] border border-white/20 dark:border-white/10 shadow-2xl shadow-kreatum-purple/10">
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-kreatum-purple/70 font-black mb-1">
                    Reto Activo
                  </span>
                  <p className="text-base font-serif text-kreatum-dark dark:text-white leading-tight italic opacity-90 text-right max-w-[300px] line-clamp-2">
                    "{challenge}"
                  </p>
                </div>
                <div className="w-12 h-12 bg-gradient-to-br from-kreatum-purple to-kreatum-purple-dark rounded-full flex items-center justify-center shadow-lg shadow-kreatum-purple/20 shrink-0">
                  <Hexagon className="w-6 h-6 text-white" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {/* Workshop ended overlay */}
      {workshopEnded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-6 max-w-md px-8"
          >
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-kreatum-purple to-kreatum-turquoise rounded-[32px] flex items-center justify-center shadow-[0_20px_50px_rgba(162,84,156,0.5)]">
              <Hexagon className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-5xl md:text-7xl h1-agency text-white font-serif">¡Enhorabuena!</h1>
            <p className="text-xl text-white/70 font-mono tracking-widest uppercase">Has finalizado el workshop.<br/>Vamos a las votaciones.</p>
            <div className="w-12 h-0.5 bg-gradient-to-r from-transparent via-white/50 to-transparent mx-auto" />
          </motion.div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-12 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={state.currentPhase}
            initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -40, filter: 'blur(10px)' }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
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

      {/* Footer / Navigation */}
      {state.team && !workshopEnded && !state.isFinished && (
        <footer className="bg-white/40 dark:bg-black/40 backdrop-blur-2xl border-t border-black/5 dark:border-white/5 mt-auto relative z-20 transition-colors duration-300">

          <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
            <Button 
              variant="ghost" 
              onClick={prevPhase} 
              disabled={currentIndex === 0}
              className="flex gap-2 text-kreatum-gray dark:text-white/80"
            >
              <ChevronLeft className="w-4 h-4" />
              Atrás
            </Button>
            
            <Button 
              onClick={() => {
                if (currentIndex === PHASES.length - 1) {
                  return; // Finalization handled inside Proyectar
                } else {
                  nextPhase();
                }
              }}
              disabled={isNextDisabled()}
              title={blockedByAlchemist() ? 'El Alquimista aún no ha desbloqueado esta fase' : ''}
              className={cn(
                "flex gap-2 btn-premium",
                currentIndex === PHASES.length - 1
                  ? "bg-kreatum-purple hover:bg-kreatum-purple-dark text-white shadow-premium"
                  : blockedByAlchemist()
                    ? "opacity-50 cursor-not-allowed"
                    : ""
              )}
            >
              {currentIndex === PHASES.length - 1 ? '✦ Finalizar Workshop' : blockedByAlchemist() ? (
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Esperando al Alquimista
                </span>
              ) : 'Siguiente Fase'}
              <ChevronRight className="w-4 h-4" />


            </Button>
          </div>
        </footer>
      )}

    </div>
  );
}
