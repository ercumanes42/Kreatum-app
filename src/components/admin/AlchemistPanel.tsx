import { useEffect, useRef, useState } from 'react';
import { useGameGlobal, useAllTeams, useAttacksCountByTeam, useParticipantSessions } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';
import { Phase, Team, PHASES } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { isV2DataModel } from '../../lib/dataModel';
import { getUserFacingError } from '../../lib/errors';
import { Button } from '../ui/Button';
import { motion } from 'motion/react';
import { 
  Users, 
  Settings, 
  ChevronRight, 
  ShieldAlert, 

  CheckCircle2, 
  LayoutDashboard,
  Timer,
  History,

  Shield,
  LockKeyhole,
  Trash2,
  ArrowRightLeft,
  Monitor,
  X,
} from 'lucide-react';
import { cn, getDeviceCode } from '../../lib/utils';
import { GameHistory } from './GameHistory';
import { WorkshopClosure } from '../phases/WorkshopClosure';
import { Sparkles } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { isPhaseChangeAllowed } from '../../../shared/contracts';
import { createIdempotencyKey, workshopApi } from '../../lib/workshopApi';
// Fixed color mapping to avoid dynamic Tailwind class issues
const TEAM_BAR_COLORS: Record<Team, string> = {
  Fuego: 'bg-kreatum-red',
  Agua: 'bg-kreatum-blue',
  Tierra: 'bg-kreatum-green',
  Aire: 'bg-kreatum-turquoise',
};

const TEAM_CONFIG: Record<Team, { icon: string; color: string; bg: string }> = {
  Fuego: { icon: '/assets/logos/fuego.png', color: 'text-kreatum-red', bg: 'bg-kreatum-red/5' },
  Agua: { icon: '/assets/logos/agua.png', color: 'text-kreatum-blue', bg: 'bg-kreatum-blue/5' },
  Tierra: { icon: '/assets/logos/tierra.png', color: 'text-kreatum-green', bg: 'bg-kreatum-green/5' },
  Aire: { icon: '/assets/logos/aire.png', color: 'text-kreatum-turquoise', bg: 'bg-kreatum-turquoise/5' },
};

const TEAM_NAMES: Team[] = ['Agua', 'Aire', 'Fuego', 'Tierra'];

interface Props {
  gameId: string;
  onResetPlatform?: () => void;
}

