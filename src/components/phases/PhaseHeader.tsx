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
    <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-5">
        {logo && (
          <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-black/[0.06] bg-white shadow-[0_14px_28px_-24px_rgba(16,47,64,0.65)] dark:border-white/[0.08] dark:bg-white/[0.05]">
            <img
              src={logo}
              alt={`Logo fase ${phase}`}
              className="h-11 w-11 object-contain"
            />
          </div>
        )}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-kreatum-purple" />
            <p className="text-xs font-bold text-kreatum-purple">
              Fase {number}
            </p>
          </div>
          <h2 className="text-4xl font-extrabold leading-tight text-kreatum-dark dark:text-white md:text-5xl">
            {phase}
          </h2>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-kreatum-gray/65 dark:text-white/60">
            {subtitle}
          </p>
        </div>
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>

  );
}
