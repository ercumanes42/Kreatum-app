import React, { useRef, useCallback } from 'react';
import { useState } from 'react';
import { GameState, PHASES } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import { motion } from 'motion/react';
import { Button } from '../ui/Button';
import { ArrowDown, X } from 'lucide-react';
import { useGameGlobal } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';
import { PhaseHeader } from './PhaseHeader';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

export function Diluir({ state, updateState }: Props) {
  const [selectionError, setSelectionError] = useState('');
  const { gameId } = useGame();
  const { globalState } = useGameGlobal(gameId);
  const challenge = globalState?.challenge || state.challenge || '';
  const isLocked = globalState?.currentPhase && PHASES.indexOf(globalState.currentPhase) > PHASES.indexOf('Diluir');

  // Refs for perspective inputs to enable Enter→next focus
  const perspectiveRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handlePerspectiveChange = (index: number, value: string) => {
    const newPerspectives = [...state.perspectives];
    newPerspectives[index] = value;
    if (index === newPerspectives.length - 1 && value.trim() !== '') {
      newPerspectives.push('');
    }
    updateState({ perspectives: newPerspectives });
  };

  const handlePerspectiveKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextIndex = index + 1;
      // If there's no next line yet, create one
      if (nextIndex >= state.perspectives.length) {
        const newPerspectives = [...state.perspectives, ''];
        updateState({ perspectives: newPerspectives });
      }
      // Focus next input after state update
      setTimeout(() => {
        perspectiveRefs.current[nextIndex]?.focus();
      }, 50);
    }
  }, [state.perspectives, updateState]);

  const handleTop3Change = (index: number, value: string) => {
    const newTop3 = [...state.top3Perspectives] as [string, string, string];
    newTop3[index] = value;
    updateState({ top3Perspectives: newTop3 });
  };

  const selectForTop3 = (value: string) => {
    if (!value.trim()) return;
    const newTop3 = [...state.top3Perspectives] as [string, string, string];
    const emptyIndex = newTop3.findIndex(p => p.trim() === '');
    if (emptyIndex !== -1) {
      newTop3[emptyIndex] = value;
      updateState({ top3Perspectives: newTop3 });
    } else {
      setSelectionError('Ya has elegido 3 líneas. Borra una para poder seleccionar otra.');
      setTimeout(() => setSelectionError(''), 4000);
    }
  };

  const handleVoteChange = (index: number, value: string) => {
    const num = parseInt(value, 10) || 0;
    const newVotes = [...state.perspectiveVotes] as [number, number, number];
    newVotes[index] = num;
    updateState({ perspectiveVotes: newVotes });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
      
      <PhaseHeader
        phase="Diluir"
        subtitle="Disgregación del reto. Encuentra nuevas perspectivas."
      />

      <Card className="border-l-4 border-l-kreatum-purple">
        <CardHeader>
          <CardTitle>Reto a Trabajar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-light text-kreatum-dark/90 dark:text-white/90 font-serif leading-relaxed select-none">
            {challenge || <span className="text-kreatum-gray/40 italic text-base">El Alquimista aún no ha definido el reto.</span>}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nuevas perspectivas del reto</CardTitle>
          <p className="text-xs text-kreatum-purple font-medium mt-2 flex items-center gap-2">
            <span className="inline-flex items-center justify-center bg-kreatum-purple/10 text-kreatum-purple font-black text-[10px] px-2 py-0.5 rounded-lg uppercase tracking-wider">CP</span>
            Inicia cada idea con: <span className="font-bold italic">¿Cómo podríamos...?</span>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.perspectives.map((persp, idx) => (
            <div key={idx} className="group relative flex items-center gap-4">
              <span className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-2xl text-kreatum-gray/60 dark:text-white/80 font-mono text-sm border border-black/5 dark:border-white/5">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-kreatum-purple font-black text-xs select-none pointer-events-none z-10">CP</span>
                <Input 
                  ref={(el) => { perspectiveRefs.current[idx] = el; }}
                  value={persp}
                  onChange={(e) => handlePerspectiveChange(idx, e.target.value)}
                  onKeyDown={(e) => handlePerspectiveKeyDown(e, idx)}
                  placeholder="¿Cómo podríamos...?"
                  disabled={isLocked}
                  className="pl-12 pr-10"
                />
                {!isLocked && persp.trim() !== '' && (
                  <button
                    onClick={() => {
                      const newPerspectives = state.perspectives.filter((_, i) => i !== idx);
                      if (newPerspectives.length === 0) newPerspectives.push('');
                      updateState({ perspectives: newPerspectives });
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    title="Eliminar perspectiva"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button
                variant="outline"
                className="h-12 px-4 flex-shrink-0 cursor-pointer"
                onClick={() => selectForTop3(persp)}
                disabled={!persp.trim() || isLocked}
                title="Elegir para mis 3 líneas"
              >
                <ArrowDown className="w-4 h-4 mr-2" />
                Elegir
              </Button>
            </div>
          ))}
          {state.perspectives[state.perspectives.length - 1] === '' && state.perspectives.length > 1 && (
             <p className="text-xs text-kreatum-gray/50 dark:text-white/60 mt-4 ml-16 font-mono uppercase tracking-widest">Sigue escribiendo para añadir más líneas... (pulsa Enter para avanzar)</p>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Mis 3 Líneas Elegidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {selectionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm font-mono text-center mb-4">
                {selectionError}
              </div>
            )}
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.2em] text-kreatum-purple font-black">Línea de pensamiento {idx + 1}</label>
                <Input 
                  value={state.top3Perspectives[idx]}
                  onChange={(e) => handleTop3Change(idx, e.target.value)}
                  placeholder="Copia o adapta aquí la línea..."
                  disabled={isLocked}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-kreatum-purple/5 border-kreatum-purple/20">
          <CardHeader>
            <CardTitle>Votaciones y Decisión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8 flex flex-col">
            <div className="space-y-6 flex-1">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="flex items-center gap-6">
                  <div className="flex-1 truncate text-sm font-mono text-kreatum-gray/90 dark:text-white/80">
                    {state.top3Perspectives[idx] || <span className="text-kreatum-gray/50 dark:text-white/60 truncate">Línea {idx + 1} vacía</span>}
                  </div>
                  <div className="w-24">
                    <Input 
                      type="number" 
                      min="0"
                      value={state.perspectiveVotes[idx] || ''}
                      onChange={(e) => handleVoteChange(idx, e.target.value)}
                      placeholder="Votos"
                      disabled={isLocked}
                      className="text-center font-bold text-kreatum-purple text-lg placeholder:text-kreatum-gray/30 dark:placeholder:text-white/20"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-8 border-t border-black/10 dark:border-white/10 mt-auto">
              <label className="block text-[10px] uppercase tracking-[0.2em] text-kreatum-purple font-black mb-4">
                Línea Definitiva (Aprobada por el Alquimista)
              </label>
              <Input 
                value={state.selectedPerspective}
                onChange={(e) => updateState({ selectedPerspective: e.target.value })}
                placeholder="Escribe la línea con la que vamos a trabajar..."
                disabled={isLocked}
                className="border-kreatum-purple/40 dark:border-kreatum-purple/50 focus:ring-kreatum-purple bg-kreatum-purple/5 dark:bg-kreatum-purple/10"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
