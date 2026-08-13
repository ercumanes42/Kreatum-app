import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Download, FileText, RefreshCw, Search, Shield, UserRoundCog } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { getUserFacingError } from '../../lib/errors';
import { createIdempotencyKey } from '../../lib/workshopApi';
import {
  platformApi,
  type PlatformDocumentCursor,
  type PlatformFacilitator,
  type PlatformReportRecord,
  type PlatformWorkshop,
  type PlatformWorkshopData,
} from '../../lib/platformApi';
import {
  formatPlatformDate,
  PlatformEmptyState,
  PlatformError,
  PlatformLoading,
  PlatformPanel,
  PlatformStatusBadge,
} from './PlatformPrimitives';

const PAGE_SIZE = 25;

export function WorkshopDirectory() {
  const [workshops, setWorkshops] = useState<PlatformWorkshop[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cursor, setCursor] = useState<PlatformDocumentCursor | undefined>();
  const [nextCursor, setNextCursor] = useState<PlatformDocumentCursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<PlatformDocumentCursor | undefined>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedWorkshop, setSelectedWorkshop] = useState<PlatformWorkshop | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await platformApi.listWorkshops({
        organizationId: organizationFilter.trim() || undefined,
        search: search || undefined,
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        cursor,
      });
      setWorkshops(result.workshops);
      setNextCursor(result.hasMore ? result.nextCursor : null);
      setSelectedWorkshop((current) => (
        current && !result.workshops.some((item) => item.id === current.id)
          ? null
          : current
      ));
    } catch (loadError: unknown) {
      setError(getUserFacingError(loadError, 'No se pudieron cargar las partidas globales.'));
    } finally {
      setIsLoading(false);
    }
  }, [cursor, organizationFilter, search, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
    setCursor(undefined);
    setCursorHistory([]);
  };

  const resetPagination = (setter: () => void) => {
    setter();
    setCursor(undefined);
    setCursorHistory([]);
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-kreatum-purple">Supervisión global</p>
        <h2 className="mt-2 text-2xl font-extrabold text-kreatum-dark sm:text-3xl">Partidas e informes</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-kreatum-gray/75">
          Acceso exclusivo de GFS. Cada consulta de datos, asignación y operación de informe se ejecuta en servidor y queda auditada.
        </p>
      </div>

      <PlatformPanel className="p-4 sm:p-5">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(13rem,.65fr)_12rem_auto]">
          <label className="relative">
            <span className="sr-only">Buscar partidas</span>
            <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-kreatum-gray/40" aria-hidden="true" />
            <Input className="pl-11" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por empresa, facilitador o partida" />
          </label>
          <label>
            <span className="sr-only">Filtrar por referencia exacta de empresa</span>
            <Input value={organizationFilter} onChange={(event) => resetPagination(() => setOrganizationFilter(event.target.value))} placeholder="Referencia de empresa" />
          </label>
          <label>
            <span className="sr-only">Filtrar por estado</span>
            <select className="h-12 w-full rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-kreatum-dark focus:outline-none focus:ring-2 focus:ring-kreatum-purple/25" value={statusFilter} onChange={(event) => resetPagination(() => setStatusFilter(event.target.value))}>
              <option value="">Todos</option>
              <option value="active">Activas</option>
              <option value="completed">Finalizadas</option>
              <option value="archived">Archivadas</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
      </PlatformPanel>

      <PlatformPanel className="overflow-hidden">
        <PlatformError message={error} />
        {isLoading ? <PlatformLoading label="Cargando partidas" /> : workshops.length === 0 ? (
          <PlatformEmptyState title="Sin partidas" description="No hay resultados para los filtros actuales." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="border-b border-black/[0.06] bg-kreatum-bg-light text-xs uppercase tracking-[0.08em] text-kreatum-gray/75">
                <tr><th className="px-5 py-4">Partida</th><th className="px-5 py-4">Empresa</th><th className="px-5 py-4">Facilitador</th><th className="px-5 py-4">Estado</th><th className="px-5 py-4">Fecha</th><th className="px-5 py-4"><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {workshops.map((workshop) => (
                  <tr key={workshop.id} className="hover:bg-black/[0.02]">
                    <td className="max-w-60 px-5 py-4"><p className="truncate font-bold text-kreatum-dark">{workshop.client || 'Partida sin nombre'}</p></td>
                    <td className="px-5 py-4"><p className="font-semibold text-kreatum-dark">{workshop.organizationName || 'Empresa no disponible'}</p></td>
                    <td className="px-5 py-4"><p className="font-semibold text-kreatum-dark">{workshop.facilitator || 'Sin asignar'}</p></td>
                    <td className="px-5 py-4"><PlatformStatusBadge status={workshop.status} /></td>
                    <td className="whitespace-nowrap px-5 py-4 text-kreatum-gray/75">{formatPlatformDate(workshop.createdAt)}</td>
                    <td className="px-5 py-4 text-right"><Button size="sm" variant="outline" onClick={() => setSelectedWorkshop(workshop)}>Abrir</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-black/[0.06] p-4">
          <Button variant="ghost" size="sm" disabled={cursorHistory.length === 0} onClick={() => setCursorHistory((previous) => { const copy = [...previous]; setCursor(copy.pop()); return copy; })}>Anterior</Button>
          <span className="text-xs font-semibold text-kreatum-gray/75">Hasta {PAGE_SIZE} resultados por página</span>
          <Button variant="ghost" size="sm" disabled={!nextCursor} onClick={() => { if (!nextCursor) return; setCursorHistory((previous) => [...previous, cursor]); setCursor(nextCursor); }}>Siguiente</Button>
        </div>
      </PlatformPanel>

      {selectedWorkshop && (
        <WorkshopDetailPanel
          key={selectedWorkshop.id}
          workshop={selectedWorkshop}
          onClose={() => setSelectedWorkshop(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function WorkshopDetailPanel({ workshop, onClose, onChanged }: { workshop: PlatformWorkshop; onClose: () => void; onChanged: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [data, setData] = useState<PlatformWorkshopData | null>(null);
  const [facilitators, setFacilitators] = useState<PlatformFacilitator[]>([]);
  const [facilitatorUid, setFacilitatorUid] = useState(workshop.facilitatorUid ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reasonValid = reason.trim().length >= 5;

  const loadData = async () => {
    if (!reasonValid) {
      setError('Indica un motivo de al menos 5 caracteres para auditar el acceso global.');
      return;
    }
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const [workshopData, organization] = await Promise.all([
        platformApi.getWorkshopData({ organizationId: workshop.organizationId, workshopId: workshop.id, reason: reason.trim() }),
        platformApi.getOrganization({ organizationId: workshop.organizationId, activityLimit: 1 }),
      ]);
      setData(workshopData);
      setFacilitators(organization.facilitators.filter((item) => item.status === 'active'));
      setFacilitatorUid(workshopData.workshop.facilitatorUid ?? '');
    } catch (loadError: unknown) {
      setError(getUserFacingError(loadError, 'No se pudieron consultar los datos de esta partida.'));
    } finally {
      setIsLoading(false);
    }
  };

  const run = async (key: string, action: () => Promise<void>, message: string) => {
    if (!reasonValid) {
      setError('Indica un motivo de al menos 5 caracteres.');
      return;
    }
    setBusy(key);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
    } catch (operationError: unknown) {
      setError(getUserFacingError(operationError, 'No se pudo completar la operación global.'));
    } finally {
      setBusy('');
    }
  };

  const refreshData = async () => {
    const refreshed = await platformApi.getWorkshopData({ organizationId: workshop.organizationId, workshopId: workshop.id, reason: reason.trim() });
    setData(refreshed);
  };

  const assignFacilitator = () => run('assign', async () => {
    await platformApi.assignWorkshopFacilitator({
      organizationId: workshop.organizationId,
      workshopId: workshop.id,
      facilitatorUid,
      reason: reason.trim(),
      idempotencyKey: createIdempotencyKey('assignWorkshopFacilitator'),
    });
    await Promise.all([refreshData(), onChanged()]);
  }, 'Facilitador asignado y operación auditada.');

  const generateReport = () => run('report', async () => {
    const snapshot = await platformApi.generateReportSnapshot({
      organizationId: workshop.organizationId,
      workshopId: workshop.id,
      reason: reason.trim(),
      idempotencyKey: createIdempotencyKey('generatePlatformReportSnapshot'),
    });
    const job = await platformApi.queueReportGeneration({
      organizationId: workshop.organizationId,
      workshopId: workshop.id,
      reportId: snapshot.reportId,
      reason: reason.trim(),
      idempotencyKey: createIdempotencyKey('queuePlatformReportGeneration'),
    });
    let latest = job;
    for (let attempt = 0; attempt < 20 && ['queued', 'processing'].includes(latest.status); attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
      latest = await platformApi.getReportJob({ organizationId: workshop.organizationId, workshopId: workshop.id, jobId: job.jobId });
    }
    if (latest.status === 'failed') throw new Error('La generación del informe ha fallado.');
    await refreshData();
  }, 'Informe generado y disponible para descarga.');

  const downloadReport = (report: PlatformReportRecord, format: 'pdf' | 'pptx' | 'json') => run(`download-${report.id}-${format}`, async () => {
    const result = await platformApi.createReportDownload({
      organizationId: workshop.organizationId,
      workshopId: workshop.id,
      reportId: report.id,
      format,
      reason: reason.trim(),
      idempotencyKey: createIdempotencyKey('createPlatformReportDownload'),
    });
    window.location.assign(result.url);
  }, 'Descarga autorizada.');

  return (
    <PlatformPanel className="overflow-hidden" aria-label={`Detalle de ${workshop.client || 'partida sin nombre'}`}>
      <div className="flex flex-col gap-4 border-b border-black/[0.06] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-kreatum-purple">Partida global</p>
          <h3 className="mt-2 truncate text-2xl font-extrabold text-kreatum-dark">{workshop.client || 'Partida sin nombre'}</h3>
          <p className="mt-1 text-sm text-kreatum-gray/75">{workshop.organizationName || 'Empresa no disponible'} · {formatPlatformDate(workshop.createdAt)}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>Cerrar detalle</Button>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex gap-3 rounded-2xl border border-sky-500/15 bg-sky-500/[0.06] p-4 text-sm leading-6 text-sky-900">
          <Shield className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
          <p>La empresa y la partida se envían juntas en cada operación; el servidor vuelve a resolver su pertenencia antes de devolver datos.</p>
        </div>
        <label className="block text-sm font-bold text-kreatum-dark" htmlFor="platform-global-access-reason">
          Motivo del acceso global
          <Textarea id="platform-global-access-reason" aria-describedby="platform-global-access-reason-help" className="mt-2 min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Soporte solicitado por la empresa" />
          <span id="platform-global-access-reason-help" className="mt-2 block text-xs font-medium leading-5 text-kreatum-gray/75">No incluyas datos personales, códigos de sala, contraseñas ni secretos.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void loadData()} disabled={isLoading || !reasonValid}>{isLoading ? 'Consultando…' : 'Consultar datos e informes'}</Button>
          {data && <Button variant="outline" onClick={() => void loadData()} disabled={isLoading}><RefreshCw className="h-4 w-4" />Actualizar</Button>}
        </div>
        <PlatformError message={error} />
        {success && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700" role="status">{success}</p>}

        {isLoading ? <PlatformLoading label="Consultando datos auditados" /> : data && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Empresa', data.workshop.organizationName || 'Empresa no disponible'],
                ['Estado', data.workshop.status],
                ['Fase actual', data.workshop.currentPhase || '—'],
                ['Facilitador', data.workshop.facilitator || 'Sin asignar'],
              ].map(([label, value]) => <div key={label} className="rounded-2xl bg-kreatum-bg-light p-4"><p className="text-xs font-bold text-kreatum-gray/75">{label}</p><p className="mt-2 break-words font-extrabold text-kreatum-dark">{value}</p></div>)}
            </div>

            <div className="rounded-2xl border border-black/[0.07] p-4">
              <div className="flex items-center gap-2"><UserRoundCog className="h-5 w-5 text-kreatum-purple" /><h4 className="font-extrabold text-kreatum-dark">Asignar facilitador</h4></div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <select className="h-12 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-kreatum-dark focus:outline-none focus:ring-2 focus:ring-kreatum-purple/25" value={facilitatorUid} onChange={(event) => setFacilitatorUid(event.target.value)} aria-label="Facilitador asignado">
                  <option value="">Selecciona un facilitador</option>
                  {facilitators.map((facilitator) => <option key={facilitator.uid} value={facilitator.uid}>{facilitator.displayName || facilitator.maskedEmail || 'Facilitador sin nombre'}</option>)}
                </select>
                <Button variant="outline" disabled={!facilitatorUid || busy !== '' || !reasonValid} onClick={assignFacilitator}>{busy === 'assign' ? 'Asignando…' : 'Guardar asignación'}</Button>
              </div>
            </div>

            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h4 className="font-extrabold text-kreatum-dark">Datos que alimentan el informe</h4><p className="mt-1 text-xs text-kreatum-gray/75">Instantánea canónica devuelta por el backend para esta partida.</p></div>
                <Button disabled={busy !== '' || !reasonValid} onClick={generateReport}><FileText className="h-4 w-4" />{busy === 'report' ? 'Generando…' : 'Generar o regenerar informe'}</Button>
              </div>
              <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-[#102F40] p-4 font-mono text-xs leading-6 text-white/85" tabIndex={0}>{JSON.stringify(data.dataset, null, 2)}</pre>
            </div>

            <div>
              <h4 className="font-extrabold text-kreatum-dark">Informes</h4>
              {data.reports.length === 0 ? <p className="mt-2 text-sm text-kreatum-gray/75">Todavía no hay informes generados.</p> : (
                <ul className="mt-3 divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06]">
                  {data.reports.map((report) => (
                    <li key={report.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-kreatum-dark">{report.version ? `Informe v${report.version}` : 'Informe generado'}</p><PlatformStatusBadge status={report.status} /></div><p className="mt-1 text-xs text-kreatum-gray/75">{formatPlatformDate(report.generatedAt, true)}</p></div>
                      <div className="flex flex-wrap gap-2">
                        {(['pdf', 'pptx', 'json'] as const).map((format) => <Button key={format} size="sm" variant="outline" disabled={busy !== '' || !reasonValid} onClick={() => downloadReport(report, format)}><Download className="h-4 w-4" />{format.toUpperCase()}</Button>)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </PlatformPanel>
  );
}
