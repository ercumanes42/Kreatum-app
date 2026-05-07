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
    <div className="mb-14 flex flex-col md:flex-row md:items-center justify-between gap-8">
      <div className="flex items-center gap-8">
        {logo && (
          <div className="relative flex-shrink-0 group">
            {/* Intense Brand Glow */}
            <div className="absolute inset-0 rounded-full bg-kreatum-purple/20 blur-2xl scale-150 animate-pulse" />
            <img
              src={logo}
              alt={`Logo fase ${phase}`}
              className="relative w-24 h-24 object-contain transition-transform duration-700 group-hover:scale-110 drop-shadow-[0_0_15px_rgba(162,84,156,0.3)]"
            />
          </div>
        )}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="h-0.5 w-8 bg-kreatum-purple rounded-full" />
            <p className="text-[11px] font-mono font-black uppercase tracking-[0.4em] text-kreatum-purple opacity-90">
              Fase {number}
            </p>
          </div>
          <h2 className="text-6xl md:text-7xl font-black tracking-tighter text-kreatum-dark dark:text-white leading-[0.85] pt-1">
            {phase}
          </h2>
          <p className="text-sm font-mono text-kreatum-gray/60 dark:text-white/60 uppercase tracking-[0.2em] pt-2">
            {subtitle}
          </p>
        </div>
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>

  );
}
