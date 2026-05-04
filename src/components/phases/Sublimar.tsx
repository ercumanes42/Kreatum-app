import React, { useState } from 'react';
import { GameState, Team } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Shield, Zap, Lock, ChevronRight, X } from 'lucide-react';
import { useAttacksReceived, useOpponentSolutions, useAttacksSent, Attack, useGameGlobal } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';
import { cn } from '../../lib/utils';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

const TEAM_COLORS: Record<Team, string> = {
  Fuego: 'border-kreatum-red bg-kreatum-red/5',
  Agua: 'border-kreatum-blue bg-kreatum-blue/5',
  Tierra: 'border-kreatum-green bg-kreatum-green/5',
  Aire: 'border-kreatum-turquoise bg-kreatum-turquoise/5',
};

const TEAM_ICONS: Record<Team, React.ReactNode> = {
  Fuego: <img src="/assets/logos/fuego.png" alt="Fuego" className="w-5 h-5 object-contain" />,
  Agua: <img src="/assets/logos/agua.png" alt="Agua" className="w-5 h-5 object-contain" />,
  Tierra: <img src="/assets/logos/tierra.png" alt="Tierra" className="w-5 h-5 object-contain" />,
  Aire: <img src="/assets/logos/aire.png" alt="Aire" className="w-5 h-5 object-contain" />,
};

const ALL_TEAMS: Team[] = ['Fuego', 'Agua', 'Tierra', 'Aire'];
const MIN_ATTACKS_PER_TEAM = 10;
const MAX_ATTACKS_PER_TEAM = 10;

const ATTACK_MAP: Record<Team, Team> = {
  Agua: 'Fuego',
  Fuego: 'Tierra',
  Tierra: 'Aire',
  Aire: 'Agua',
};

