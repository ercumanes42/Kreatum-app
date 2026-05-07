import React from 'react';
import { Card, CardContent } from '../ui/Card';
import { motion } from 'motion/react';
import { PhaseHeader } from './PhaseHeader';

export function Calcinar() {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-2xl mx-auto"
    >
      <PhaseHeader
        phase="Calcinar"
        subtitle="Calentando el cerebro. Prepárate para los juegos de pensamiento lateral."
      />

      <Card className="bg-kreatum-orange/5 border-kreatum-orange/20">
        <CardContent className="p-10 text-center text-kreatum-orange font-mono text-sm leading-loose">
          Presta atención al Alquimista y a la pantalla central.
          <br/>
          <span className="opacity-50">(Esta fase se realiza fuera de la plataforma digital)</span>
        </CardContent>
      </Card>
    </motion.div>
  );
}
