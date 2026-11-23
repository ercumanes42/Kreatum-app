import React, { useState, useEffect, useRef } from 'react';
import { GameState, initialState, Phase, Team, PHASES } from './types';
import { Button } from './components/ui/Button';
import { ActionDialog } from './components/ui/ActionDialog';
import { CheckCircle2, Cloud, Hexagon, LoaderCircle, Moon, Sun, WifiOff } from 'lucide-react';
import { cn, getDeviceCode } from './lib/utils';
import { TeamSelection } from './components/phases/TeamSelection';
import { Calcinar } from './components/phases/Calcinar';
import { Diluir } from './components/phases/Diluir';
import { Conjugar } from './components/phases/Conjugar';
import { Sublimar } from './components/phases/Sublimar';
import { Fermentar } from './components/phases/Fermentar';
import { Proyectar } from './components/phases/Proyectar';

import { AnimatePresence, motion } from 'motion/react';
import { useTeamSync, useGameGlobal, useParticipantSession } from './hooks/useRealtime';
import { isV2DataModel } from './lib/dataModel';
import { useGame } from './contexts/GameContext';
import { createIdempotencyKey, workshopApi } from './lib/workshopApi';
import { reportClientError } from './lib/clientLogger';
import { getWorkshopTransitionProgress } from './lib/workshopTransition';

function TeamIcon({ team, className }: { team: Team | null; className?: string }) {
  if (team) {
    return (
      <img
        src={`/assets/logos/${team.toLowerCase()}.png`}
        alt={team}
        className={cn('object-contain', className)}
      />
    );
  }
  return <Hexagon className={className} />;
}

