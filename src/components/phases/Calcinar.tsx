import React from 'react';
import { Card, CardContent } from '../ui/Card';
import { BrainCircuit } from 'lucide-react';
import { motion } from 'motion/react';

export function Calcinar() {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-2xl mx-auto"
    >
      <div className="text-center mb-16">
        <div className="w-24 h-24 bg-kreatum-orange/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-kreatum-orange/20 shadow-[0_0_20px_rgba(238,111,56,0.1)] dark:shadow-[0_0_30px_rgba(238,111,56,0.2)]">
          <BrainCircuit className="w-12 h-12 text-kreatum-orange" />
        </div>
        <h1 className="text-5xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif mb-6">Fase 1: Calcinar</h1>
        <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/80 uppercase tracking-widest leading-relaxed">
          Calentando el cerebro. Prepárate para los juegos de pensamiento lateral proyectados en pantalla.
        </p>
      </div>

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
