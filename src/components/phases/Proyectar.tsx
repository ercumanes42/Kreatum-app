import React, { useState } from 'react';
import { GameState } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Textarea } from '../ui/Textarea';
import { motion } from 'motion/react';
import { Button } from '../ui/Button';
import { Sparkles, Eye, PartyPopper, CheckCircle2 } from 'lucide-react';
import { sounds } from '../../lib/sounds';
import { useGame } from '../../contexts/GameContext';
import { useTeamSync, useAttacksSent, useAttacksReceived } from '../../hooks/useRealtime';
import { WorkshopClosure } from './WorkshopClosure';
import { createPortal } from 'react-dom';
import { PhaseHeader } from './PhaseHeader';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

export function Proyectar({ state, updateState }: Props) {
  const { gameId } = useGame();
  const [showSummary, setShowSummary] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleFinalize = async () => {
    setIsSaving(true);
    try {
      // Save pitch data and mark as finished
      updateState({
        pitchStart: state.pitchStart,
        pitchProblem: state.pitchProblem,
        pitchSolution: state.pitchSolution,
        pitchAction: state.pitchAction,
        isFinished: true,
      });
      sounds.playSuccess();
      setIsFinished(true);
    } catch (e) {
      console.error('Error al finalizar:', e);
    } finally {
      setIsSaving(false);
    }
  };

  // Show congratulations screen after finalizing
  if (isFinished || state.isFinished) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }} 
        animate={{ opacity: 1, scale: 1 }} 
        className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-8"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
          className="w-28 h-28 relative"
        >
          <div className="absolute inset-0 bg-kreatum-purple/30 rounded-[32px] blur-xl animate-pulse" />
          <div className="relative w-full h-full bg-gradient-to-br from-kreatum-purple to-kreatum-turquoise rounded-[32px] flex items-center justify-center shadow-2xl shadow-kreatum-purple/40">
            {state.team ? (
              <img 
                src={`/assets/logos/${state.team.toLowerCase()}.png`} 
                alt={state.team}
                className="w-20 h-20 object-contain drop-shadow-2xl" 
              />
            ) : (
              <PartyPopper className="w-14 h-14 text-white" />
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h1 className="text-5xl md:text-6xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif mb-4">
            ¡Enhorabuena!
          </h1>
          <p className="text-lg text-kreatum-gray/70 dark:text-white/60 font-mono max-w-md mx-auto">
            Has finalizado el workshop. Vamos a las votaciones.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex items-center gap-3 px-6 py-3 bg-kreatum-green/10 text-kreatum-green rounded-2xl border border-kreatum-green/20"
        >
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-bold uppercase tracking-widest">Workshop completado al 100%</span>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0 }}
          className="text-sm text-kreatum-gray/40 dark:text-white/30 font-mono"
        >
          Equipo {state.team || '—'} · {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </motion.p>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
      <PhaseHeader
        phase="Proyectar"
        subtitle="Prepara tu presentación y speech (Pitch)."
      >
        <Button
          variant="outline"
          className="flex gap-2 items-center rounded-2xl px-6 h-12 border-kreatum-purple/20 text-kreatum-purple hover:bg-kreatum-purple/5"
          onClick={() => setShowSummary(true)}
        >
          <Eye className="w-5 h-5" />
          Ver Resumen
        </Button>
      </PhaseHeader>

      {/* Summary Modal */}
      {showSummary && createPortal(
        <WorkshopClosure 
          state={state} 
          isOpen={true} 
          onClose={() => setShowSummary(false)}
        />,
        document.body
      )}

      <Card className="bg-kreatum-purple/5 border-kreatum-purple/20 shadow-[0_0_30px_rgba(162,84,156,0.1)]">
        <CardHeader className="border-b border-kreatum-purple/10 pb-6">
          <CardTitle className="text-kreatum-purple">
            Estructura tu Pitch
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-8">
          <div className="grid sm:grid-cols-2 gap-6">
            <Card className="bg-white/40 dark:bg-white/5 shadow-none border-dashed border-2 hover:border-kreatum-purple/50 transition-colors">
              <CardContent className="p-6 flex flex-col gap-4 h-full">
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-kreatum-purple font-black block mb-1">1. Llamada de atención</span>
                  <p className="text-xs text-kreatum-gray/80 dark:text-white/60 font-mono">¿Cómo vas a empezar?</p>
                </div>
                <Textarea
                  value={state.pitchStart}
                  onChange={(e) => updateState({ pitchStart: e.target.value })}
                  className="min-h-[120px] bg-white/50 dark:bg-black/20 text-sm flex-1"
                  placeholder="Escribe tu inicio aquí..."
                />
              </CardContent>
            </Card>
            
            <Card className="bg-white/40 dark:bg-black/20 shadow-none border-dashed border-2 hover:border-kreatum-purple/50 transition-colors">
              <CardContent className="p-6 flex flex-col gap-4 h-full">
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-kreatum-purple font-black block mb-1">2. Problema</span>
                  <p className="text-xs text-kreatum-gray/80 dark:text-white/60 font-mono">¿Qué dolor estás resolviendo?</p>
                </div>
                <Textarea
                  value={state.pitchProblem}
                  onChange={(e) => updateState({ pitchProblem: e.target.value })}
                  className="min-h-[120px] bg-white/50 dark:bg-black/20 text-sm flex-1"
                  placeholder="Escribe el problema aquí..."
                />
              </CardContent>
            </Card>
            
            <Card className="bg-white/40 dark:bg-black/20 shadow-none border-dashed border-2 hover:border-kreatum-purple/50 transition-colors">
              <CardContent className="p-6 flex flex-col gap-4 h-full">
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-kreatum-purple font-black block mb-1">3. Solución</span>
                  <p className="text-xs text-kreatum-gray/80 dark:text-white/60 font-mono">Explica tu solución y cómo probarla rápido y barato.</p>
                </div>
                <Textarea
                  value={state.pitchSolution}
                  onChange={(e) => updateState({ pitchSolution: e.target.value })}
                  className="min-h-[120px] bg-white/50 dark:bg-black/20 text-sm flex-1"
                  placeholder="Escribe la solución aquí..."
                />
              </CardContent>
            </Card>

            <Card className="bg-white/40 dark:bg-black/20 shadow-none border-dashed border-2 hover:border-kreatum-purple/50 transition-colors">
              <CardContent className="p-6 flex flex-col gap-4 h-full">
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-kreatum-purple font-black block mb-1">4. Llamada a la acción</span>
                  <p className="text-xs text-kreatum-gray/80 dark:text-white/60 font-mono">¿Qué pides?</p>
                </div>
                <Textarea
                  value={state.pitchAction}
                  onChange={(e) => updateState({ pitchAction: e.target.value })}
                  className="min-h-[120px] bg-white/50 dark:bg-black/20 text-sm flex-1"
                  placeholder="Escribe la llamada a la acción aquí..."
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-center mt-12">
            <Button
              onClick={handleFinalize}
              disabled={isSaving}
              className="px-12 flex gap-3 items-center rounded-2xl h-14 bg-gradient-to-r from-kreatum-purple to-kreatum-purple-dark hover:from-kreatum-purple-dark hover:to-kreatum-purple text-white shadow-xl shadow-kreatum-purple/30 text-lg"
            >
              <Sparkles className="w-5 h-5" />
              {isSaving ? 'Guardando...' : 'Finalizar Workshop'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