export default function PlayerApp() {
  const {
    gameId,
    team,
    playerId,
    isAlchemist,
    leaveGame,
    clearTeamSelection,
    applyTeamReassignment,
    reconnectParticipantSession,
    roomCode,
  } = useGame();
  const [storedState, setState] = useState<GameState>({ ...initialState, team: team || null });
  // Context is authoritative: never render a departed workshop's cached phase.
  const state = gameId ? storedState : initialState;
  const [isDark, setIsDark] = useState(() => localStorage.getItem('kreatum_theme') === 'dark');
  const [hasEditedCurrentPhase, setHasEditedCurrentPhase] = useState(false);
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [exitError, setExitError] = useState('');

  const {
    teamState,
    updateTeamSync,
    flush: flushTeamChanges,
    isLoading: isTeamLoading,
    exists: teamExists,
    saveStatus,
    lastSavedAt,
    error: syncError,
  } = useTeamSync(gameId, team || state.team);
  const { globalState, refreshGlobalState, isLoading: isGlobalLoading } = useGameGlobal(gameId, true);
  const { session: participantSession, isLoading: isSessionLoading } = useParticipantSession(gameId, playerId);

  const challenge = globalState?.challenge || '';
  const [transitionError, setTransitionError] = useState('');
  const [isReconnectingSession, setIsReconnectingSession] = useState(false);
  const [reconnectError, setReconnectError] = useState('');
  const [isReconnectBlocked, setIsReconnectBlocked] = useState(false);
  const [sessionClock, setSessionClock] = useState(() => Date.now());
  const acknowledgedTransitionRef = useRef<string | null>(null);
  const participantSessionRef = useRef(participantSession);
  const transition = gameId ? globalState.transition : null;
  const transitionProgress = getWorkshopTransitionProgress(
    transition?.state === 'requested' ? transition : null,
    sessionClock,
  );
  const transitionBlocking = transition?.state === 'requested' && !transitionProgress.expired;
  const transitionNotice = transition?.state === 'requested'
    ? transitionProgress.expired
      ? 'La espera de cambio terminó. Tus datos guardados se conservan y puedes seguir trabajando mientras el facilitador reintenta.'
      : transitionError
    : '';

  useEffect(() => {
    participantSessionRef.current = participantSession;
  }, [participantSession]);

  useEffect(() => {
    if (transition?.state !== 'requested') return undefined;

    const expiresAt = transition.expiresAt;
    const remainingMs = Number.isFinite(expiresAt) && expiresAt > 0
      ? Math.max(0, expiresAt - Date.now())
      : 0;
    const timeoutId = window.setTimeout(
      () => setSessionClock(Date.now()),
      Math.min(remainingMs + 25, 2_147_483_647),
    );
    return () => window.clearTimeout(timeoutId);
  }, [transition?.expiresAt, transition?.id, transition?.state]);

  // Ref to hold the latest leaveGame function so the timeout always uses the current one
  // without causing the useEffect to re-run (leaveGame is not memoized in GameContext).
  const leaveGameRef = useRef(leaveGame);
  useEffect(() => { leaveGameRef.current = leaveGame; }, [leaveGame]);

  const updateState = (updates: Partial<GameState>) => {
    if (transitionBlocking) {
      setTransitionError('Espera un momento: el Alquimista está preparando el cambio de fase.');
      return;
    }
    setHasEditedCurrentPhase(true);
    setState((previous) => ({ ...previous, ...updates }));
    updateTeamSync(updates);
  };

  useEffect(() => {
    setHasEditedCurrentPhase(false);
  }, [globalState?.currentPhase]);

  // Sync context team into local state
  useEffect(() => {
    if (gameId && team) {
      setState(prev => ({ ...prev, team }));
    }
    if (!gameId) {
      setState({ ...initialState });
    }
  }, [team, gameId]);

  // The Alchemist owns the canonical phase. Players mirror it automatically.
  useEffect(() => {
    if (gameId && globalState?.currentPhase && !isAlchemist && globalState.currentPhase !== state.currentPhase) {
      setState((previous) => ({ ...previous, currentPhase: globalState.currentPhase as Phase }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [gameId, globalState?.currentPhase, isAlchemist, state.currentPhase]);

  // When the Alchemist closes the workshop, players return to the code screen.
  useEffect(() => {
    if (
      (globalState?.status === 'completed' || globalState?.status === 'archived')
      && !isAlchemist
      && gameId
    ) {
      setState({ ...initialState });
      leaveGameRef.current();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [globalState?.status, isAlchemist, gameId]);

  // Sync Firestore team state to local state
  useEffect(() => {
    if (gameId && team && teamState && Object.keys(teamState).length > 0) {
      setState(prev => ({ ...prev, ...teamState }));
    }
  }, [gameId, team, teamState]);

  // Follow an administrator-triggered reassignment without leaving the game.
  useEffect(() => {
    if (!team || !playerId) return;

    if (isV2DataModel) {
      if (isSessionLoading || !participantSession || participantSession.status === 'expired') return;
      const assignedTeam = participantSession.team;
      if (assignedTeam && assignedTeam !== team) {
        setState((previous) => ({ ...previous, team: assignedTeam }));
        applyTeamReassignment(assignedTeam);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    if (isTeamLoading) return;
    const reassignedTeam = teamState.reassignments?.[playerId];
    if (reassignedTeam) {
      if (reassignedTeam !== team) {
        setState((previous) => ({ ...previous, team: reassignedTeam }));
        applyTeamReassignment(reassignedTeam);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const memberIds = Array.isArray(teamState.memberIds) ? teamState.memberIds : [];
    const isStillAssigned = teamState.playerId === playerId || memberIds.includes(playerId);
    if (teamExists === false || (teamExists === true && !isStillAssigned)) {
      setState({ ...initialState });
      clearTeamSelection();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [
    team,
    playerId,
    isSessionLoading,
    participantSession,
    isTeamLoading,
    teamExists,
    teamState.playerId,
    teamState.memberIds,
    teamState.reassignments,
    clearTeamSelection,
    applyTeamReassignment,
  ]);

  const participantSessionStatus = participantSession?.status;

  useEffect(() => {
    if (
      !isV2DataModel
      || !gameId
      || isAlchemist
      || isSessionLoading
      || participantSessionStatus !== 'active'
      || !participantSessionRef.current
      || participantSessionRef.current.expiresAt <= Date.now()
    ) return undefined;

    const sendHeartbeat = async () => {
      setSessionClock(Date.now());
      const currentSession = participantSessionRef.current;
      if (
        !navigator.onLine
        || !currentSession
        || currentSession.status !== 'active'
        || currentSession.expiresAt <= Date.now()
      ) return;
      try {
        await workshopApi.heartbeatParticipantSession({ workshopId: gameId });
      setSessionClock(Date.now());
      } catch (heartbeatError) {
        reportClientError('Participant heartbeat failed', heartbeatError);
        // A callable error is not proof of closure: verify the workshop document.
        void refreshGlobalState();
      }
    };

    void sendHeartbeat();
    const intervalId = window.setInterval(() => void sendHeartbeat(), 20_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void sendHeartbeat();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    gameId,
    isAlchemist,
    isSessionLoading,
    participantSessionStatus,
    refreshGlobalState,
  ]);

  useEffect(() => {
    if (!isV2DataModel || !gameId || !team || isAlchemist || !transitionBlocking || transition?.state !== 'requested' || !transition.id) return;

    const requestedTransition = transition;
    const transitionHasExpired = () => getWorkshopTransitionProgress(
      requestedTransition,
      Date.now(),
    ).expired;

    if (participantSession?.transitionAckId === requestedTransition.id || acknowledgedTransitionRef.current === requestedTransition.id) {
      acknowledgedTransitionRef.current = requestedTransition.id;
      return;
    }
    const ackIdempotencyKey = createIdempotencyKey('acknowledgeWorkshopTransition');

    let cancelled = false;
    let retryTimer: number | null = null;
    let retryDelay = 1_000;

    const scheduleRetry = () => {
      if (cancelled || transitionHasExpired()) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void flushAndAcknowledge(), retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8_000);
    };

    const flushAndAcknowledge = async () => {
      if (cancelled || transitionHasExpired()) return;
      setTransitionError('');
      const saved = await flushTeamChanges();
      if (!saved || cancelled) {
        if (!cancelled) {
          setTransitionError(navigator.onLine
            ? 'No se puede avanzar hasta confirmar el guardado. Reintentando…'
            : 'Sin conexión. Reintentaremos al recuperar la red.');
          scheduleRetry();
        }
        return;
      }
      if (transitionHasExpired()) return;
      try {
        await workshopApi.acknowledgeWorkshopTransition({
          workshopId: gameId,
          transitionId: requestedTransition.id,
          idempotencyKey: ackIdempotencyKey,
        });
        if (!cancelled) acknowledgedTransitionRef.current = requestedTransition.id;
      } catch (ackError) {
        reportClientError('Workshop transition acknowledgement failed', ackError);
        if (!cancelled && !transitionHasExpired()) {
          setTransitionError('Guardado confirmado, pero falta validar el cambio. Reintentando…');
          scheduleRetry();
        }
      }
    };

    void flushAndAcknowledge();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [flushTeamChanges, gameId, isAlchemist, participantSession?.transitionAckId, team, transition, transitionBlocking]);

  const reconnectSession = async () => {
    if (isReconnectingSession) return;
    if (!gameId || !team) {
      leaveGame();
      return;
    }

    setIsReconnectingSession(true);
    setReconnectError('');
    setIsReconnectBlocked(false);
    try {
      const recovered = await reconnectParticipantSession();
      setState((previous) => ({
        ...previous,
        team: recovered.team,
        currentPhase: recovered.currentPhase,
      }));
      setSessionClock(Date.now());
    } catch (reconnectError) {
      reportClientError('Participant reconnection failed', reconnectError);
      const code = reconnectError && typeof reconnectError === 'object' && 'code' in reconnectError
        ? String(reconnectError.code)
        : '';
      const details = reconnectError && typeof reconnectError === 'object' && 'details' in reconnectError
        ? reconnectError.details
        : null;
      const reason = details && typeof details === 'object' && 'reason' in details
        ? String(details.reason)
        : '';
      if (reason === 'team-occupied' || reason === 'participant-team-occupied') {
        setIsReconnectBlocked(true);
        setReconnectError(`El Equipo ${team} ya está ocupado por otro dispositivo. No se ha cerrado su sesión.`);
      } else if (code.includes('unauthenticated') || reason === 'participant-identity-mismatch') {
        leaveGame();
        setState({ ...initialState });
        setTransitionError('La identidad guardada ya no está disponible. Introduce de nuevo el código de sala.');
      } else {
        setReconnectError('No se pudo recuperar la sesión. Reinténtalo o vuelve a la selección de equipo.');
      }
    } finally {
      setIsReconnectingSession(false);
    }
  };

  const returnToTeamSelection = () => {
    setReconnectError('');
    setIsReconnectBlocked(false);
    clearTeamSelection();
    setState({ ...initialState });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmExit = async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    setExitError('');
    try {
      if ((team || state.team) && !(await flushTeamChanges())) {
        setExitError('No se pudo guardar el trabajo pendiente. Revisa la conexión antes de salir.');
        return;
      }
      setShowExitConfirmation(false);
      leaveGame();
    } finally {
      setIsLeaving(false);
    }
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('kreatum_theme', isDark ? 'dark' : 'light');
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

  const workshopClosed = globalState.status === 'completed' || globalState.status === 'archived';
  const sessionExpired = !workshopClosed && isV2DataModel && !isAlchemist && Boolean(
    gameId
    && team
    && !isSessionLoading
    && (
      !participantSession
      || participantSession.status === 'expired'
      || (participantSession.expiresAt > 0 && participantSession.expiresAt <= sessionClock)
    )
  );

  const isCurrentPhaseUntouched = !hasEditedCurrentPhase && (saveStatus === 'idle' || saveStatus === 'saved');
  const savePresentation = isCurrentPhaseUntouched
    ? { label: 'Sin cambios pendientes', icon: Cloud, className: 'text-kreatum-gray/70' }
    : {
      idle: { label: 'Preparado', icon: Cloud, className: 'text-kreatum-gray/60' },
      saving: { label: 'Guardando', icon: LoaderCircle, className: 'text-kreatum-purple' },
      saved: { label: 'Guardado', icon: CheckCircle2, className: 'text-green-600' },
      offline: { label: 'Sin conexión', icon: WifiOff, className: 'text-amber-600' },
      reconnecting: { label: 'Reconectando', icon: LoaderCircle, className: 'text-amber-600' },
      error: { label: 'Pendiente de guardar', icon: WifiOff, className: 'text-red-600' },
    }[saveStatus];

  const SaveStatusIcon = savePresentation.icon;
  const lastSavedLabel = lastSavedAt
    ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastSavedAt)
    : 'todavía sin confirmar';
  // Evitar parpadeo de Selección al recargar con sesión activa
  const isRecoveringSession = gameId && team && (isGlobalLoading || isSessionLoading);

  if (isRecoveringSession || (workshopClosed && !isAlchemist && Boolean(gameId))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kreatum-bg-light dark:bg-kreatum-bg-dark">
        <div className="w-8 h-8 border-2 border-kreatum-purple/30 border-t-kreatum-purple rounded-full animate-spin" role="status" aria-label="Recuperando sesión" />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen flex flex-col relative overflow-hidden text-kreatum-gray transition-colors duration-300 dark:text-white font-sans">
      
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/[0.92] shadow-[0_10px_28px_-25px_rgba(16,47,64,0.5)] backdrop-blur-xl transition-colors duration-300 dark:border-white/[0.08] dark:bg-[#0f1117]/95">

        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="relative group">
              <img 
                src="/logo.png" 
                alt="Kreatum Logo" 
                className="h-8 w-auto object-contain sm:h-9"
              />
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {gameId && (
              <div className="hidden md:flex h-9 items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.03] px-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <span className="text-xs font-semibold text-kreatum-gray/55 dark:text-white/45">Sala</span>
                <span className="font-mono font-bold text-kreatum-purple">{roomCode || '---'}</span>
              </div>
            )}
            {gameId && playerId && !isAlchemist && (
              <div className="hidden md:flex h-9 items-center gap-2 rounded-xl border border-kreatum-purple/15 bg-kreatum-purple/[0.05] px-3">
                <span className="text-xs font-semibold text-kreatum-gray/55 dark:text-white/45">Dispositivo</span>
                <span className="font-mono text-xs font-bold text-kreatum-purple">{getDeviceCode(playerId)}</span>
              </div>
            )}
            
            <button
              onClick={() => setIsDark(!isDark)}
              className="grid h-11 w-11 min-w-11 flex-none place-items-center rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors text-kreatum-gray dark:text-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple"
              aria-label={isDark ? 'Activar tema claro' : 'Activar tema oscuro'}
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {gameId && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setExitError('');
                  setShowExitConfirmation(true);
                }}
                className="min-h-11 text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-xl"
              >
                Salir
              </Button>
            )}

            {state.team && state.currentPhase !== 'Selección' && (
              <div className={cn("flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold", getTeamColor(state.team))}>
                <TeamIcon team={state.team} className="w-4 h-4" />
                <span className="hidden sm:inline">Equipo {state.team}</span>
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
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 md:py-12 relative z-10">
        {transitionBlocking && (
          <div className="mb-5 rounded-2xl border border-kreatum-purple/20 bg-kreatum-purple/10 p-4 text-center" role="status" aria-live="polite">
            <p className="font-bold text-kreatum-purple">Preparando cambio seguro</p>
            <p className="mt-1 text-sm text-kreatum-gray/70 dark:text-white/65">
              Estamos guardando tu trabajo antes de {transition.complete ? 'finalizar la partida' : transition.targetPhase ? 'abrir ' + transition.targetPhase : 'abrir la siguiente fase'}.
            </p>
          </div>
        )}
        {transitionNotice && (
          <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700" role="alert">
            {transitionNotice}
          </p>
        )}
        {sessionExpired ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-amber-500/25 bg-white p-6 text-center shadow-[0_24px_70px_-48px_rgba(16,47,64,0.65)] dark:bg-white/[0.04] sm:p-9" role="alert" aria-labelledby="expired-session-title">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/10">
              <WifiOff className="h-7 w-7 text-amber-600" aria-hidden="true" />
            </div>
            <h2 id="expired-session-title" className="mt-5 text-2xl font-extrabold text-kreatum-dark dark:text-white sm:text-3xl">Tu sesión caducó</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-kreatum-gray/70 dark:text-white/65">
              La reserva de cinco minutos terminó. Tus respuestas siguen guardadas y la fase de la partida no ha cambiado.
            </p>
            <div className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-kreatum-purple/15 bg-kreatum-purple/[0.05] px-4 py-3 font-bold text-kreatum-purple">
              <TeamIcon team={team} className="h-8 w-8" />
              Equipo {team}
            </div>
            {reconnectError && (
              <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
                {reconnectError}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
              <Button variant="outline" className="min-h-11" onClick={returnToTeamSelection} disabled={isReconnectingSession}>
                {isReconnectBlocked ? 'Volver a selección' : 'Elegir otro equipo'}
              </Button>
              <Button className="min-h-11" onClick={reconnectSession} disabled={isReconnectingSession || isReconnectBlocked}>
                {isReconnectingSession ? 'Reconectando…' : `Reconectar con Equipo ${team}`}
              </Button>
            </div>
            <p className="mt-4 text-xs leading-5 text-kreatum-gray/55 dark:text-white/45">
              KREATUM no reconectará sin tu confirmación.
            </p>
          </section>
        ) : (
          <fieldset disabled={transitionBlocking} className="min-w-0 border-0 p-0">        <AnimatePresence key={gameId || 'no-workshop'} mode="wait">
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
            {state.currentPhase === 'Proyectar' && (
              <Proyectar state={state} updateState={updateState} flushChanges={flushTeamChanges} />
            )}
          </motion.div>
        </AnimatePresence>
          </fieldset>
        )}
      </main>

      {/* Footer / Status */}
      {state.team && !sessionExpired && (
        <footer className="bg-white/[0.88] dark:bg-[#0f1117]/[0.92] border-t border-black/[0.06] dark:border-white/[0.08] mt-auto relative z-20 transition-colors duration-300">

          <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col items-center justify-center gap-2">
            <div
              className={cn('flex min-h-11 flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-black/[0.06] bg-black/[0.03] px-4 py-2 text-sm font-semibold dark:border-white/[0.08] dark:bg-white/[0.04]', savePresentation.className)}
              role="status"
              aria-live="polite"
            >
              <SaveStatusIcon className={cn('h-4 w-4', (saveStatus === 'saving' || saveStatus === 'reconnecting') && 'animate-spin')} aria-hidden="true" />
              <span>{savePresentation.label}</span>
              {hasEditedCurrentPhase && saveStatus === 'saved' && (
                <span className="font-normal text-kreatum-gray/55 dark:text-white/45">
                  · Último guardado: {lastSavedLabel}
                </span>
              )}
            </div>
            <div className="sr-only" role="status" aria-live="polite">
              {saveStatus === 'saving' && 'Guardando cambios'}
              {saveStatus === 'saved' && (hasEditedCurrentPhase ? 'Cambios guardados' : 'Sin cambios pendientes')}
              {saveStatus === 'error' && 'No se pudieron guardar los cambios'}
            </div>
            {saveStatus === 'error' && (
              <p
                className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600"
                role="alert"
                title={syncError?.message}
              >
                No se pudieron guardar los cambios. KREATUM reintentará automáticamente.
              </p>
            )}
            <div className="px-5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] text-center">
              <p className="text-xs font-bold text-kreatum-purple">
                Fase controlada por el Alquimista
              </p>
              <p className="text-sm text-kreatum-gray/60 dark:text-white/50 mt-1">
                Avanzaréis automáticamente cuando el facilitador abra la siguiente fase.
              </p>
            </div>
          </div>
        </footer>
      )}

      <ActionDialog
        open={Boolean(gameId) && showExitConfirmation}
        title="¿Seguro que quieres salir?"
        description="Tus respuestas guardadas no se perderán. Volverás a la pantalla del código de sala y el equipo quedará reservado temporalmente para este dispositivo."
        confirmLabel="Salir de la partida"
        cancelLabel="Continuar en la partida"
        variant="danger"
        busy={isLeaving}
        error={exitError}
        onClose={() => {
          if (!isLeaving) setShowExitConfirmation(false);
        }}
        onConfirm={confirmExit}
      />

    </div>
  );
}
