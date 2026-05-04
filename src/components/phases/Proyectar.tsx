import React from 'react';
import { GameState } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Textarea } from '../ui/Textarea';
import { motion } from 'motion/react';
import { Button } from '../ui/Button';
import { Sparkles } from 'lucide-react';
import { sounds } from '../../lib/sounds';
import { useAttacksReceived, useAttacksSent } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

export function Proyectar({ state, updateState }: Props) {
  const { gameId, leaveGame } = useGame();

  // Fetch real attack data from Firestore
  const { attacks: firestoreAttacksReceived } = useAttacksReceived(gameId, state.team);
  const { attacks: firestoreAttacksSent } = useAttacksSent(gameId, state.team);

  const attacksSentList = firestoreAttacksSent.length > 0
    ? firestoreAttacksSent.map(a => a.content)
    : state.attacksOnOthers.filter(a => a.trim());
  const attacksReceivedList = firestoreAttacksReceived.map(a => a.content);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
      <div className="mb-10">
        <h2 className="text-5xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif mb-4">Fase 6: Proyectar</h2>
        <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/80 uppercase tracking-widest">Prepara tu presentación y speech (Pitch).</p>
      </div>

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
                  onChange={(e) => {
                    updateState({ pitchStart: e.target.value });
                  }}
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
                  onChange={(e) => {
                    updateState({ pitchProblem: e.target.value });
                  }}
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
                  onChange={(e) => {
                    updateState({ pitchSolution: e.target.value });
                  }}
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
                  onChange={(e) => {
                    updateState({ pitchAction: e.target.value });
                  }}
                  className="min-h-[120px] bg-white/50 dark:bg-black/20 text-sm flex-1"
                  placeholder="Escribe la llamada a la acción aquí..."
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-center mt-12">
            <Button
              onClick={() => {
                sounds.playSuccess();
                leaveGame();
              }}
              className="px-12 flex gap-3 items-center rounded-2xl h-14 bg-gradient-to-r from-kreatum-purple to-kreatum-purple-dark hover:from-kreatum-purple-dark hover:to-kreatum-purple text-white shadow-xl shadow-kreatum-purple/30 text-lg"
            >
              <Sparkles className="w-5 h-5" />
              Finalizar Workshop
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
