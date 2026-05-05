import React, { useState } from 'react';
import { GameState } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Trophy, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/Button';
import { sounds } from '../../lib/sounds';
import { useAttacksReceived, useAttacksSent } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';

interface Props {
  state: GameState;
  isOpen: boolean;
  onClose: () => void;
}

export function WorkshopClosure({ state, isOpen, onClose }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const { gameId, leaveGame } = useGame();

  // Fetch real attack data from Firestore
  const { attacks: firestoreAttacksReceived } = useAttacksReceived(gameId, state.team);
  const { attacks: firestoreAttacksSent } = useAttacksSent(gameId, state.team);

  if (!isOpen) return null;

  // Use Firestore data (real-time) with fallback to local state
  const attacksSentCount = firestoreAttacksSent.length || (state.attacksOnOthers ?? []).filter(a => a.trim()).length;
  const attacksReceivedCount = firestoreAttacksReceived.length;
  const attacksSentList = firestoreAttacksSent.length > 0
    ? firestoreAttacksSent.map(a => a.content)
    : (state.attacksOnOthers ?? []).filter(a => a.trim());
  const attacksReceivedList = firestoreAttacksReceived.map(a => a.content);

  const toggleSection = (key: string) => {
    setExpandedSection(prev => prev === key ? null : key);
  };

  const sections = [
    {
      key: 'diluir',
      title: 'Diluir — Perspectivas',
      color: 'kreatum-turquoise',
      items: [
        { label: 'Reto', value: state.challenge },
        { label: 'Perspectiva Definitiva', value: state.selectedPerspective },
        { label: `Perspectivas generadas`, value: (state.perspectives ?? []).filter(p => p.trim()).length.toString() },
      ]
    },
    {
      key: 'conjugar',
      title: 'Conjugar — Soluciones',
      color: 'kreatum-purple',
      items: [
        { label: 'Solución Definitiva', value: state.selectedSolution },
        { label: 'Soluciones generadas', value: (state.solutions ?? []).filter(s => s.trim()).length.toString() },
      ]
    },
    {
      key: 'sublimar',
      title: 'Sublimar — Ataque & Defensa',
      color: 'kreatum-red',
      items: [
        { label: 'Ataques enviados', value: attacksSentCount.toString() },
        { label: 'Ataques recibidos', value: attacksReceivedCount.toString() },
        { label: 'Solución Reformulada', value: state.reformulatedSolution },
      ]
    },
    {
      key: 'fermentar',
      title: 'Fermentar — Aterrizaje',
      color: 'kreatum-green',
      items: [
        { label: 'Audiencia', value: state.audience },
        { label: 'Fortalezas', value: state.strengths },
        { label: 'Prueba Piloto', value: state.pilot },
      ]
    },
    {
      key: 'proyectar',
      title: 'Proyectar — Pitch',
      color: 'kreatum-purple',
      items: [
        { label: 'Inicio', value: state.pitchStart },
        { label: 'Problema', value: state.pitchProblem },
        { label: 'Solución', value: state.pitchSolution },
        { label: 'Llamada a la acción', value: state.pitchAction },
      ]
    },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center"
        style={{ backgroundColor: 'rgba(5,5,5,0.95)' }}
      >
        {/* Animated glow orbs */}
        <div className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] bg-kreatum-purple/20 rounded-full blur-[200px] pointer-events-none animate-pulse" />
        <div className="absolute bottom-[-200px] right-[-200px] w-[500px] h-[500px] bg-kreatum-turquoise/15 rounded-full blur-[180px] pointer-events-none" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-8 right-8 z-[110] p-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all group"
          aria-label="Cerrar"
        >
          <X className="w-6 h-6 text-white/60 group-hover:text-white transition-colors" />
        </button>

        {/* Scrollable container */}
        <div className="absolute inset-0 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-start py-16 px-4">

            {/* Hero section */}
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="text-center mb-16 max-w-2xl"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
                className="w-28 h-28 mx-auto mb-10 relative"
              >
                <div className="absolute inset-0 bg-kreatum-purple/30 rounded-[32px] blur-xl animate-pulse" />
                <div className="relative w-full h-full bg-gradient-to-br from-kreatum-purple to-kreatum-turquoise rounded-[32px] flex items-center justify-center shadow-2xl shadow-kreatum-purple/40 overflow-hidden">
                  {state.team ? (
                    <img 
                      src={`/assets/logos/${state.team.toLowerCase()}.png`} 
                      alt={state.team}
                      className="w-20 h-20 object-contain drop-shadow-2xl" 
                    />
                  ) : (
                    <Trophy className="w-14 h-14 text-white" />
                  )}
                </div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="text-6xl md:text-7xl font-light tracking-tighter text-white font-serif mb-6"
              >
                ¡Enhorabuena!
              </motion.h1>


              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="flex items-center justify-center gap-4 mb-6"
              >
                <div className="h-px w-16 bg-gradient-to-r from-transparent to-kreatum-purple/50" />
                <Sparkles className="w-5 h-5 text-kreatum-purple" />
                <span className="text-sm font-mono uppercase tracking-[0.3em] text-kreatum-purple">
                  Equipo {state.team || '—'}
                </span>
                <Sparkles className="w-5 h-5 text-kreatum-purple" />
                <div className="h-px w-16 bg-gradient-to-l from-transparent to-kreatum-purple/50" />
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="text-white/40 text-sm font-mono"
              >
                {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </motion.p>
            </motion.div>

            {/* Summary cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.0 }}
              className="w-full max-w-2xl space-y-4 mb-16"
            >
              {sections.map((section, idx) => (
                <motion.div
                  key={section.key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.1 + idx * 0.1 }}
                >
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="w-full text-left p-5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-xl bg-${section.color}/20 flex items-center justify-center`}>
                          <CheckCircle2 className={`w-4 h-4 text-${section.color}`} />
                        </div>
                        <span className="text-sm font-bold text-white/90 uppercase tracking-wide">
                          {section.title}
                        </span>
                      </div>
                      {expandedSection === section.key
                        ? <ChevronUp className="w-5 h-5 text-white/30" />
                        : <ChevronDown className="w-5 h-5 text-white/30" />
                      }
                    </div>

                    <AnimatePresence>
                      {expandedSection === section.key && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-5 mt-4 border-t border-white/5 space-y-3">
                            {section.items.map((item, i) => (
                              <div key={i} className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">
                                  {item.label}
                                </span>
                                <span className="text-sm text-white/70 leading-relaxed">
                                  {item.value?.trim() || '(sin respuesta)'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                </motion.div>
              ))}
            </motion.div>

            {/* Action button */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6 }}
              className="flex justify-center mb-20"
            >
              <Button
                size="lg"
                onClick={() => {
                  sounds.playSuccess();
                  onClose();
                  leaveGame();
                }}
                className="px-12 flex gap-3 items-center rounded-2xl h-14 bg-gradient-to-r from-kreatum-purple to-kreatum-purple-dark hover:from-kreatum-purple-dark hover:to-kreatum-purple text-white shadow-xl shadow-kreatum-purple/30 text-base"
              >
                <CheckCircle2 className="w-5 h-5" />
                Volver al Inicio
              </Button>
            </motion.div>
          </div>
        </div>

      </motion.div>
    </AnimatePresence>
  );
}
