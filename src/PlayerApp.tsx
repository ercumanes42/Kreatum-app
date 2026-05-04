import React, { useState, useEffect } from 'react';
import { GameState, initialState, Phase, Team } from './types';
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
import { WorkshopClosure } from './components/phases/WorkshopClosure';
import { sounds } from './lib/sounds';
import { AnimatePresence, motion } from 'motion/react';
import { useAttacksSent, useTeamSync, useGameGlobal } from './hooks/useRealtime';
import { useGame } from './contexts/GameContext';
import { HeroSplash } from './components/HeroSplash';

const PHASES: Phase[] = [
  'Selección',
  'Calcinar',
  'Diluir',
  'Conjugar',
  'Sublimar',
  'Fermentar',
  'Proyectar'
];

const MIN_ATTACKS_PER_TEAM = 10;

export default function PlayerApp() {
  const { gameId, team, isAlchemist, leaveGame, roomCode } = useGame();
  const [state, setState] = useState<GameState>({ ...initialState, team: team || null });
  const [isDark, setIsDark] = useState(false);
  const [showClosure, setShowClosure] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    if (localStorage.getItem('kreatum_splash_seen') === 'true') {
      return false;
    }
    const hasExistingSession =
      localStorage.getItem('kreatum_game_id') &&
      localStorage.getItem('kreatum_team');
    return !hasExistingSession;
  });
  const { teamState, updateTeamSync } = useTeamSync(gameId, team || state.team);

  const { attacks: attacksSent } = useAttacksSent(gameId, team || state.team);
  const { globalState, isLoading: isGlobalLoading } = useGameGlobal(gameId);
  const challenge = globalState?.challenge || '';
  // Para compatibilidad hacia atrás: si no existe unlockedPhases, permitir progreso libre
  const hasUnlockedPhases = globalState?.unlockedPhases && globalState.unlockedPhases.length > 0;
  const unlockedPhases = hasUnlockedPhases ? (globalState.unlockedPhases as string[]) : PHASES;

  // Sync context team into local state
  useEffect(() => {
    if (team && team !== state.team) {
      setState(prev => ({ ...prev, team }));
    }
    if (!team && !gameId && state.team) {
      setState({ ...initialState });
    }
  }, [team, gameId]);

  // Sync Global Phase and Status to local state for regular players
  useEffect(() => {
    if (globalState?.currentPhase && !isAlchemist) {
      setState(prev => ({ ...prev, currentPhase: globalState.currentPhase as Phase }));
    }

    if (globalState?.status === 'completed' && !isAlchemist) {
      alert("El Alquimista ha finalizado el workshop. La sesión se ha cerrado.");
      leaveGame();
    }
  }, [globalState?.currentPhase, globalState?.status, isAlchemist, leaveGame]);

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

  const updateState = (updates: Partial<GameState>) => {
    setState(prev => ({ ...prev, ...updates }));
    updateTeamSync(updates);
  };

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
    if (currentIndex > 0) {
      sounds.playClick();
      updateState({ currentPhase: PHASES[currentIndex - 1] });
      window.scrollTo(0, 0);
    }
  };

  const isNextDisabled = () => {
    if (currentIndex === PHASES.length - 1) return true;
    if (state.currentPhase === 'Selección' && !state.team) return true;
    
    const nextPhase = PHASES[currentIndex + 1];
    // Bloquear si la siguiente fase no ha sido desbloqueada por el Alquimista
    if (!unlockedPhases.includes(nextPhase)) return true;

    if (state.currentPhase === 'Sublimar') {
      if (!state.team) return true;
      return attacksSent.length < MIN_ATTACKS_PER_TEAM;
    }

    return false;
  };

  const blockedByAlchemist = () => {
    if (currentIndex === PHASES.length - 1) return false;
    const nextPhase = PHASES[currentIndex + 1];
    // Mostrar bloqueo si la siguiente fase no está desbloqueada
    return nextPhase && !unlockedPhases.includes(nextPhase);
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
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-kreatum-bg-light dark:bg-kreatum-bg-dark text-kreatum-gray dark:text-white transition-colors duration-500">
      {/* Hero Video Splash */}
      {showSplash && <HeroSplash onDismiss={() => {
        setShowSplash(false);
        localStorage.setItem('kreatum_splash_seen', 'true');
      }} />}

      {/* Immersive background orbs */}
      <div className={cn("fixed -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[140px] pointer-events-none z-0 transition-colors duration-1000", bg1)}></div>
      <div className={cn("fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[160px] pointer-events-none z-0 transition-colors duration-1000", bg2)}></div>

      {/* Header */}
      <header className="bg-white/40 dark:bg-black/40 backdrop-blur-2xl border-b border-black/5 dark:border-white/5 sticky top-0 z-20 transition-colors duration-500">
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
        
        {/* Progress Bar */}
        {state.currentPhase !== 'Selección' && (
          <div className="bg-black/5 dark:bg-white/5 border-t border-black/5 dark:border-white/5 flex overflow-x-auto no-scrollbar transition-colors duration-500">
            <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3 flex items-center gap-6 text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap w-full">
              {PHASES.slice(1).map((phase, idx) => {
                const isActive = phase === state.currentPhase;
                const isPassed = PHASES.indexOf(phase) < currentIndex;
                return (
                  <div key={phase} className={cn(
                    "flex items-center gap-2 transition-colors",
                    isActive ? "text-kreatum-purple" : isPassed ? "text-kreatum-gray dark:text-white/60" : "text-kreatum-gray-light/60 dark:text-white/60"
                  )}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center transition-colors",
                      isActive ? "bg-kreatum-purple/20 text-kreatum-purple border border-kreatum-purple/50 shadow-[0_0_15px_rgba(162,84,156,0.3)]" : isPassed ? "bg-black/10 dark:bg-white/10 text-kreatum-gray dark:text-white/80" : "bg-black/5 dark:bg-white/5 text-kreatum-gray-light dark:text-white/60"
                    )}>
                      {idx + 1}
                    </div>
                    <span>{phase}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Premium Challenge Banner */}
      {challenge && state.team && state.currentPhase !== 'Selección' && (
        <div className="w-full bg-gradient-to-r from-kreatum-purple/10 via-transparent to-kreatum-purple/10 border-b border-kreatum-purple/20 backdrop-blur-md px-6 py-4 relative z-20 overflow-hidden">
          {/* Subtle animated light effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />
          
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-3 bg-white/50 dark:bg-white/10 px-4 py-2 rounded-2xl border border-kreatum-purple/20 shadow-lg shadow-kreatum-purple/5 shrink-0">
              <div className="w-8 h-8 bg-kreatum-purple/20 rounded-xl flex items-center justify-center">
                <Hexagon className="w-4 h-4 text-kreatum-purple" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-kreatum-purple font-black whitespace-nowrap">
                Reto Activo
              </span>
            </div>
            
            <div className="hidden sm:block h-8 w-px bg-kreatum-purple/20" />
            
            <p className="text-lg font-serif text-kreatum-dark dark:text-white leading-tight italic opacity-90 text-center sm:text-left line-clamp-2">
              "{challenge}"
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-12 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={state.currentPhase}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {state.currentPhase === 'Selección' && <TeamSelection state={state} updateState={updateState} />}
            {state.currentPhase === 'Calcinar' && <Calcinar />}
            {state.currentPhase === 'Diluir' && <Diluir state={state} updateState={updateState} />}
            {state.currentPhase === 'Conjugar' && <Conjugar state={state} updateState={updateState} />}
            {state.currentPhase === 'Sublimar' && <Sublimar state={state} updateState={updateState} />}
            {state.currentPhase === 'Fermentar' && <Fermentar state={state} updateState={updateState} />}
            {state.currentPhase === 'Proyectar' && <Proyectar state={state} updateState={updateState} onShowClosure={() => setShowClosure(true)} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer / Navigation */}
      {state.team && (
        <footer className="bg-white/40 dark:bg-black/40 backdrop-blur-2xl border-t border-black/5 dark:border-white/5 mt-auto relative z-20 transition-colors duration-500">
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
                  sounds.playSuccess();
                  setShowClosure(true);
                } else {
                  nextPhase();
                }
              }}
              disabled={currentIndex === PHASES.length - 1 ? false : isNextDisabled()}
              title={blockedByAlchemist() ? 'El Alquimista aún no ha desbloqueado esta fase' : ''}
              className={cn(
                "flex gap-2",
                currentIndex === PHASES.length - 1
                  ? "bg-kreatum-purple hover:bg-kreatum-purple-dark text-white shadow-lg shadow-kreatum-purple/20"
                  : blockedByAlchemist()
                    ? "opacity-50 cursor-not-allowed"
                    : ""
              )}
            >
              {currentIndex === PHASES.length - 1 ? '✦ Finalizar Workshop' : blockedByAlchemist() ? '🔒 Esperando al Alquimista' : 'Siguiente Fase'}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </footer>
      )}

      {/* Workshop Closure Modal */}
      <WorkshopClosure
        state={state}
        isOpen={showClosure}
        onClose={() => setShowClosure(false)}
      />
    </div>
  );
}
