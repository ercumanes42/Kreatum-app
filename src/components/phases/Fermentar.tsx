import React from 'react';
import { GameState, PHASES } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Textarea } from '../ui/Textarea';
import { motion } from 'motion/react';
import { useGameGlobal } from '../../hooks/useRealtime';
import { useGame } from '../../contexts/GameContext';
import { PhaseHeader } from './PhaseHeader';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

export function Fermentar({ state, updateState }: Props) {
  const { gameId } = useGame();
  const { globalState } = useGameGlobal(gameId);
  const isLocked = globalState?.currentPhase && PHASES.indexOf(globalState.currentPhase) > PHASES.indexOf('Fermentar');
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
      <PhaseHeader
        phase="Fermentar"
        subtitle="Aterriza la solución. Dále forma para poder presentarla."
      />

      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>¿A quién se lo vamos a presentar?</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea 
              value={state.audience}
              onChange={(e) => updateState({ audience: e.target.value })}
              placeholder="Ej: Director de Experiencia de Cliente..."
              disabled={isLocked}
              className="min-h-[120px] focus:ring-kreatum-purple/50 focus:border-kreatum-purple/50"
            />
          </CardContent>
        </Card>

        <div className="space-y-8">
          <Card className="border-l-4 border-l-kreatum-green bg-kreatum-green/5">
            <CardHeader>
              <CardTitle>Fortalezas de la idea</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={state.strengths}
                onChange={(e) => updateState({ strengths: e.target.value })}
                placeholder="Las ventajas más grandes de nuestra propuesta..."
                disabled={isLocked}
                className="focus:ring-kreatum-green/50 focus:border-kreatum-green/50 hover:border-kreatum-green/30"
              />
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-kreatum-yellow bg-kreatum-yellow/5">
            <CardHeader>
              <CardTitle>Debilidades a explicar</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={state.weaknesses}
                onChange={(e) => updateState({ weaknesses: e.target.value })}
                placeholder="Riesgos o puntos débiles que debemos admitir y tener en cuenta..."
                disabled={isLocked}
                className="focus:ring-kreatum-yellow/50 focus:border-kreatum-yellow/50 hover:border-kreatum-yellow/30"
              />
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2 border-2 border-kreatum-blue/30">
          <CardHeader>
            <CardTitle>Prueba Piloto / Prototipo (Testeo)</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea 
              value={state.pilot}
              onChange={(e) => updateState({ pilot: e.target.value })}
              placeholder="¿Cómo lo probaríamos de manera ágil y barata? (Ej: en un sólo concesionario de Madrid durante 1 semana)"
              disabled={isLocked}
              className="min-h-[160px] focus:ring-kreatum-blue/50 focus:border-kreatum-blue/50 hover:border-kreatum-blue/30"
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recursos Necesarios</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea 
              value={state.resources}
              onChange={(e) => updateState({ resources: e.target.value })}
              placeholder="¿Qué y cuánto necesitamos para lanzar este prototipo? (Personas, dinero, permisos...)"
              disabled={isLocked}
              className="min-h-[160px] focus:ring-kreatum-purple/50 focus:border-kreatum-purple/50"
            />
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
