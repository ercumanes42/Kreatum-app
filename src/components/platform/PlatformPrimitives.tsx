import type { HTMLAttributes } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export { formatPlatformDate } from '../../lib/platformPresentation';

const STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  pending: 'Pendiente',
  suspended: 'Suspendida',
  expired: 'Vencida',
  completed: 'Finalizada',
  archived: 'Archivada',
  queued: 'En cola',
  processing: 'Generando',
  failed: 'Fallida',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
};

export function PlatformStatusBadge({ status }: { status: string }) {
  const tone = {
    active: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
    completed: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
    pending: 'border-amber-500/20 bg-amber-500/10 text-amber-700',
    queued: 'border-sky-500/20 bg-sky-500/10 text-sky-700',
    processing: 'border-sky-500/20 bg-sky-500/10 text-sky-700',
    suspended: 'border-red-500/20 bg-red-500/10 text-red-700',
    expired: 'border-red-500/20 bg-red-500/10 text-red-700',
    failed: 'border-red-500/20 bg-red-500/10 text-red-700',
  }[status] ?? 'border-black/10 bg-black/[0.04] text-kreatum-gray/70';
  return (
    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-bold', tone)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PlatformPanel({ children, className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn(
      'premium-panel rounded-3xl',
      className,
    )} {...props}>
      {children}
    </section>
  );
}

export function PlatformEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 py-10 text-center">
      <div>
        <p className="font-bold text-kreatum-dark">{title}</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-kreatum-gray/75">{description}</p>
      </div>
    </div>
  );
}

export function PlatformLoading({ label = 'Cargando' }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-semibold text-kreatum-gray/75" role="status">
      <LoaderCircle className="h-5 w-5 animate-spin text-kreatum-purple" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PlatformError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-700" role="alert">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
