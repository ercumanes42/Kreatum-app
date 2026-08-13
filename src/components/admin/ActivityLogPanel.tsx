import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, ChevronLeft, ChevronRight, Download, RefreshCw, Search, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import {
  AUDIT_PERIOD_DAYS,
  type AuditCursor,
  type AuditEventSummary,
  type AuditPeriodDays,
  type AuditTargetType,
  type GetOrganizationAuditOverviewOutput,
  type OrganizationAuditFilters,
} from '../../../shared/contracts';
import { DEFAULT_AUDIT_PERIOD_DAYS, MAX_AUDIT_EXPORT_EVENTS } from '../../../shared/audit';
import {
  auditActorLabel,
  auditTargetContextLabel,
  formatAdminActivityAction,
  formatAuditState,
  groupConsecutiveAdminActivity,
  isAuditStateNoOp,
  maskAuditEmail,
  visibleAuditActors,
} from '../../lib/activityPresentation';
import { downloadAuditCsv } from '../../lib/auditCsv';
import { defaultOrganizationId } from '../../lib/dataModel';
import { getUserFacingError } from '../../lib/errors';
import { workshopApi } from '../../lib/workshopApi';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

const TARGET_LABELS: Record<AuditTargetType, string> = {
  workshop: 'Partida',
  member: 'Cuenta',
  invitation: 'Invitación',
  report: 'Informe',
  organization: 'Organización',
};

const dateLabel = (value: number | null) => value
  ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'medium' }).format(value)
  : 'Fecha no disponible';

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 200;
const EMPTY_OVERVIEW: GetOrganizationAuditOverviewOutput = {
  metrics: { totalEvents: 0, uniqueActors: 0, workshopsAffected: 0, accessOperations: 0 },
  daily: [],
  actors: [],
  actions: [],
  scannedCount: 0,
  truncated: false,
};
const defaultFilters = (): OrganizationAuditFilters => ({ periodDays: DEFAULT_AUDIT_PERIOD_DAYS });
const filterSelectClass = 'mt-2 h-12 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-medium text-kreatum-dark outline-none transition-colors focus:border-kreatum-purple focus:ring-2 focus:ring-kreatum-purple/25 dark:border-white/10 dark:bg-kreatum-bg-dark dark:text-white';

