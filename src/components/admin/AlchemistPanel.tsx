import { useState } from 'react';
import { useGameGlobal, useAllTeams, useAttacksCountByTeam } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';
import { Phase, Team } from '../../types';
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
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { GameHistory } from './GameHistory';
import { WorkshopClosure } from '../phases/WorkshopClosure';
import { Sparkles } from 'lucide-react';

const PHASES: Phase[] = [
  'Selección',
  'Calcinar',
  'Diluir',
  'Conjugar',
  'Sublimar',
  'Fermentar',
  'Proyectar'
];

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

  const currentPhase = globalState.currentPhase || 'Selección';
  // Para compatibilidad hacia atrás: si no existe unlockedPhases, permitir todas las fases
  const hasUnlockedPhases = globalState.unlockedPhases && globalState.unlockedPhases.length > 0;
  const unlockedPhases = hasUnlockedPhases ? (globalState.unlockedPhases as string[]) : PHASES;

  const setGlobalPhase = async (phase: Phase) => {
    const newUnlocked = Array.from(new Set([...unlockedPhases, phase]));
    try {
      await updateGlobalState({ currentPhase: phase, unlockedPhases: newUnlocked });
    } catch (e: any) {
      alert('Error al actualizar fase: ' + e.message);
    }
  };

  const unlockPhase = async (phase: Phase) => {
    const newUnlocked = Array.from(new Set([...unlockedPhases, phase]));
    try {
      await updateGlobalState({ unlockedPhases: newUnlocked });
    } catch (e: any) {
      alert('Error al desbloquear fase: ' + e.message);
    }
  };

  const getTeamProgress = (teamData: any) => {
    if (!teamData) return 0;
    const phaseIndex = PHASES.indexOf(teamData.currentPhase || 'Selección');
    return Math.round(((phaseIndex + 1) / PHASES.length) * 100);
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
      alert('Error al exportar: ' + (err as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFinalize = async () => {
    if (!confirm('¿Seguro que quieres finalizar el workshop? Esto marcará la sesión como completada.')) return;
    try {
      await updateDoc(doc(db, 'games', gameId), { status: 'completed', completedAt: Date.now() });
      alert('Workshop finalizado y marcado como completado.');
      leaveGame();
    } catch (e: any) {
      console.error('Error al finalizar workshop:', e);
      alert('Error al finalizar workshop: ' + (e.message || 'Error de permisos'));
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

  return (
    <div className="min-h-screen bg-kreatum-bg-light dark:bg-kreatum-bg-dark p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-12">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-kreatum-purple rounded-3xl flex items-center justify-center shadow-xl transform -rotate-3">
              <LayoutDashboard className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif">Panel del Alquimista</h1>
              <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/60 uppercase tracking-widest">Moderador Maestro de Kreatum</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 bg-white/50 dark:bg-white/5 backdrop-blur-xl p-2 rounded-2xl border border-black/5 dark:border-white/5">
            <button 
              className={cn(
                "px-4 py-2 rounded-xl transition-all group flex flex-col items-center justify-center min-w-[120px]",
                copied ? "bg-green-500/20 text-green-600" : "bg-kreatum-purple/10 hover:bg-kreatum-purple/20"
              )}
              onClick={handleCopyCode}
              title="Haz clic para copiar"
            >
               <p className="text-[10px] font-mono uppercase tracking-widest opacity-60 mb-0.5">
                 {copied ? "¡Copiado!" : "Código de Sala"}
               </p>
               <p className={cn(
                 "text-xl font-bold font-mono tracking-wider transition-transform",
                 copied ? "scale-105" : "text-kreatum-purple group-hover:scale-105"
               )}>
                 {roomCode || '---'}
               </p>
            </button>
            <div className="h-10 w-px bg-black/10 dark:bg-white/10" />
            <div className="flex items-center gap-2 px-2">
              <Timer className="w-5 h-5 text-kreatum-purple" />
              <span className="font-mono text-lg font-bold px-2 opacity-40">—:—:—</span>
            </div>
            <Button size="sm" variant="ghost" className="rounded-xl text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={leaveGame}>Salir</Button>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white/50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5 w-fit">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
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
              "px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
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
        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* Phase Control */}
          <Card className="lg:col-span-1 border-kreatum-purple/20 bg-kreatum-purple/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
              <CardTitle className="text-xl font-serif text-kreatum-purple">Control de Fases</CardTitle>
              <Settings className="w-5 h-5 text-kreatum-purple opacity-50" />
            </CardHeader>
            <CardContent className="space-y-3">
              {PHASES.map((phase, idx) => {
                const isActive = currentPhase === phase;
                const isPast = PHASES.indexOf(currentPhase) > idx;
                const isNextUnlocked = idx === PHASES.length - 1 ? true : unlockedPhases.includes(PHASES[idx + 1]);
                return (
                  <button
                    key={phase}
                    onClick={() => setGlobalPhase(phase)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-2xl transition-all duration-300 border",
                      isActive 
                        ? "bg-kreatum-purple text-white border-kreatum-purple shadow-lg scale-[1.02] z-10" 
                        : isPast 
                          ? "bg-white dark:bg-white/5 text-kreatum-purple border-kreatum-purple/20 opacity-70"
                          : "bg-white dark:bg-white/5 text-kreatum-gray/60 border-black/5 dark:border-white/5 hover:border-kreatum-purple/30"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center border border-current text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="font-medium tracking-tight">{phase}</span>
                    </div>
                    {isPast ? <CheckCircle2 className="w-5 h-5" /> : isActive ? (
                      <div className="flex items-center gap-2">
                        {idx >= 2 && idx < PHASES.length - 1 && (
                          <button 
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
                                : "text-white hover:bg-white/20 hover:scale-110 active:scale-95"
                            )}
                            title={unlockedPhases.includes(PHASES[idx+1]) ? "Siguiente fase desbloqueada" : "Hacer clic para desbloquear siguiente fase"}
                          >
                            {unlockedPhases.includes(PHASES[idx+1]) ? '🔓' : '🔒'}
                          </button>
                        )}
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      </div>
                    ) : (idx >= 2 && !unlockedPhases.includes(phase)) ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); unlockPhase(phase); }}
                        className="text-white hover:scale-110 transition-transform p-1 hover:bg-kreatum-purple/20 rounded-md"
                        title="Clic para desbloquear"
                      >
                        🔒
                      </button>
                    ) : (
                      <ChevronRight className="w-4 h-4 opacity-30" />
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Teams Status */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl font-serif flex items-center gap-3">
                <Users className="w-6 h-6 text-kreatum-purple" />
                Estado de los Equipos
              </h2>
              <div className="flex gap-4">
                 <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest opacity-50">
                   <div className="w-2 h-2 rounded-full bg-kreatum-green" /> Conectados
                 </span>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {(['Agua', 'Aire', 'Fuego', 'Tierra'] as Team[]).map((teamId) => {
                const data = teams[teamId];
                const config = TEAM_CONFIG[teamId];
                const Icon = config.icon;
                const progress = getTeamProgress(data);
                
                return (
                  <Card key={teamId} className={cn("overflow-hidden border-black/5 dark:border-white/5 transition-all duration-500 hover:shadow-2xl", data ? "opacity-100" : "opacity-40 grayscale")}>
                    <div className={cn("h-2 w-full", config.color.replace('text-', 'bg-'))} />
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
                        <div className="flex justify-between text-xs font-mono uppercase tracking-widest opacity-60 mb-2">
                          <span>Progreso</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-black/5 dark:bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            className={cn("h-full", config.color.replace('text-', 'bg-'))} 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                         <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-1">Fase Actual</p>
                            <p className="text-sm font-bold truncate">{data?.currentPhase || 'Selección'}</p>
                         </div>
                         <div className="bg-black/5 dark:bg-white/5 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                            <p className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-1">Ataques</p>
                            <p className="text-sm font-bold">{attackCounts[teamId] || 0} enviados</p>
                         </div>
                      </div>

                      <div className="bg-black/5 dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5">
                        <p className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">Solución Definitiva</p>
                        <div className="flex justify-between items-start gap-4">
                          <p className="text-sm italic line-clamp-2 leading-relaxed flex-1">
                            {data?.selectedSolution || <span className="opacity-30">Aún no definida...</span>}
                          </p>
                          {data && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="shrink-0 h-8 px-3 text-[10px] uppercase tracking-widest font-bold border-kreatum-purple/20 text-kreatum-purple hover:bg-kreatum-purple/5"
                              onClick={() => setSummaryTeam(teamId)}
                            >
                              <Sparkles className="w-3 h-3 mr-1" />
                              Resumen
                            </Button>
                          )}
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

        {/* Action Bar */}
        <footer className="bg-white/40 dark:bg-black/40 backdrop-blur-2xl p-6 rounded-[32px] border border-black/5 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
               <ShieldAlert className="w-5 h-5 text-amber-500" />
             </div>
             <p className="text-sm font-medium text-kreatum-gray/80 dark:text-white/80 max-w-md">
               Como Alquimista, puedes forzar el cambio de fase para todos los equipos. Úsalo con sabiduría para mantener el ritmo del workshop.
             </p>
          </div>
          
          <div className="flex gap-4">
             <Button variant="outline" className="rounded-2xl px-6 h-12" onClick={handleExportJSON} disabled={isExporting}>
               {isExporting ? 'Exportando...' : 'Exportar Todo (JSON)'}
             </Button>
             <Button className="bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-2xl px-8 h-12 shadow-lg shadow-kreatum-purple/20" onClick={handleFinalize}>
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
