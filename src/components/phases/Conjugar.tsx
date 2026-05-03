import React, { useState } from 'react';
import { GameState } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import { motion } from 'motion/react';
import { Button } from '../ui/Button';
import { ArrowDown } from 'lucide-react';

import { useGame } from '../../contexts/GameContext';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

export function Conjugar({ state, updateState }: Props) {
  const { saveSolution } = useGame();
  const [selectionError, setSelectionError] = useState('');
  
  const handleSolutionChange = (index: number, value: string) => {
    const newSolutions = [...state.solutions];
    newSolutions[index] = value;
    if (index === newSolutions.length - 1 && value.trim() !== '') {
      newSolutions.push('');
    }
    updateState({ solutions: newSolutions });
  };

  const handleTop3Change = (index: number, value: string) => {
    const newTop3 = [...state.top3Solutions] as [string, string, string];
    newTop3[index] = value;
    updateState({ top3Solutions: newTop3 });
  };

  const selectForTop3 = (value: string) => {
    if (!value.trim()) return;
    const newTop3 = [...state.top3Solutions] as [string, string, string];
    const emptyIndex = newTop3.findIndex(p => p.trim() === '');
    if (emptyIndex !== -1) {
      newTop3[emptyIndex] = value;
      updateState({ top3Solutions: newTop3 });
    } else {
      setSelectionError('Ya has elegido 3 soluciones. Borra una para poder seleccionar otra.');
      setTimeout(() => setSelectionError(''), 4000);
    }
  };

  const handleVoteChange = (index: number, value: string) => {
    const num = parseInt(value, 10) || 0;
    const newVotes = [...state.solutionVotes] as [number, number, number];
    newVotes[index] = num;
    updateState({ solutionVotes: newVotes });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
      
      <div className="mb-10">
        <h2 className="text-5xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif mb-4">Fase 3: Conjugar</h2>
        <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/80 uppercase tracking-widest">Generación de soluciones abstractas para la línea elegida.</p>
      </div>

      <Card className="border-l-4 border-l-kreatum-turquoise">
        <CardHeader>
          <CardTitle>Línea de Pensamiento Elegida</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-light text-kreatum-dark/90 dark:text-white/90 font-serif leading-relaxed">
            {state.selectedPerspective ? `"${state.selectedPerspective}"` : <span className="text-kreatum-gray/50 dark:text-white/70 text-base font-sans">No se ha seleccionado ninguna línea todavía. Vuelve a la fase Diluir.</span>}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posibles Soluciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.solutions.map((sol, idx) => (
            <div key={idx} className="flex items-center gap-4">
              <span className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-2xl text-kreatum-gray/60 dark:text-white/80 font-mono text-sm border border-black/5 dark:border-white/5">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <Input 
                value={sol}
                onChange={(e) => handleSolutionChange(idx, e.target.value)}
                placeholder="Plantea una solución..."
              />
              <Button
                variant="outline"
                className="h-12 px-4 flex-shrink-0 cursor-pointer"
                onClick={() => selectForTop3(sol)}
                disabled={!sol.trim()}
                title="Elegir para mis 3 soluciones"
              >
                <ArrowDown className="w-4 h-4 mr-2" />
                Elegir
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Nuestras 3 Soluciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {selectionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm font-mono text-center mb-4">
                {selectionError}
              </div>
            )}
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.2em] text-kreatum-turquoise font-black">Solución {idx + 1}</label>
                <Input 
                  value={state.top3Solutions[idx]}
                  onChange={(e) => handleTop3Change(idx, e.target.value)}
                  placeholder="Copia o adapta aquí la solución..."
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-kreatum-turquoise/5 border-kreatum-turquoise/20">
          <CardHeader>
            <CardTitle>Votaciones y Decisión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8 flex flex-col">
            <div className="space-y-6 flex-1">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="flex items-center gap-6">
                  <div className="flex-1 truncate text-sm font-mono text-kreatum-gray/90 dark:text-white/80">
                    {state.top3Solutions[idx] || <span className="text-kreatum-gray/50 dark:text-white/60 truncate">Solución {idx + 1} vacía</span>}
                  </div>
                  <div className="w-24">
                    <Input 
                      type="number" 
                      min="0"
                      value={state.solutionVotes[idx] || ''}
                      onChange={(e) => handleVoteChange(idx, e.target.value)}
                      placeholder="Votos"
                      className="text-center font-bold text-kreatum-turquoise text-lg placeholder:text-kreatum-gray/30 dark:placeholder:text-white/20"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-8 border-t border-black/10 dark:border-white/10 mt-auto">
              <label className="block text-[10px] uppercase tracking-[0.2em] text-kreatum-turquoise font-black mb-4">
                Solución Definitiva (Aprobada por el Alquimista)
              </label>
              <Input 
                value={state.selectedSolution}
                onChange={(e) => {
                  const val = e.target.value;
                  updateState({ selectedSolution: val });
                  if (state.team) {
                    saveSolution(state.team, val);
                  }
                }}
                placeholder="Escribe la solución a desarrollar..."
                className="border-kreatum-turquoise/40 dark:border-kreatum-turquoise/50 focus:ring-kreatum-turquoise bg-kreatum-turquoise/5 dark:bg-kreatum-turquoise/10"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
