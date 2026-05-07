import React from 'react';
import { Phase } from '../../types';

const PHASE_LOGOS: Partial<Record<Phase, string>> = {
  Calcinar:  '/assets/logos/fases/calcinar.png',
  Diluir:    '/assets/logos/fases/diluir.png',
  Conjugar:  '/assets/logos/fases/conjugar.png',
  Sublimar:  '/assets/logos/fases/sublimar.png',
  Fermentar: '/assets/logos/fases/fermentar.png',
  Proyectar: '/assets/logos/fases/proyectar.png',
};

const PHASE_NUMBERS: Partial<Record<Phase, number>> = {
  Calcinar:  1,
  Diluir:    2,
  Conjugar:  3,
  Sublimar:  4,
  Fermentar: 5,
  Proyectar: 6,
};

interface PhaseHeaderProps {
  phase: Phase;
  subtitle: string;
  /** Optional extra content rendered to the right (e.g. action buttons) */
  children?: React.ReactNode;
}

export function PhaseHeader({ phase, subtitle, children }: PhaseHeaderProps) {
  const logo = PHASE_LOGOS[phase];
  const number = PHASE_NUMBERS[phase];

  return (
    <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div className="flex items-center gap-6">
        {logo && (
          <div className="relative flex-shrink-0">
            {/* Subtle glow ring */}
            <div className="absolute inset-0 rounded-full bg-kreatum-purple/10 blur-xl scale-110" />
            <img
              src={logo}
              alt={`Logo fase ${phase}`}
              className="relative w-20 h-20 object-contain drop-shadow-lg"
            />
          </div>
        )}
        <div>
          <p className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-kreatum-purple mb-1 opacity-70">
            Fase {number}
          </p>
          <h2 className="text-5xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif leading-none">
            {phase}
          </h2>
          <p className="text-sm font-mono text-kreatum-gray/70 dark:text-white/80 uppercase tracking-widest mt-3">
            {subtitle}
          </p>
        </div>
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}