export function ActivityLogPanel() {
  const [events, setEvents] = useState<AuditEventSummary[]>([]);
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [draftFilters, setDraftFilters] = useState<OrganizationAuditFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<OrganizationAuditFilters>(defaultFilters);
  const [pageCursors, setPageCursors] = useState<Array<AuditCursor | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<AuditCursor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (
    filters: OrganizationAuditFilters,
    cursor: AuditCursor | null = null,
    refreshOverview = true,
  ) => {
    setIsLoading(true);
    setError('');
    setNotice('');
    try {
      if (!defaultOrganizationId) throw new Error('Falta configurar la organización predeterminada.');
      const [listResult, overviewResult] = await Promise.all([
        workshopApi.listOrganizationAudit({ organizationId: defaultOrganizationId, limit: PAGE_SIZE, cursor, filters }),
        refreshOverview
          ? workshopApi.getOrganizationAuditOverview({ organizationId: defaultOrganizationId, filters })
          : Promise.resolve(null),
      ]);
      setEvents(listResult.events);
      setHasMore(listResult.hasMore);
      setNextCursor(listResult.nextCursor);
      if (overviewResult) setOverview(overviewResult);
    } catch (loadError: unknown) {
      setError(getUserFacingError(loadError, 'No se pudo cargar el registro de actividad.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(defaultFilters()); }, [load]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const filters = { ...draftFilters, search: draftFilters.search?.trim() || undefined };
    setAppliedFilters(filters);
    setPageCursors([null]);
    setPageIndex(0);
    void load(filters);
  };

  const clearFilters = () => {
    const filters = defaultFilters();
    setDraftFilters(filters);
    setAppliedFilters(filters);
    setPageCursors([null]);
    setPageIndex(0);
    void load(filters);
  };

  const refresh = () => {
    setPageCursors([null]);
    setPageIndex(0);
    void load(appliedFilters);
  };

  const goNext = () => {
    if (!nextCursor || !hasMore) return;
    const nextIndex = pageIndex + 1;
    setPageCursors((current) => [...current.slice(0, nextIndex), nextCursor]);
    setPageIndex(nextIndex);
    void load(appliedFilters, nextCursor, false);
  };

  const goPrevious = () => {
    if (pageIndex === 0) return;
    const previousIndex = pageIndex - 1;
    setPageIndex(previousIndex);
    void load(appliedFilters, pageCursors[previousIndex] ?? null, false);
  };

  const exportCsv = async () => {
    setIsExporting(true);
    setError('');
    setNotice('');
    try {
      if (!defaultOrganizationId) throw new Error('Falta configurar la organización predeterminada.');
      const exportEvents: AuditEventSummary[] = [];
      let cursor: AuditCursor | null = null;
      let hasAnotherPage = true;
      while (hasAnotherPage && exportEvents.length < MAX_AUDIT_EXPORT_EVENTS) {
        const result = await workshopApi.listOrganizationAudit({
          organizationId: defaultOrganizationId,
          limit: Math.min(EXPORT_PAGE_SIZE, MAX_AUDIT_EXPORT_EVENTS - exportEvents.length),
          cursor,
          filters: appliedFilters,
        });
        exportEvents.push(...result.events);
        cursor = result.nextCursor;
        hasAnotherPage = result.hasMore && Boolean(cursor);
      }
      if (hasAnotherPage) {
        setNotice('Hay más de 10.000 resultados. Acota los filtros antes de exportar.');
      } else if (exportEvents.length === 0) {
        setNotice('No hay resultados que exportar.');
      } else {
        downloadAuditCsv(exportEvents, `kreatum-actividad-${new Date().toISOString().slice(0, 10)}.csv`);
        setNotice(`${exportEvents.length.toLocaleString('es-ES')} eventos exportados.`);
      }
    } catch (exportError: unknown) {
      setError(getUserFacingError(exportError, 'No se pudo exportar la actividad.'));
    } finally {
      setIsExporting(false);
    }
  };

  const maximumDaily = Math.max(1, ...overview.daily.map((item) => item.count));
  const hasActiveFilters = Boolean(
    appliedFilters.actorEmail || appliedFilters.action || appliedFilters.targetType || appliedFilters.search,
  );
  const metricCards: Array<{ label: string; value: number; Icon: LucideIcon }> = [
    { label: 'Acciones totales', value: overview.metrics.totalEvents, Icon: Activity },
    { label: 'Actores registrados', value: overview.metrics.uniqueActors, Icon: Users },
    { label: 'Partidas afectadas', value: overview.metrics.workshopsAffected, Icon: BarChart3 },
    { label: 'Operaciones de acceso', value: overview.metrics.accessOperations, Icon: ShieldCheck },
  ];

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6" aria-labelledby="activity-title">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.22em] text-kreatum-purple">Trazabilidad</p>
          <h2 id="activity-title" className="text-3xl font-extrabold text-kreatum-dark dark:text-white">Registro de actividad</h2>
          <p className="mt-2 max-w-2xl text-sm text-kreatum-gray dark:text-white/80">Acciones administrativas, sin respuestas ni datos de participantes.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={() => void exportCsv()} disabled={isLoading || isExporting} className="w-full rounded-xl sm:w-auto">
            <Download className="h-4 w-4" />{isExporting ? 'Exportando…' : 'Exportar CSV'}
          </Button>
          <Button variant="outline" onClick={refresh} disabled={isLoading} className="w-full rounded-xl sm:w-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />Actualizar
          </Button>
        </div>
      </div>

      <div className="mb-6 flex gap-3 rounded-2xl border border-kreatum-purple/15 bg-kreatum-purple/5 p-4 text-sm text-kreatum-dark dark:text-white">
        <ShieldCheck className="h-5 w-5 shrink-0 text-kreatum-purple" aria-hidden="true" />
        <p>Solo los administradores pueden consultar este registro; los eventos se crean desde el backend.</p>
      </div>

      <form onSubmit={applyFilters} className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.04] sm:p-5" aria-label="Filtros de actividad">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-semibold">Periodo
            <select value={draftFilters.periodDays ?? DEFAULT_AUDIT_PERIOD_DAYS} onChange={(event) => setDraftFilters((current) => ({ ...current, periodDays: Number(event.target.value) as AuditPeriodDays }))} className={filterSelectClass}>
              {AUDIT_PERIOD_DAYS.map((days) => <option key={days} value={days}>Últimos {days} días</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Persona
            <select value={draftFilters.actorEmail ?? ''} onChange={(event) => setDraftFilters((current) => ({ ...current, actorEmail: event.target.value || undefined }))} className={filterSelectClass}>
              <option value="">Todas</option>
              {visibleAuditActors(overview.actors).map((actor) => <option key={actor.email} value={actor.email}>{actor.name || maskAuditEmail(actor.email) || 'Persona registrada'}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Acción
            <select value={draftFilters.action ?? ''} onChange={(event) => setDraftFilters((current) => ({ ...current, action: event.target.value || undefined }))} className={filterSelectClass}>
              <option value="">Todas</option>
              {overview.actions.map((action) => <option key={action} value={action}>{formatAdminActivityAction(action)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Objetivo
            <select value={draftFilters.targetType ?? ''} onChange={(event) => setDraftFilters((current) => ({ ...current, targetType: (event.target.value || undefined) as AuditTargetType | undefined }))} className={filterSelectClass}>
              <option value="">Todos</option>
              {Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold sm:col-span-2 lg:col-span-1">Buscar
            <span className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-kreatum-gray" aria-hidden="true" />
              <Input value={draftFilters.search ?? ''} onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Persona, acción o motivo" className="pl-10" />
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={clearFilters} disabled={isLoading} className="w-full sm:w-auto">Limpiar filtros</Button>
          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">Aplicar filtros</Button>
        </div>
      </form>

      {error && <div className="mb-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300" role="alert">{error}</div>}
      {notice && <div className="mb-6 rounded-xl bg-kreatum-purple/10 px-4 py-3 text-sm font-semibold text-kreatum-dark dark:text-white" role="status">{notice}</div>}
      {overview.truncated && <div className="mb-6 rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-200" role="status">Las métricas alcanzaron el límite de 20.000 eventos; acota los filtros para obtener el total exacto.</div>}

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen de actividad">
        {metricCards.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <Icon className="h-5 w-5 text-kreatum-purple" aria-hidden="true" />
            <p className="mt-3 text-2xl font-extrabold text-kreatum-dark dark:text-white">{Number(value).toLocaleString('es-ES')}</p>
            <p className="mt-1 text-sm text-kreatum-gray dark:text-white/75">{label}</p>
          </div>
        ))}
      </section>

      <section className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.04] sm:p-5" aria-label="Tendencia diaria de actividad">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-bold">Tendencia diaria</h3>
          <span className="text-xs text-kreatum-gray">Últimos {appliedFilters.periodDays ?? DEFAULT_AUDIT_PERIOD_DAYS} días</span>
        </div>
        <div className="flex h-28 items-end gap-1 overflow-hidden" role="img" aria-label="Tendencia diaria de actividad">
          {overview.daily.map((item) => (
            <div key={item.date} className="flex h-full min-w-0 flex-1 items-end" title={`${item.date}: ${item.count}`}>
              <span className="block w-full rounded-t bg-kreatum-purple/75" style={{ height: `${Math.max(item.count ? 8 : 2, (item.count / maximumDaily) * 100)}%` }} />
            </div>
          ))}
        </div>
        <p className="sr-only">{overview.daily.map((item) => `${item.date}: ${item.count}`).join('; ')}</p>
      </section>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-white/[0.04]">
        {isLoading && events.length === 0 ? (
          <p className="p-10 text-center text-sm text-kreatum-gray dark:text-white/80" role="status">Cargando actividad…</p>
        ) : events.length === 0 ? (
          <div className="p-10 text-center">
            <Activity className="mx-auto h-8 w-8 text-kreatum-purple" aria-hidden="true" />
            <p className="mt-3 text-sm text-kreatum-gray dark:text-white/80">{hasActiveFilters ? 'No hay resultados con los filtros aplicados.' : 'Aún no hay actividad registrada.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Tabla de actividad" tabIndex={0}>
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-black/[0.025] text-xs uppercase tracking-wider text-kreatum-gray dark:bg-white/[0.03] dark:text-white/80">
                <tr><th className="px-5 py-4">Fecha y hora</th><th className="px-5 py-4">Persona</th><th className="px-5 py-4">Acción</th><th className="px-5 py-4">Objetivo</th><th className="px-5 py-4">Antes → después</th><th className="px-5 py-4">Motivo</th></tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {groupConsecutiveAdminActivity(events).map((group) => {
                  const event = group.items[0];
                  const isRepeatedRead = group.isReadGroup && group.items.length > 1;
                  const actorLabel = auditActorLabel(event);
                  return (
                    <tr key={group.key} className="align-top hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-5 py-4 font-medium">
                        {dateLabel(event.createdAt)}
                        {isRepeatedRead && (
                          <details className="mt-2 whitespace-normal text-xs text-kreatum-gray dark:text-white/80">
                            <summary className="cursor-pointer font-semibold text-kreatum-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/30">{group.items.length} consultas agrupadas</summary>
                            <ol className="mt-2 space-y-1 border-l border-kreatum-purple/20 pl-2">
                              {group.items.map((item) => <li key={item.id}>{dateLabel(item.createdAt)}</li>)}
                            </ol>
                          </details>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className="block font-bold text-kreatum-dark dark:text-white">{actorLabel}</span>
                        {actorLabel !== 'Sistema' && event.actorEmail && <span className="mt-1 block text-xs text-kreatum-gray dark:text-white/80">{maskAuditEmail(event.actorEmail)}</span>}
                      </td>
                      <td className="px-5 py-4 font-semibold">{formatAdminActivityAction(event.action)}</td>
                      <td className="px-5 py-4"><span className="block font-semibold">{TARGET_LABELS[event.targetType]}</span><span className="mt-1 block text-xs text-kreatum-gray dark:text-white/80">{auditTargetContextLabel(event.targetType)}</span></td>
                      <td className="max-w-64 px-5 py-4 text-xs leading-5">{isAuditStateNoOp(event) ? <span aria-label="Sin cambios">—</span> : <><span className="text-kreatum-gray dark:text-white/80">{formatAuditState(event.previousState)}</span><span className="mx-2 text-kreatum-purple">→</span><span className="font-semibold">{formatAuditState(event.newState)}</span></>}</td>
                      <td className="max-w-64 px-5 py-4 text-xs leading-5">{event.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Paginación de actividad">
        <Button variant="outline" onClick={goPrevious} disabled={isLoading || pageIndex === 0} className="min-h-11 px-4"><ChevronLeft className="h-4 w-4" />Anterior</Button>
        <span className="text-sm font-semibold text-kreatum-gray dark:text-white/75">Página {pageIndex + 1}</span>
        <Button variant="outline" onClick={goNext} disabled={isLoading || !hasMore || !nextCursor} className="min-h-11 px-4">Siguiente<ChevronRight className="h-4 w-4" /></Button>
      </nav>
    </section>
  );
}
