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
  const { gameId } = useGame();

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

  const SECTION_COLORS: Record<string, { bg: string; text: string }> = {
    'kreatum-turquoise': { bg: 'bg-kreatum-turquoise/20', text: 'text-kreatum-turquoise' },
    'kreatum-purple': { bg: 'bg-kreatum-purple/20', text: 'text-kreatum-purple' },
    'kreatum-red': { bg: 'bg-kreatum-red/20', text: 'text-kreatum-red' },
    'kreatum-green': { bg: 'bg-kreatum-green/20', text: 'text-kreatum-green' },
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
        { label: 'Debilidades', value: state.weaknesses },
        { label: 'Prueba Piloto', value: state.pilot },
        { label: 'Recursos', value: state.resources },
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
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[#090a0e]/95"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 z-[110] p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors group"
          aria-label="Cerrar"
        >
          <X className="w-6 h-6 text-white/60 group-hover:text-white transition-colors" />
        </button>

        {/* Scrollable container */}
        <div className="absolute inset-0 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-start py-16 px-4">

            {/* Hero section */}
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              className="text-center mb-12 max-w-2xl"
            >
              <motion.div
                initial={{ scale: 0.94, opacity: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, duration: 0.25 }}
                className="w-24 h-24 mx-auto mb-8 relative"
              >
                <div className="relative w-full h-full bg-kreatum-purple rounded-2xl flex items-center justify-center shadow-[0_18px_40px_-26px_rgba(162,84,156,0.85)] overflow-hidden">
                  {state.team ? (
                    <img 
                      src={`/assets/logos/${state.team.toLowerCase()}.png`} 
                      alt={state.team}
                      className="w-16 h-16 object-contain" 
                    />
                  ) : (
                    <Trophy className="w-14 h-14 text-white" />
                  )}
                </div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-4xl md:text-5xl font-extrabold tracking-normal text-white mb-5"
              >
                ¡Enhorabuena!
              </motion.h1>


              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="flex items-center justify-center gap-4 mb-6"
              >
                <div className="h-px w-16 bg-gradient-to-r from-transparent to-kreatum-purple/50" />
                <Sparkles className="w-5 h-5 text-kreatum-purple" />
                <span className="text-sm font-bold text-kreatum-purple">
                  Equipo {state.team || '—'}
                </span>
                <Sparkles className="w-5 h-5 text-kreatum-purple" />
                <div className="h-px w-16 bg-gradient-to-l from-transparent to-kreatum-purple/50" />
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-white/45 text-sm font-medium"
              >
                {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </motion.p>
            </motion.div>

            {/* Summary cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="w-full max-w-2xl space-y-4 mb-16"
            >
              {sections.map((section, idx) => (
                <motion.div
                  key={section.key}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + idx * 0.04 }}
                >
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="w-full text-left p-5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] hover:border-white/[0.14] transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-xl ${SECTION_COLORS[section.color]?.bg || 'bg-white/10'} flex items-center justify-center`}>
                          <CheckCircle2 className={`w-4 h-4 ${SECTION_COLORS[section.color]?.text || 'text-white'}`} />
                        </div>
                        <span className="text-sm font-bold text-white/90">
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
                                <span className="text-xs font-bold text-white/35">
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
              transition={{ delay: 0.55 }}
              className="flex justify-center mb-20"
            >
              <Button
                size="lg"
                onClick={() => {
                  sounds.playSuccess();
                  onClose();
                }}
                className="px-10 flex gap-3 items-center rounded-xl h-14 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white text-base"
              >
                <CheckCircle2 className="w-5 h-5" />
                Cerrar Resumen
              </Button>
            </motion.div>
          </div>
        </div>

      </motion.div>
    </AnimatePresence>
  );
}