export function AlchemistPanel({ gameId, onResetPlatform }: Props) {
  const { roomCode, leaveGame, reassignTeamMember } = useGame();
  const { globalState, updateGlobalState, isLoading: isGlobalLoading, error: globalError } = useGameGlobal(gameId);
  const { teams } = useAllTeams(gameId);
  const { counts: attackCounts } = useAttacksCountByTeam(gameId);
  const { sessions: participantSessions } = useParticipantSessions(gameId);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [summaryTeam, setSummaryTeam] = useState<Team | null>(null);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [reassignmentSource, setReassignmentSource] = useState<Team | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [reassignmentDestination, setReassignmentDestination] = useState<Team | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [releaseSession, setReleaseSession] = useState<{ team: Team; participantId: string } | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [isReleasing, setIsReleasing] = useState(false);
  const [pendingPhase, setPendingPhase] = useState<Phase | null>(null);
  const [actionError, setActionError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [transitionAction, setTransitionAction] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const commitInFlightRef = useRef<string | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    const startedAt = typeof globalState.createdAt === 'number' ? globalState.createdAt : 0;
    if (!startedAt) {
      setElapsedMs(0);
      return undefined;
    }

    const updateElapsed = () => {
      const now = Date.now();
      setCurrentTimestamp(now);
      setElapsedMs(Math.max(0, now - startedAt));
    };
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [globalState.createdAt]);

  const formatElapsed = (durationMs: number) => {
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  };

  const currentPhase = (globalState.currentPhase || 'Selección') as Phase;
  const hasUnlockedPhases = globalState.unlockedPhases && globalState.unlockedPhases.length > 0;
  const unlockedPhases: Phase[] = hasUnlockedPhases
    ? (globalState.unlockedPhases as Phase[])
    : isV2DataModel ? [PHASES[0]] : [...PHASES];

  const requestTransition = async (options: { targetPhase?: Phase; complete?: boolean }) => {
    if (actionInFlightRef.current || globalState.transition?.state === 'requested') return;
    actionInFlightRef.current = true;
    setTransitionAction(true);
    setActionError('');
    try {
      await workshopApi.requestWorkshopTransition({
        workshopId: gameId,
        ...options,
        idempotencyKey: createIdempotencyKey('requestWorkshopTransition'),
      });
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo iniciar el cambio seguro.'));
      throw error;
    } finally {
      actionInFlightRef.current = false;
      setTransitionAction(false);
    }
  };

  const setGlobalPhase = async (phase: Phase) => {
    if (
      phase === currentPhase
      || pendingPhase !== null
      || globalState.transition?.state === 'requested'
      || !isPhaseChangeAllowed(currentPhase, phase, unlockedPhases)
    ) return;

    setPendingPhase(phase);
    try {
      await requestTransition({ targetPhase: phase });
    } finally {
      setPendingPhase(null);
    }
  };

  const commitTransition = async (overrideReason?: string) => {
    const transitionId = globalState.transition?.id;
    if (!transitionId || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setTransitionAction(true);
    setActionError('');
    try {
      await workshopApi.commitWorkshopTransition({
        workshopId: gameId,
        transitionId,
        overrideReason: overrideReason?.trim() || undefined,
        idempotencyKey: createIdempotencyKey('commitWorkshopTransition'),
      });
      setOverrideReason('');
      setShowOverride(false);
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'Aún faltan equipos por confirmar el guardado.'));
    } finally {
      actionInFlightRef.current = false;
      setTransitionAction(false);
    }
  };

  const cancelTransition = async () => {
    const transitionId = globalState.transition?.id;
    if (!transitionId || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setTransitionAction(true);
    setActionError('');
    try {
      await workshopApi.cancelWorkshopTransition({
        workshopId: gameId,
        transitionId,
        reason: 'Cancelado por el Alquimista',
        idempotencyKey: createIdempotencyKey('cancelWorkshopTransition'),
      });
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo cancelar el cambio.'));
    } finally {
      actionInFlightRef.current = false;
      setTransitionAction(false);
    }
  };
  const activeTransition = globalState.transition?.state === 'requested'
    ? globalState.transition
    : null;
  const requiredAckCount = activeTransition
    ? typeof activeTransition.requiredAcks === 'number'
      ? activeTransition.requiredAcks
      : activeTransition.requiredAcks.length
    : 0;
  const receivedAckCount = activeTransition
    ? typeof activeTransition.receivedAcks === 'number'
      ? activeTransition.receivedAcks
      : activeTransition.receivedAcks.length
    : 0;
  const pendingAckCount = Math.max(0, requiredAckCount - receivedAckCount);

  useEffect(() => {
    if (!activeTransition?.id || receivedAckCount < requiredAckCount) return;
    if (commitInFlightRef.current === activeTransition.id) return;

    commitInFlightRef.current = activeTransition.id;
    actionInFlightRef.current = true;
    setTransitionAction(true);
    workshopApi.commitWorkshopTransition({
      workshopId: gameId,
      transitionId: activeTransition.id,
      idempotencyKey: createIdempotencyKey('commitWorkshopTransition'),
    }).catch((error: unknown) => {
      commitInFlightRef.current = null;
      setActionError(getUserFacingError(error, 'No se pudo aplicar el cambio confirmado.'));
    }).finally(() => {
      actionInFlightRef.current = false;
      setTransitionAction(false);
    });
  }, [activeTransition?.id, gameId, receivedAckCount, requiredAckCount]);

  useEffect(() => {
    if (globalState.status === 'completed') leaveGame();
  }, [globalState.status, leaveGame]);
  const unlockDefense = async () => {
    try {
      await updateGlobalState({ sublimarDefenseUnlocked: true, sublimarDefenseUnlockedAt: Date.now() });
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo abrir la defensa.'));
    }
  };

  const getTeamProgress = (teamData: any) => {
    if (!teamData) return 0;
    if (teamData.isFinished === true) return 100;
    const phaseIndex = PHASES.indexOf(currentPhase);
    return Math.round((phaseIndex / (PHASES.length - 1)) * 100);
  };

  const getTeamMembers = (teamId: Team, teamData: any): string[] => {
    if (isV2DataModel) {
      return participantSessions
        .filter((session) =>
          session.team === teamId
          && session.status === 'active'
          && (!currentTimestamp || session.expiresAt > currentTimestamp),
        )
        .map((session) => session.id);
    }
    if (!teamData) return [];
    const memberIds = Array.isArray(teamData.memberIds) ? teamData.memberIds : [];
    return Array.from(new Set([
      ...memberIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ...(typeof teamData.playerId === 'string' && teamData.playerId.length > 0 ? [teamData.playerId] : []),
    ]));
  };

  const openReassignment = (teamId: Team) => {
    const members = getTeamMembers(teamId, teams[teamId]);
    if (members.length === 0) return;
    setReassignmentSource(teamId);
    setSelectedMemberId(members[0]);
    setReassignmentDestination(null);
  };

  const closeReassignment = () => {
    if (isReassigning) return;
    setReassignmentSource(null);
    setSelectedMemberId('');
    setReassignmentDestination(null);
  };
  const closeRelease = () => {
    if (isReleasing) return;
    setReleaseSession(null);
    setReleaseReason('');
  };
  const reassignmentDialogRef = useDialogFocus<HTMLDivElement>(
    Boolean(reassignmentSource),
    closeReassignment,
  );
  const releaseDialogRef = useDialogFocus<HTMLDivElement>(
    Boolean(releaseSession),
    closeRelease,
  );
  const finalizeDialogRef = useDialogFocus<HTMLDivElement>(
    showFinalizeModal,
    () => setShowFinalizeModal(false),
  );


  const handleReleaseSession = async () => {
    if (!releaseSession || releaseReason.trim().length < 5 || isReleasing) return;
    setIsReleasing(true);
    setActionError('');
    try {
      await workshopApi.releaseParticipantSession({
        workshopId: gameId,
        participantId: releaseSession.participantId,
        reason: releaseReason.trim(),
        idempotencyKey: createIdempotencyKey('releaseParticipantSession'),
      });
      setReleaseSession(null);
      setReleaseReason('');
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo liberar el dispositivo.'));
    } finally {
      setIsReleasing(false);
    }
  };
  const handleReassignMember = async () => {
    if (!reassignmentSource || !selectedMemberId || !reassignmentDestination) return;
    setIsReassigning(true);
    setActionError('');
    try {
      await reassignTeamMember(reassignmentSource, selectedMemberId, reassignmentDestination);
      setReassignmentSource(null);
      setSelectedMemberId('');
      setReassignmentDestination(null);
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo reasignar el dispositivo.'));
    } finally {
      setIsReassigning(false);
    }
  };

  const handleFinalize = async () => {
    try {
      await requestTransition({ complete: true });
      setShowFinalizeModal(false);
    } catch {
      setShowFinalizeModal(false);
    }
  };

  const [copied, setCopied] = useState(false);
  const handleCopyCode = async () => {
    if (!roomCode) return;
    setActionError('');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(roomCode);
      } else {
        const input = document.createElement('textarea');
        input.value = roomCode;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copiedWithFallback = document.execCommand('copy');
        input.remove();
        if (!copiedWithFallback) throw new Error('Clipboard unavailable');
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo copiar el código. Selecciónalo manualmente.'));
    }
  };

  const isDefenseUnlocked = globalState?.sublimarDefenseUnlocked === true;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)] p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-kreatum-purple rounded-2xl flex items-center justify-center shadow-[0_16px_34px_-24px_rgba(162,84,156,0.85)]">
              <LayoutDashboard className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-normal text-kreatum-dark dark:text-white sm:text-3xl">Panel del Alquimista</h1>
              <p className="text-sm font-medium text-kreatum-gray/65 dark:text-white/55">Control del workshop y avance de fases</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 bg-white/90 dark:bg-white/[0.04] p-2 rounded-2xl border border-black/[0.06] dark:border-white/[0.08]">
            <button
              type="button"
              aria-label={copied ? 'Código de sala copiado' : 'Copiar código de sala'}
              className={cn(
                "px-4 py-2 rounded-xl transition-colors group flex flex-col items-center justify-center min-w-[126px]",
                copied ? "bg-green-500/15 text-green-600" : "bg-kreatum-purple/10 hover:bg-kreatum-purple/15"
              )}
              onClick={handleCopyCode}
              title="Haz clic para copiar"
            >
               <p className="text-xs font-bold opacity-65 mb-0.5">
                 {copied ? "¡Copiado!" : "Código de Sala"}
               </p>
               <p className={cn(
                 "select-all text-xl font-bold font-mono tracking-wider",
                 copied ? "" : "text-kreatum-purple"
               )}>
                 {roomCode || '---'}
               </p>
            </button>
            <div className="h-10 w-px bg-black/10 dark:bg-white/10" />
            <div className="flex h-10 items-center gap-2 px-2">
              <Timer className="w-5 h-5 text-kreatum-purple" />
              <span className="font-mono text-base font-bold px-2" aria-label="Tiempo transcurrido">{formatElapsed(elapsedMs)}</span>
            </div>
            {onResetPlatform && (
              <Button
                size="sm"
                variant="danger"
                className="rounded-xl"
                onClick={onResetPlatform}
              >
                <Trash2 className="w-4 h-4" />
                Resetear datos
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="rounded-xl text-red-500 hover:text-red-600 hover:bg-red-500/10"
              onClick={leaveGame}
              title={'La partida seguir\u00e1 activa y podr\u00e1s reanudarla desde el historial.'}
            >
              Salir del panel
            </Button>
          </div>
        </header>

        {actionError && (
          <div className="flex items-start justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError('')} aria-label="Cerrar aviso">×</button>
          </div>
        )}
        {isGlobalLoading && (
          <div className="rounded-xl border border-black/10 bg-white/80 px-4 py-3 text-sm font-semibold dark:border-white/10 dark:bg-white/[0.04]" role="status">
            Cargando estado real de la partida…
          </div>
        )}
        {globalError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
            No se pudo actualizar el Control Room. Revisa la conexión.
          </div>
        )}
        {activeTransition && (
          <section className="rounded-2xl border border-kreatum-purple/25 bg-kreatum-purple/[0.07] p-5" aria-labelledby="safe-transition-title">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="safe-transition-title" className="text-lg font-extrabold text-kreatum-purple">
                  Cambio seguro en curso
                </h2>
                <p className="mt-1 text-sm text-kreatum-gray/70 dark:text-white/65">
                  {activeTransition.complete
                    ? 'Finalizando la partida'
                    : 'Preparando ' + (activeTransition.targetPhase || 'la siguiente fase')}
                  {' · '}{receivedAckCount}/{requiredAckCount} equipos guardados
                </p>
              </div>
              <span className={cn('rounded-full px-3 py-1 text-xs font-bold', pendingAckCount === 0 ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-700')}>
                {pendingAckCount === 0 ? 'Todos confirmados' : pendingAckCount + ' pendientes'}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-kreatum-purple transition-all"
                style={{ width: requiredAckCount === 0 ? '100%' : Math.round((receivedAckCount / requiredAckCount) * 100) + '%' }}
              />
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Button variant="outline" className="min-h-11" onClick={cancelTransition} disabled={transitionAction}>
                Cancelar cambio
              </Button>
              {pendingAckCount === 0 && (
                <Button className='min-h-11 bg-kreatum-purple text-white hover:bg-kreatum-purple-dark' onClick={() => commitTransition()} disabled={transitionAction}>
                  {transitionAction ? 'Aplicando…' : 'Aplicar cambio'}
                </Button>
              )}
              {pendingAckCount > 0 && (
                <Button variant="outline" className="min-h-11 border-amber-500/30 text-amber-700" onClick={() => setShowOverride(true)} disabled={transitionAction}>
                  Forzar con advertencia
                </Button>
              )}
            </div>
            {showOverride && pendingAckCount > 0 && (
              <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
                <label htmlFor="transition-override-reason" className="text-sm font-bold text-amber-800 dark:text-amber-300">
                  Motivo obligatorio
                </label>
                <textarea
                  id="transition-override-reason"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-amber-500/25 bg-white px-3 py-2 text-sm text-kreatum-dark focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-kreatum-bg-dark dark:text-white"
                  placeholder="Explica por qué es seguro continuar sin todos los equipos."
                />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" className="min-h-11" onClick={() => setShowOverride(false)} disabled={transitionAction}>
                    Volver
                  </Button>
                  <Button className="min-h-11 bg-amber-600 text-white hover:bg-amber-700" onClick={() => commitTransition(overrideReason)} disabled={transitionAction || overrideReason.trim().length < 5}>
                    {transitionAction ? 'Aplicando…' : 'Confirmar avance forzado'}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white/90 dark:bg-white/[0.04] rounded-xl border border-black/[0.06] dark:border-white/[0.08] w-fit max-w-full overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "min-h-11 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2",
              activeTab === 'dashboard'
                ? "bg-kreatum-purple text-white shadow-sm"
                : "text-kreatum-gray/50 hover:text-kreatum-gray dark:text-white/40"
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "min-h-11 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2",
              activeTab === 'history'
                ? "bg-kreatum-purple text-white shadow-sm"
                : "text-kreatum-gray/50 hover:text-kreatum-gray dark:text-white/40"
            )}
          >
            <History className="w-4 h-4" />
            Historial de Partidas
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'history' ? (
          <GameHistory />
        ) : (
          <>
        <div className="grid lg:grid-cols-3 gap-6">
          
          {/* Phase Control */}
          <Card className="lg:col-span-1 border-kreatum-purple/20 bg-kreatum-purple/[0.04]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-5">
              <CardTitle className="text-lg text-kreatum-purple">Control de Fases</CardTitle>
              <Settings className="w-5 h-5 text-kreatum-purple opacity-50" />
            </CardHeader>
            <CardContent className="space-y-3">
              {PHASES.map((phase, idx) => {
                const isActive = currentPhase === phase;
                const isPast = PHASES.indexOf(currentPhase) > idx;
                const isAllowed = isPhaseChangeAllowed(currentPhase, phase, unlockedPhases);
                const isBlocked = !isAllowed;
                const isPending = pendingPhase === phase;
                return (
                  <div key={phase} className="relative">
                    <button
                      onClick={() => setGlobalPhase(phase)}
                      disabled={isActive || isBlocked || pendingPhase !== null || Boolean(activeTransition) || transitionAction}
                      aria-current={isActive ? 'step' : undefined}
                      title={
                        isActive
                          ? 'Fase actual'
                          : isBlocked
                            ? 'Debes avanzar primero por la fase anterior'
                            : isPast || unlockedPhases.includes(phase)
                              ? 'Volver a ' + phase
                              : 'Avanzar a ' + phase
                      }
                      className={cn(
                        "w-full flex items-center justify-between p-3.5 rounded-xl transition-colors duration-200 border text-left disabled:cursor-not-allowed",
                        isActive
                          ? "bg-kreatum-purple text-white border-kreatum-purple"
                          : isPast
                            ? "bg-white dark:bg-white/[0.04] text-kreatum-purple border-kreatum-purple/20"
                            : isBlocked
                              ? "bg-black/[0.02] dark:bg-white/[0.02] text-kreatum-gray/35 border-black/[0.05] dark:border-white/[0.05] opacity-70"
                              : "bg-white dark:bg-white/[0.04] text-kreatum-gray/75 border-kreatum-purple/20 hover:border-kreatum-purple/50 hover:text-kreatum-purple"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center border border-current text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-semibold tracking-normal">{phase}</span>
                      </div>
                      {isPast ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : isActive ? (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      ) : isBlocked ? (
                        <LockKeyhole className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className={cn("w-4 h-4", isPending && "animate-pulse")} aria-hidden="true" />
                      )}
                    </button>

                    {/* Sublimar: separate buttons for Defense and Fermentar */}
                    {isActive && phase === 'Sublimar' && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-2 space-y-2"
                      >
                        {/* Unlock Defense button */}
                        <Button 
                          onClick={(e) => { e.stopPropagation(); if (!isDefenseUnlocked) unlockDefense(); }}
                          disabled={isDefenseUnlocked}
                          className={cn(
                            "w-full rounded-xl text-sm h-10",
                            isDefenseUnlocked 
                              ? "bg-kreatum-blue/30 text-kreatum-blue cursor-default shadow-none"
                              : "bg-kreatum-blue hover:bg-kreatum-blue/90 text-white"
                          )}
                        >
                          <Shield className="w-4 h-4 mr-2" />
                          {isDefenseUnlocked ? '✓ Defensa Desbloqueada' : 'Desbloquear Defensa para Equipos'}
                        </Button>
                        {/* Unlock Fermentar button */}
                        {!unlockedPhases.includes('Fermentar') && (
                          <Button 
                            onClick={(e) => { e.stopPropagation(); setGlobalPhase('Fermentar'); }}
                            disabled={pendingPhase !== null || Boolean(activeTransition) || transitionAction}
                            className="w-full bg-kreatum-green hover:bg-kreatum-green/90 text-white rounded-xl text-sm h-10"
                          >
                            <ChevronRight className="w-4 h-4 mr-2" />
                            Avanzar a Fermentar (Fase 6)
                          </Button>
                        )}
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Teams Status */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
              <h2 className="text-2xl font-extrabold flex items-center gap-3 text-kreatum-dark dark:text-white">
                <Users className="w-6 h-6 text-kreatum-purple" />
                Control Room · 4 equipos
              </h2>
              <div className="flex gap-4">
                 <span className="flex items-center gap-2 text-xs font-semibold opacity-60">
                   <div className="w-2 h-2 rounded-full bg-kreatum-green" /> Asignados
                 </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              {TEAM_NAMES.map((teamId) => {
                const data = teams[teamId];
                const config = TEAM_CONFIG[teamId];
                const barColor = TEAM_BAR_COLORS[teamId];
                const teamSessions = participantSessions.filter((session) => session.team === teamId && session.status === 'active' && (!currentTimestamp || session.expiresAt > currentTimestamp));
                const teamSession = teamSessions[0];
                const memberCount = getTeamMembers(teamId, data).length;
                const isAssigned = memberCount > 0;
                const isOnline = Boolean(teamSession && currentTimestamp && currentTimestamp - teamSession.lastSeenAt < 60_000);
                const hasConflict = memberCount > 1;
                const presenceLabel = hasConflict ? 'CONFLICTO' : isOnline ? 'EN LÍNEA' : isAssigned ? 'SIN CONEXIÓN' : 'ESPERANDO';
                const savedLabel = teamSession?.lastSavedAt ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(teamSession.lastSavedAt) : 'Sin confirmar';
                const transitionReady = Boolean(activeTransition && teamSession?.transitionAckId === activeTransition.id);
                const progress = isAssigned ? getTeamProgress(data) : 0;

                return (
                  <Card key={teamId} className={cn("overflow-hidden border-black/[0.06] dark:border-white/[0.08] transition-colors duration-200", isAssigned ? "opacity-100" : "opacity-45 grayscale")}>
                    <div className={cn("h-2 w-full", barColor)} />
                    <CardHeader className="p-4 sm:p-5">
                      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={cn("shrink-0 rounded-xl p-2", config.bg)}>
                            <img src={config.icon} alt={teamId} className="w-8 h-8 object-contain" />
                          </div>
                          <CardTitle className="min-w-0 text-lg leading-tight">Equipo {teamId}</CardTitle>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isAssigned && globalState.status !== 'completed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 px-3 text-xs border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                              onClick={() => openReassignment(teamId)}
                              title={`Mover un dispositivo del Equipo ${teamId}`}
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              Reasignar
                            </Button>
                          )}
                                                    {teamSession && globalState.status !== 'completed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 px-3 text-xs border-red-500/25 text-red-600 hover:bg-red-500/10"
                              onClick={() => setReleaseSession({ team: teamId, participantId: teamSession.id })}
                              disabled={transitionAction}
                              aria-label={'Liberar dispositivo del Equipo ' + teamId}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Liberar
                            </Button>
                          )}<span className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-xs font-mono", hasConflict ? "bg-red-500/10 text-red-600" : isOnline ? "bg-green-500/10 text-green-600" : isAssigned ? "bg-amber-500/10 text-amber-700" : "bg-black/5 text-kreatum-gray/55")}>
                            {presenceLabel}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 p-4 sm:p-6">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-bold opacity-60 mb-2">
                          <span>Progreso</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-black/5 dark:bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            className={cn("h-full rounded-full", barColor)} 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                         <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-xs font-bold opacity-55 mb-1">Fase Actual</p>
                            <p className="text-sm font-bold truncate">{currentPhase}</p>
                         </div>
                          <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-xs font-bold opacity-55 mb-1">Dispositivo</p>
                            <p className="text-sm font-bold">{memberCount}/1 · {isOnline ? 'online' : 'offline'}</p>
                          </div>
                          <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-xs font-bold opacity-55 mb-1">Ataques</p>
                            <p className="text-sm font-bold">{attackCounts[teamId] || 0} enviados</p>
                          </div>
                      </div>

                      <p className="text-xs font-semibold text-kreatum-gray/60 dark:text-white/50">Último guardado: {transitionReady ? 'Confirmado para transición' : savedLabel}</p>

                      <div className="bg-black/5 dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5">
                        <p className="text-xs font-bold opacity-55 mb-2">Solución Definitiva</p>
                        <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
                          <p className="text-sm italic line-clamp-2 leading-relaxed flex-1">
                            {data?.reformulatedSolution || data?.selectedSolution || <span className="opacity-30">Aún no definida...</span>}
                          </p>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-10 w-full shrink-0 px-3 text-xs font-bold border-kreatum-purple/20 text-kreatum-purple hover:bg-kreatum-purple/5 sm:w-auto"
                            onClick={() => setSummaryTeam(teamId)}
                          >
                            <Sparkles className="w-3 h-3 mr-1" />
                            Resumen
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>

        {summaryTeam && teams[summaryTeam] && (
          <WorkshopClosure 
            state={teams[summaryTeam] as any} 
            onClose={() => setSummaryTeam(null)}
            isOpen={!!summaryTeam}
          />
        )}

        {reassignmentSource && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <motion.div
              ref={reassignmentDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="reassignment-dialog-title"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative bg-white dark:bg-kreatum-bg-dark p-7 rounded-2xl max-w-lg w-full shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)] border border-kreatum-purple/20"
            >
              <button
                onClick={closeReassignment}
                disabled={isReassigning}
                className="absolute right-4 top-4 p-2 rounded-lg text-kreatum-gray/50 hover:bg-black/5 dark:hover:bg-white/5"
                aria-label="Cerrar reasignación"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="mb-6 pr-10">
                <h2 id="reassignment-dialog-title" className="text-2xl font-extrabold text-kreatum-dark dark:text-white">
                  Reasignar dispositivo
                </h2>
                <p className="text-sm text-kreatum-gray/60 dark:text-white/60 mt-2">
                  Mueve un ordenador del Equipo {reassignmentSource} al equipo correcto sin reiniciar la partida.
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-kreatum-gray/50 dark:text-white/45 mb-3">
                    1. Elige el dispositivo
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {getTeamMembers(reassignmentSource, teams[reassignmentSource]).map((memberId, index) => (
                      <button
                        key={memberId}
                        onClick={() => setSelectedMemberId(memberId)}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                          selectedMemberId === memberId
                            ? "border-kreatum-purple bg-kreatum-purple/10 text-kreatum-purple"
                            : "border-black/10 dark:border-white/10 hover:border-kreatum-purple/30"
                        )}
                      >
                        <Monitor className="w-5 h-5 shrink-0" />
                        <span>
                          <span className="block text-xs font-semibold">Dispositivo {index + 1}</span>
                          <span className="block font-mono text-sm font-bold">{getDeviceCode(memberId)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-kreatum-gray/45 dark:text-white/35 mt-2">
                    El mismo código aparece en la cabecera del ordenador del participante.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-kreatum-gray/50 dark:text-white/45 mb-3">
                    2. Elige el equipo correcto
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {TEAM_NAMES.filter((teamId) => teamId !== reassignmentSource).map((teamId) => (
                      <button
                        key={teamId}
                        onClick={() => setReassignmentDestination(teamId)}
                        className={cn(
                          "rounded-xl border p-3 text-center font-bold transition-colors",
                          reassignmentDestination === teamId
                            ? "border-kreatum-purple bg-kreatum-purple text-white"
                            : "border-black/10 dark:border-white/10 hover:border-kreatum-purple/30"
                        )}
                      >
                        <img src={TEAM_CONFIG[teamId].icon} alt="" className="w-8 h-8 object-contain mx-auto mb-2" />
                        {teamId}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full h-12 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white"
                  disabled={!selectedMemberId || !reassignmentDestination || isReassigning}
                  onClick={handleReassignMember}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  {isReassigning
                    ? 'Reasignando...'
                    : reassignmentDestination
                      ? `Mover al Equipo ${reassignmentDestination}`
                      : 'Selecciona el equipo destino'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {releaseSession && (
          <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
            <motion.div
              ref={releaseDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="release-device-title"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative w-full max-w-md rounded-2xl border border-red-500/20 bg-white p-6 shadow-2xl dark:bg-kreatum-bg-dark"
            >
              <button type="button" onClick={closeRelease} disabled={isReleasing} className="absolute right-4 top-4 grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
              <h2 id="release-device-title" className="pr-12 text-2xl font-extrabold text-kreatum-dark dark:text-white">
                Liberar Equipo {releaseSession.team}
              </h2>
              <p className="mt-2 text-sm text-kreatum-gray/65 dark:text-white/60">
                El dispositivo dejará de editar. Podrá volver a ocupar el equipo entrando de nuevo con el código de sala.
              </p>
              <label htmlFor="release-device-reason" className="mt-5 block text-sm font-bold">
                Motivo obligatorio
              </label>
              <textarea
                id="release-device-reason"
                value={releaseReason}
                onChange={(event) => setReleaseReason(event.target.value)}
                maxLength={500}
                rows={3}
                className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]"
                placeholder="Ej.: el dispositivo se ha bloqueado y será sustituido."
              />
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button variant="outline" className="min-h-11 flex-1" onClick={closeRelease} disabled={isReleasing}>Cancelar</Button>
                <Button variant="danger" className="min-h-11 flex-1" onClick={handleReleaseSession} disabled={isReleasing || releaseReason.trim().length < 5}>
                  {isReleasing ? 'Liberando…' : 'Liberar dispositivo'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Finalize Modal */}
        {showFinalizeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <motion.div
              ref={finalizeDialogRef}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-kreatum-bg-dark p-7 rounded-2xl max-w-md w-full shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)] border border-kreatum-purple/20"
              role="dialog"
              aria-modal="true"
              aria-labelledby="finalize-workshop-title"
            >
              <h2 id="finalize-workshop-title" className="text-2xl font-extrabold text-center mb-2 text-kreatum-dark dark:text-white">Finalizar Workshop</h2>
              <p className="text-sm text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
                ¿Seguro que quieres finalizar el workshop? Esto marcará la sesión como completada para todos los equipos.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 py-4" onClick={() => setShowFinalizeModal(false)}>Cancelar</Button>
                <Button
                  className="flex-1 py-4 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white"
                  onClick={handleFinalize}
                >
                  Sí, Finalizar
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Action Bar */}
        <footer className="bg-white/90 dark:bg-white/[0.04] p-5 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
             <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
               <ShieldAlert className="w-5 h-5 text-amber-500" />
             </div>
             <p className="text-sm font-medium leading-relaxed text-kreatum-gray/75 dark:text-white/70 max-w-md">
               Como Alquimista, puedes forzar el cambio de fase para todos los equipos. Úsalo con sabiduría para mantener el ritmo del workshop.
             </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
             <p className="max-w-sm text-xs font-medium text-kreatum-gray/55 dark:text-white/45">
               Los informes se generan desde Historial de Partidas después de finalizar el workshop.
             </p>
             <Button className="bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-xl px-8 h-12 w-full sm:w-auto" onClick={() => setShowFinalizeModal(true)} disabled={Boolean(activeTransition) || transitionAction}>
               Finalizar Workshop
             </Button>
          </div>
        </footer>
          </>
        )}

      </div>
    </div>
  );
}