export function Sublimar({ state, updateState }: Props) {
  const { sendAttack, deleteAttack, gameId } = useGame();

  const myTeam = state.team;
  const targetTeam = myTeam ? ATTACK_MAP[myTeam] : null;

  if (!myTeam) {
    return (
      <div className="p-8 text-center bg-kreatum-red/10 border border-kreatum-red/20 rounded-2xl">
        <Lock className="w-12 h-12 text-kreatum-red mx-auto mb-4" />
        <h3 className="text-xl font-bold text-kreatum-red mb-2">Equipo no seleccionado</h3>
        <p className="text-sm text-kreatum-dark dark:text-white/60">
          Por favor, selecciona tu equipo en la fase inicial para poder participar en los ataques.
        </p>
      </div>
    );
  }

  const { attacks: attacksReceived, isLoading: loadingAttacks } = useAttacksReceived(gameId, myTeam);
  const { attacks: attacksSent, isLoading: loadingAttacksSent } = useAttacksSent(gameId, myTeam);
  const { solutions: opponentSolutions } = useOpponentSolutions(gameId, myTeam);

  const [attackInput, setAttackInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const subView = state.sublimarView || 'Ataque';
  const setSubView = (view: 'Ataque' | 'Defensa') => updateState({ sublimarView: view });

  const currentRivalSolution = targetTeam ? opponentSolutions[targetTeam] || state.receivedSolutionToAttack : state.receivedSolutionToAttack;

  // Get attack count for our target team from Firestore data
  const getSentAttackCount = (): number => {
    return attacksSent.length;
  };

  const handleSendAttack = async () => {
    if (!attackInput.trim() || !targetTeam || !myTeam || isSending) return;

    // Check if max attacks reached
    const currentCount = getSentAttackCount();
    if (currentCount >= MAX_ATTACKS_PER_TEAM) return;

    setIsSending(true);
    try {
      await sendAttack(attackInput, targetTeam, myTeam);
      
      // Update local state if needed
      const newAttacks = [...state.attacksOnOthers];
      newAttacks.push(attackInput);
      updateState({ attacksOnOthers: newAttacks });

      setAttackInput('');
    } finally {
      setIsSending(false);
    }
  };

  const totalAttacksSent = getSentAttackCount();
  const requiredTotalAttacks = MIN_ATTACKS_PER_TEAM;
  const isAttackPhaseComplete = totalAttacksSent >= requiredTotalAttacks;

  const { globalState } = useGameGlobal(gameId);
  const isNextUnlocked = globalState?.unlockedPhases?.includes('Fermentar');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
      <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-5xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif mb-4">Fase 4: Sublimar</h2>
          <div className="flex items-center gap-3">
            <span className={cn(
              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
              subView === 'Ataque' ? "bg-kreatum-red text-white" : "bg-kreatum-blue text-white"
            )}>
              {subView}
            </span>
            <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/80 uppercase tracking-widest">
              {subView === 'Ataque' ? 'Focalización en debilidades rivales' : 'Mitigación y ajuste de nuestra solución'}
            </p>
          </div>
        </div>

        {isAttackPhaseComplete && (
          <div className="flex gap-2 p-1 bg-black/5 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
            <button
              onClick={() => setSubView('Ataque')}
              className={cn(
                "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                subView === 'Ataque' ? "bg-white dark:bg-white/10 shadow-sm text-kreatum-red" : "text-kreatum-gray/60 hover:text-kreatum-gray"
              )}
            >
              Ataque
            </button>
            <button
              onClick={() => setSubView('Defensa')}
              className={cn(
                "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                subView === 'Defensa' ? "bg-white dark:bg-white/10 shadow-sm text-kreatum-blue" : "text-kreatum-gray/60 hover:text-kreatum-gray"
              )}
            >
              Defensa y Reformulación
            </button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {subView === 'Ataque' ? (
          <motion.div
            key="ataque"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-12"
          >
            {/* ATAQUE */}
            <div className="space-y-8">
              <h3 className="text-sm font-black uppercase tracking-[0.3em] text-kreatum-red dark:text-red-500 flex items-center gap-4">
                <div className="h-px bg-kreatum-red/20 dark:bg-red-500/30 flex-1"></div>
                <Zap className="w-4 h-4" />
                Nuestra Ofensiva contra {targetTeam}
                <div className="h-px bg-kreatum-red/20 dark:bg-red-500/30 w-12"></div>
              </h3>

              {/* Progress bar for our target */}
              <div className="bg-kreatum-gray/5 dark:bg-white/5 rounded-xl p-4 border border-kreatum-gray/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase text-kreatum-gray dark:text-white/60">Progreso de Ataques</span>
                  <span className="text-xs font-mono text-kreatum-gray dark:text-white/60">
                    {totalAttacksSent} / {requiredTotalAttacks} ataques obligatorios
                  </span>
                </div>
                <div className="h-2 bg-kreatum-gray/10 dark:bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-300 rounded-full",
                      totalAttacksSent >= requiredTotalAttacks ? "bg-kreatum-green" : "bg-kreatum-red shadow-[0_0_10px_rgba(235,87,87,0.5)]"
                    )}
                    style={{ width: `${Math.min((totalAttacksSent / requiredTotalAttacks) * 100, 100)}%` }}
                  />
                </div>
                {totalAttacksSent < requiredTotalAttacks ? (
                  <p className="text-[10px] text-kreatum-red/70 mt-2 font-medium italic">
                    * Debes completar 10 ataques al equipo {targetTeam} para desbloquear la defensa.
                  </p>
                ) : (
                  <p className="text-xs text-kreatum-green mt-2 font-bold flex items-center gap-1">
                    <Shield className="w-3 h-3" /> ¡Objetivo de ataques completado! Ya puedes pasar a Defensa.
                  </p>
                )}
              </div>

              <Card className="border-l-4 border-l-kreatum-red dark:border-l-red-500 bg-kreatum-red/5 dark:bg-red-500/5">
                <CardHeader>
                  <CardTitle>Solución del Equipo {targetTeam || '...'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xl font-light text-kreatum-dark/90 dark:text-white/90 font-serif leading-relaxed italic">
                    "{currentRivalSolution || 'Cargando solución del rival...'}"
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <span>Nuestros ataques a {targetTeam}</span>
                    <span className="text-xs font-mono px-2 py-1 bg-kreatum-red/10 text-kreatum-red rounded-lg">
                      {totalAttacksSent} / {MAX_ATTACKS_PER_TEAM}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3">
                    <Input
                      value={attackInput}
                      onChange={(e) => setAttackInput(e.target.value)}
                      placeholder={totalAttacksSent >= MAX_ATTACKS_PER_TEAM
                        ? "¡10 ataques completados!"
                        : `Escribe ataque #${totalAttacksSent + 1} para ${targetTeam}...`}
                      className="flex-1"
                      disabled={!targetTeam || totalAttacksSent >= MAX_ATTACKS_PER_TEAM || isSending}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendAttack()}
                    />
                    <button
                      onClick={handleSendAttack}
                      disabled={!attackInput.trim() || isSending || !targetTeam || totalAttacksSent >= MAX_ATTACKS_PER_TEAM}
                      className={cn(
                        "px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2",
                        totalAttacksSent >= MAX_ATTACKS_PER_TEAM
                          ? "bg-kreatum-green/20 text-kreatum-green cursor-not-allowed"
                          : "bg-kreatum-red hover:bg-kreatum-red/90 text-white shadow-lg shadow-kreatum-red/20"
                      )}
                    >
                      {isSending ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                      <span>Enviar</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
                    {attacksSent.map((attack, idx) => (
                      <motion.div
                        key={attack.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="group relative flex items-center gap-3 p-3 bg-white dark:bg-white/5 rounded-xl border border-kreatum-red/10 shadow-sm"
                      >
                        <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center bg-kreatum-red/10 text-kreatum-red rounded-lg text-[10px] font-mono font-bold">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="text-xs text-kreatum-dark dark:text-white/80 line-clamp-2 pr-6">{attack.content}</span>
                        
                        <button
                          onClick={() => deleteAttack(attack.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-kreatum-red/40 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          title="Eliminar ataque"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {isAttackPhaseComplete && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-center pt-8"
                >
                  <button
                    onClick={() => setSubView('Defensa')}
                    disabled={!isNextUnlocked}
                    className={cn(
                      "group relative px-12 py-5 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl transition-all overflow-hidden",
                      isNextUnlocked 
                        ? "bg-kreatum-blue text-white shadow-kreatum-blue/20 hover:scale-105" 
                        : "bg-kreatum-gray/20 text-kreatum-gray/40 cursor-not-allowed"
                    )}
                  >
                    <span className="relative z-10 flex items-center gap-3">
                      {isNextUnlocked ? 'Continuar a Defensa' : '🔒 Esperando al Alquimista'} 
                      {isNextUnlocked && <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />}
                    </span>
                    {isNextUnlocked && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />}
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="defensa"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-16"
          >
            {/* DEFENSA */}
            <div className="space-y-8">
              <h3 className="text-sm font-black uppercase tracking-[0.3em] text-kreatum-blue dark:text-blue-400 flex items-center gap-4">
                <div className="h-px bg-kreatum-blue/20 dark:bg-blue-400/30 w-12"></div>
                <Shield className="w-4 h-4" />
                Defensa
                <div className="h-px bg-kreatum-blue/20 dark:bg-blue-400/30 flex-1"></div>
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Attacks Received - REAL TIME */}
                <Card className="border-l-4 border-l-kreatum-blue dark:border-l-blue-500 bg-kreatum-blue/5 dark:bg-blue-500/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-kreatum-blue dark:bg-blue-400 rounded-full animate-pulse"></span>
                      Ataques recibidos
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {loadingAttacks ? (
                      <div className="text-center py-8 text-kreatum-gray dark:text-white/60">Cargando...</div>
                    ) : attacksReceived.length === 0 ? (
                      <div className="text-center py-8 text-kreatum-gray dark:text-white/60 italic text-sm">
                        Esperando ataques de otros equipos...
                      </div>
                    ) : (
                      <AnimatePresence mode="popLayout">
                        {attacksReceived.map((attack, idx) => (
                          <motion.div
                            key={attack.id}
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.3, type: 'spring', stiffness: 300 }}
                            className="w-full p-4 rounded-2xl border bg-white dark:bg-white/5 border-kreatum-blue/20 flex gap-4 items-center shadow-sm"
                          >
                            <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-kreatum-blue dark:bg-blue-500 text-white rounded-full text-xs font-bold shadow-lg shadow-kreatum-blue/30">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-black text-kreatum-blue dark:text-blue-400 uppercase tracking-tighter">
                                  EQUIPO {attack.fromTeam}
                                </span>
                              </div>
                              <p className="text-sm text-kreatum-dark dark:text-white/90 font-medium leading-tight">{attack.content}</p>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    )}
                  </CardContent>
                </Card>

                {/* Nuestras Defensas / Mitigaciones */}
                <Card className="border-l-4 border-l-kreatum-blue dark:border-l-blue-500">
                  <CardHeader>
                    <CardTitle>Mitigaciones</CardTitle>
                    <p className="text-[10px] text-kreatum-gray/60 dark:text-white/40 uppercase font-bold tracking-widest mt-1">Escribe tus respuestas a cada ataque recibido</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {attacksReceived.length > 0 ? (
                      <div className="space-y-6">
                        {attacksReceived.map((attack, idx) => (
                          <div key={attack.id} className="space-y-2 p-4 bg-kreatum-blue/5 dark:bg-blue-400/5 rounded-2xl border border-kreatum-blue/10">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold text-kreatum-blue dark:text-blue-400 uppercase">
                                Para Ataque #{idx + 1}
                              </p>
                              {state.defenses[idx] && state.defenses[idx].trim() && (
                                <span className="text-[10px] text-kreatum-green font-bold">✓ Guardado</span>
                              )}
                            </div>
                            <Input
                              value={state.defenses[idx] || ''}
                              onChange={(e) => {
                                const newDefenses = [...state.defenses];
                                // Ensure the array is large enough
                                while (newDefenses.length <= idx) {
                                  newDefenses.push('');
                                }
                                newDefenses[idx] = e.target.value;
                                updateState({ defenses: newDefenses });
                              }}
                              placeholder="Escribe tu mitigación aquí..."
                              className="w-full bg-white dark:bg-black/20 border-none shadow-inner"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 px-6 border-2 border-dashed border-kreatum-gray/10 rounded-2xl">
                        <Shield className="w-8 h-8 text-kreatum-gray/20 mx-auto mb-4" />
                        <p className="text-sm text-kreatum-gray dark:text-white/40 italic">
                          Cuando recibas ataques de otros equipos, aquí podrás escribir tus mitigaciones.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* REFORMULACIÓN */}
            <div className="space-y-8">
              <h3 className="text-sm font-black uppercase tracking-[0.3em] text-kreatum-purple dark:text-purple-400 flex items-center gap-4">
                <div className="h-px bg-kreatum-purple/20 dark:bg-purple-400/30 w-12"></div>
                Reformulación
                <div className="h-px bg-kreatum-purple/20 dark:bg-purple-400/30 flex-1"></div>
              </h3>

              <Card>
                <CardHeader>
                  <CardTitle>Solución reformulada</CardTitle>
                  <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/80">Teniendo en cuenta los ataques y defensas, pivotamos y reformulamos.</p>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={state.reformulatedSolution || ''}
                    onChange={(e) => updateState({ reformulatedSolution: e.target.value })}
                    placeholder="Describe la solución reformulada en detalle..."
                    className="w-full min-h-[150px] p-4 bg-kreatum-gray/5 dark:bg-white/5 border border-kreatum-gray/20 dark:border-white/10 rounded-2xl font-sans text-kreatum-dark dark:text-white focus:outline-none focus:ring-2 focus:ring-kreatum-purple/50 focus:border-transparent resize-y"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Resultados esperados</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={state.expectedResults || ''}
                    onChange={(e) => updateState({ expectedResults: e.target.value })}
                    placeholder="¿Cuáles son los resultados esperados con esta nueva solución?..."
                    className="w-full min-h-[150px] p-4 bg-kreatum-gray/5 dark:bg-white/5 border border-kreatum-gray/20 dark:border-white/10 rounded-2xl font-sans text-kreatum-dark dark:text-white focus:outline-none focus:ring-2 focus:ring-kreatum-purple/50 focus:border-transparent resize-y"
                  />
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}