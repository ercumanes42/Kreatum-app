import { useState } from 'react';
import { useGameGlobal, useAllTeams, useAttacksCountByTeam } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';
import { Phase, Team, PHASES } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { db } from '../../lib/firebase';
import { doc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { Button } from '../ui/Button';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Settings, 
  ChevronRight, 
  ShieldAlert, 
  Clock, 
  CheckCircle2, 
  LayoutDashboard,
  Timer,
  History,
  FileSpreadsheet,
  Shield,
  LockKeyhole,
  UnlockKeyhole,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { GameHistory } from './GameHistory';
import { WorkshopClosure } from '../phases/WorkshopClosure';
import { Sparkles } from 'lucide-react';

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

interface Props {
  gameId: string;
}

export function AlchemistPanel({ gameId }: Props) {
  const { roomCode, leaveGame } = useGame();
  const { globalState, updateGlobalState } = useGameGlobal(gameId);
  const { teams } = useAllTeams(gameId);
  const attackCounts = useAttacksCountByTeam(gameId);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [summaryTeam, setSummaryTeam] = useState<Team | null>(null);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  const currentPhase = (globalState.currentPhase || 'Selección') as Phase;
  const hasUnlockedPhases = globalState.unlockedPhases && globalState.unlockedPhases.length > 0;
  const unlockedPhases = hasUnlockedPhases ? (globalState.unlockedPhases as string[]) : PHASES;
  const phasesThrough = (phase: Phase) => {
    const phaseIndex = PHASES.indexOf(phase);
    return phaseIndex >= 0 ? PHASES.slice(0, phaseIndex + 1) : ['Selección'];
  };

  const setGlobalPhase = async (phase: Phase) => {
    const newUnlocked = Array.from(new Set([...unlockedPhases, ...phasesThrough(phase)]));
    try {
      await updateGlobalState({ currentPhase: phase, unlockedPhases: newUnlocked });
    } catch (e: any) {
      console.error('Error al actualizar fase:', e);
    }
  };

  const unlockPhase = async (phase: Phase) => {
    const newUnlocked = Array.from(new Set([...unlockedPhases, ...phasesThrough(phase)]));
    try {
      await updateGlobalState({ currentPhase: phase, unlockedPhases: newUnlocked });
    } catch (e: any) {
      console.error('Error al avanzar fase:', e);
    }
  };

  const unlockDefense = async () => {
    try {
      await updateGlobalState({ sublimarDefenseUnlocked: true, sublimarDefenseUnlockedAt: Date.now() });
    } catch (e: any) {
      console.error('Error al desbloquear defensa:', e);
    }
  };

  const getTeamProgress = (teamData: any) => {
    if (!teamData) return 0;
    if (teamData.isFinished === true) return 100;
    const phaseIndex = PHASES.indexOf(teamData.currentPhase || 'Selección');
    return Math.round((phaseIndex / (PHASES.length - 1)) * 100);
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportJSON = async () => {
    setIsExporting(true);
    try {
      const attacksSnap = await getDocs(collection(db, 'games', gameId, 'attacks'));
      const attacks = attacksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const defensesSnap = await getDocs(collection(db, 'games', gameId, 'defenses'));
      const defenses = defensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const exportData = {
        gameId,
        roomCode,
        exportedAt: new Date().toISOString(),
        globalState,
        teams,
        attacks,
        defenses,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Kreatum_${roomCode || gameId}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFinalize = async () => {
    setShowFinalizeModal(false);
    try {
      await updateDoc(doc(db, 'games', gameId), { status: 'completed', completedAt: Date.now() });
      leaveGame();
    } catch (e: any) {
      console.error('Error al finalizar workshop:', e);
    }
  };

  const [copied, setCopied] = useState(false);
  const handleCopyCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
              <h1 className="text-3xl font-extrabold tracking-normal text-kreatum-dark dark:text-white">Panel del Alquimista</h1>
              <p className="text-sm font-medium text-kreatum-gray/65 dark:text-white/55">Control del workshop y avance de fases</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 bg-white/90 dark:bg-white/[0.04] p-2 rounded-2xl border border-black/[0.06] dark:border-white/[0.08]">
            <button 
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
                 "text-xl font-bold font-mono tracking-wider",
                 copied ? "" : "text-kreatum-purple"
               )}>
                 {roomCode || '---'}
               </p>
            </button>
            <div className="h-10 w-px bg-black/10 dark:bg-white/10" />
            <div className="flex h-10 items-center gap-2 px-2">
              <Timer className="w-5 h-5 text-kreatum-purple" />
              <span className="font-mono text-base font-bold px-2 opacity-45">—:—:—</span>
            </div>
            <Button size="sm" variant="ghost" className="rounded-xl text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={leaveGame}>Salir</Button>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white/90 dark:bg-white/[0.04] rounded-xl border border-black/[0.06] dark:border-white/[0.08] w-fit">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2",
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
              "px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2",
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
                return (
                  <div key={phase} className="relative">
                    <button
                      onClick={() => setGlobalPhase(phase)}
                      className={cn(
                        "w-full flex items-center justify-between p-3.5 rounded-xl transition-colors duration-200 border text-left",
                        isActive 
                          ? "bg-kreatum-purple text-white border-kreatum-purple" 
                          : isPast 
                            ? "bg-white dark:bg-white/[0.04] text-kreatum-purple border-kreatum-purple/20"
                            : "bg-white dark:bg-white/[0.04] text-kreatum-gray/65 border-black/[0.06] dark:border-white/[0.08] hover:border-kreatum-purple/30"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center border border-current text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-semibold tracking-normal">{phase}</span>
                      </div>
                      {isPast ? <CheckCircle2 className="w-5 h-5" /> : isActive ? (
                        <div className="flex items-center gap-2">
                          {idx >= 2 && idx < PHASES.length - 1 && (
                            <div 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                if (!unlockedPhases.includes(PHASES[idx+1])) {
                                  unlockPhase(PHASES[idx+1]); 
                                }
                              }}
                              className={cn(
                                "p-1 rounded-md transition-all",
                                unlockedPhases.includes(PHASES[idx+1]) 
                                  ? "text-white/40 cursor-default" 
                                  : "text-white hover:bg-white/20 hover:scale-110 active:scale-95 cursor-pointer"
                              )}
                              title={unlockedPhases.includes(PHASES[idx+1]) ? "Siguiente fase ya abierta" : "Avanzar a la siguiente fase"}
                            >
                              {unlockedPhases.includes(PHASES[idx+1])
                                ? <UnlockKeyhole className="w-4 h-4" />
                                : <LockKeyhole className="w-4 h-4" />}
                            </div>
                          )}
                          <div className="w-2 h-2 rounded-full bg-white" />
                        </div>
                      ) : (idx >= 2 && !unlockedPhases.includes(phase)) ? (
                        <div 
                          onClick={(e) => { e.stopPropagation(); unlockPhase(phase); }}
                          className="text-kreatum-purple hover:text-kreatum-purple-dark transition-colors p-1 hover:bg-kreatum-purple/10 rounded-md cursor-pointer"
                          title="Avanzar a esta fase"
                        >
                          <LockKeyhole className="w-4 h-4" />
                        </div>
                      ) : (
                        <ChevronRight className="w-4 h-4 opacity-30" />
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
                            onClick={(e) => { e.stopPropagation(); unlockPhase('Fermentar'); }}
                            className="w-full bg-kreatum-green hover:bg-kreatum-green/90 text-white rounded-xl text-sm h-10"
                          >
                            <ChevronRight className="w-4 h-4 mr-2" />
                            Avanzar a Fermentar (Fase 5)
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
                Estado de los Equipos
              </h2>
              <div className="flex gap-4">
                 <span className="flex items-center gap-2 text-xs font-semibold opacity-60">
                   <div className="w-2 h-2 rounded-full bg-kreatum-green" /> Conectados
                 </span>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              {(['Agua', 'Aire', 'Fuego', 'Tierra'] as Team[]).map((teamId) => {
                const data = teams[teamId];
                const config = TEAM_CONFIG[teamId];
                const barColor = TEAM_BAR_COLORS[teamId];
                const progress = getTeamProgress(data);
                
                return (
                  <Card key={teamId} className={cn("overflow-hidden border-black/[0.06] dark:border-white/[0.08] transition-colors duration-200", data ? "opacity-100" : "opacity-45 grayscale")}>
                    <div className={cn("h-2 w-full", barColor)} />
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-1.5 rounded-xl", config.bg)}>
                            <img src={config.icon} alt={teamId} className="w-8 h-8 object-contain" />
                          </div>
                          <CardTitle className="text-lg">Equipo {teamId}</CardTitle>
                        </div>
                        <span className={cn("text-xs font-mono px-2 py-1 rounded-md", data ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>
                          {data ? 'ACTIVO' : 'ESPERANDO'}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
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

                      <div className="grid grid-cols-2 gap-3">
                         <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-xs font-bold opacity-55 mb-1">Fase Actual</p>
                            <p className="text-sm font-bold truncate">{data?.currentPhase || 'Selección'}</p>
                         </div>
                         <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-xs font-bold opacity-55 mb-1">Ataques</p>
                            <p className="text-sm font-bold">{attackCounts[teamId] || 0} enviados</p>
                         </div>
                      </div>

                      <div className="bg-black/5 dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5">
                        <p className="text-xs font-bold opacity-55 mb-2">Solución Definitiva</p>
                        <div className="flex justify-between items-start gap-4">
                          <p className="text-sm italic line-clamp-2 leading-relaxed flex-1">
                            {data?.reformulatedSolution || data?.selectedSolution || <span className="opacity-30">Aún no definida...</span>}
                          </p>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="shrink-0 h-8 px-3 text-xs font-bold border-kreatum-purple/20 text-kreatum-purple hover:bg-kreatum-purple/5"
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

        {/* Finalize Modal */}
        {showFinalizeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-kreatum-bg-dark p-7 rounded-2xl max-w-md w-full shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)] border border-kreatum-purple/20"
            >
              <h2 className="text-2xl font-extrabold text-center mb-2 text-kreatum-dark dark:text-white">Finalizar Workshop</h2>
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
             <Button variant="outline" className="rounded-xl px-6 h-12 w-full sm:w-auto" onClick={handleExportJSON} disabled={isExporting}>
               {isExporting ? 'Exportando...' : 'Exportar Todo (JSON)'}
             </Button>
             <Button className="bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-xl px-8 h-12 w-full sm:w-auto" onClick={() => setShowFinalizeModal(true)}>
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
