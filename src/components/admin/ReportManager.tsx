import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  type DocumentData,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Presentation,
  RefreshCw,
  Send,
} from 'lucide-react';
import type {
  OrganizationRole,
  ReportArtifact,
  ReportJobStatus,
  ReportRecord,
  ReportStatus,
} from '../../../shared/contracts';
import { auth, db } from '../../lib/firebase';
import { defaultOrganizationId, workshopCollectionName } from '../../lib/dataModel';
import { reportClientError } from '../../lib/clientLogger';
import { downloadProtectedReport } from '../../lib/reportDownloads';
import { createIdempotencyKey, workshopApi } from '../../lib/workshopApi';
import { getUserFacingError } from '../../lib/errors';
import {
  canRetryReportArtifacts,
  getReportStatusLabel,
  hasCompleteReportArtifacts,
} from '../../lib/reportPresentation';
import { cn } from '../../lib/utils';
import { ActionDialog } from '../ui/ActionDialog';
import { Button } from '../ui/Button';

interface ReportManagerProps {
  workshopId: string;
  roomCode: string;
}

interface ReportView extends ReportRecord {
  createdAt?: number;
  artifactGeneratedAt?: number;
  failureCode?: string;
}

const toMillis = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const candidate = value as { toMillis?: unknown };
    if (typeof candidate.toMillis === 'function') {
      const result = candidate.toMillis();
      return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
    }
  }
  return undefined;
};

const parseArtifact = (value: unknown): ReportArtifact | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.storagePath !== 'string'
    || typeof artifact.sha256 !== 'string'
    || typeof artifact.size !== 'number'
    || typeof artifact.mimeType !== 'string'
    || typeof artifact.generatedAt !== 'number'
    || typeof artifact.templateVersion !== 'string') return undefined;
  return artifact as unknown as ReportArtifact;
};

const parseReport = (id: string, data: DocumentData): ReportView => ({
  id,
  workshopId: String(data.workshopId || ''),
  organizationId: String(data.organizationId || ''),
  templateVersion: String(data.templateVersion || ''),
  sourceSchemaVersion: Number(data.sourceSchemaVersion || 0),
  sourceSnapshotHash: String(data.sourceSnapshotHash || ''),
  storagePath: String(data.storagePath || ''),
  status: String(data.status || 'failed') as ReportStatus,
  pageCount: typeof data.pageCount === 'number' ? data.pageCount : undefined,
  generatedAt: toMillis(data.generatedAt),
  publishedAt: toMillis(data.publishedAt),
  createdAt: toMillis(data.createdAt),
  artifactGeneratedAt: toMillis(data.artifactGeneratedAt),
  failureCode: typeof data.failureCode === 'string' ? data.failureCode : undefined,
  editorial: data.editorial && typeof data.editorial === 'object'
    ? {
      executiveSummary: String(data.editorial.executiveSummary || ''),
      observations: String(data.editorial.observations || ''),
      nextSteps: String(data.editorial.nextSteps || ''),
    }
    : undefined,
  artifacts: data.artifacts && typeof data.artifacts === 'object'
    ? {
      pdf: parseArtifact(data.artifacts.pdf),
      pptx: parseArtifact(data.artifacts.pptx),
      json: parseArtifact(data.artifacts.json),
    }
    : undefined,
});

const STATUS_STYLES: Record<ReportStatus, string> = {
  queued: 'bg-slate-500/10 text-slate-600',
  generating: 'bg-amber-500/10 text-amber-700',
  draft: 'bg-kreatum-purple/10 text-kreatum-purple',
  published: 'bg-green-500/10 text-green-700',
  failed: 'bg-red-500/10 text-red-700',
};

const formatDate = (value?: number) => value
  ? new Date(value).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : 'Pendiente';

const formatBytes = (value?: number) => {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export function ReportManager({ workshopId, roomCode }: ReportManagerProps) {
  const [reports, setReports] = useState<ReportView[]>([]);
  const [role, setRole] = useState<OrganizationRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [publishCandidate, setPublishCandidate] = useState<ReportView | null>(null);
  const [activeJobId, setActiveJobId] = useState('');
  const [jobStatus, setJobStatus] = useState<ReportJobStatus | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [executiveSummary, setExecutiveSummary] = useState('');
  const [observations, setObservations] = useState('');
  const [nextSteps, setNextSteps] = useState('');

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user || !defaultOrganizationId) throw new Error('No hay una organización autenticada.');
      const membershipSnapshot = await getDoc(doc(
        db,
        'organizations',
        defaultOrganizationId,
        'members',
        user.uid,
      ));
      const membershipRole = membershipSnapshot.data()?.role;
      if (!['owner', 'facilitator'].includes(String(membershipRole))) {
        throw new Error('Tu membresía no permite consultar informes.');
      }
      const currentRole = membershipRole as OrganizationRole;
      setRole(currentRole);
      const workshopSnapshot = await getDoc(doc(db, workshopCollectionName, workshopId));
      const workshopData = workshopSnapshot.data();
      const storedJobId = typeof workshopData?.activeReportJobId === 'string'
        ? workshopData.activeReportJobId
        : '';
      const storedJobStatus = workshopData?.activeReportJobStatus;
      if (storedJobId && ['queued', 'processing'].includes(String(storedJobStatus))) {
        setActiveJobId(storedJobId);
        setJobStatus(storedJobStatus as ReportJobStatus);
      }
      const reportsReference = collection(db, workshopCollectionName, workshopId, 'reports');
      const reportsQuery = query(reportsReference);
      const snapshot = await getDocs(reportsQuery);
      const parsed = snapshot.docs
        .map((item) => parseReport(item.id, item.data()))
        .sort((left, right) => (right.createdAt || right.generatedAt || 0) - (left.createdAt || left.generatedAt || 0));
      setReports(parsed);
    } catch (loadError: unknown) {
      setError(getUserFacingError(loadError, 'No se pudieron cargar los informes.'));
    } finally {
      setIsLoading(false);
    }
  }, [workshopId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!activeJobId) return undefined;
    let cancelled = false;
    let timerId = 0;

    const pollJob = async () => {
      try {
        const job = await workshopApi.getReportJob({ workshopId, jobId: activeJobId });
        if (cancelled) return;
        setJobStatus(job.status);
        setJobProgress(job.progress);
        if (job.status === 'queued') {
          setProgress('Informe en cola. Puedes cerrar esta pantalla.');
        } else if (job.status === 'processing') {
          setProgress('Generando PDF y PowerPoint en segundo plano.');
        } else if (job.status === 'completed') {
          setProgress('');
          setJobProgress(null);
          setActiveJobId('');
          setNotice('Informe generado correctamente.');
          await loadReports();
          return;
        } else if (job.status === 'failed') {
          setProgress('');
          setJobProgress(null);
          setActiveJobId('');
          setError('El informe no pudo generarse. Puedes reintentarlo sin duplicar la versión.');
          await loadReports();
          return;
        }
      } catch (pollError: unknown) {
        if (!cancelled) {
          setProgress('Recuperando el estado del informe.');
          reportClientError('Report job polling failed', pollError);
        }
      }
      if (!cancelled) timerId = window.setTimeout(() => void pollJob(), 3_000);
    };

    void pollJob();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [activeJobId, loadReports, workshopId]);

  const generateVersion = async () => {
    setBusyAction('generate');
    setError('');
    setNotice('');
    try {
      setProgress('Creando snapshot autorizado…');
      const snapshot = await workshopApi.generateReportSnapshot({
        workshopId,
        idempotencyKey: createIdempotencyKey('generateReportSnapshot'),
      });
      if (executiveSummary.trim() || observations.trim() || nextSteps.trim()) {
        setProgress('Guardando anexo editorial…');
        await workshopApi.updateReportEditorial({
          workshopId,
          reportId: snapshot.reportId,
          executiveSummary,
          observations,
          nextSteps,
          idempotencyKey: createIdempotencyKey('updateReportEditorial'),
        });
      }
      setProgress('Encolando generación segura…');
      const job = await workshopApi.queueReportGeneration({
        workshopId,
        reportId: snapshot.reportId,
        idempotencyKey: createIdempotencyKey('queueReportGeneration'),
      });
      setActiveJobId(job.jobId);
      setJobStatus(job.status);
      setJobProgress(0);
      setNotice('Informe en cola. Puedes cerrar esta pantalla y volver después.');
      setExecutiveSummary('');
      setObservations('');
      setNextSteps('');
    } catch (generationError: unknown) {
      setProgress('');
      setError(getUserFacingError(generationError, 'No se pudo generar el informe.'));
    } finally {
      setBusyAction('');
      await loadReports();
    }
  };

  const retryReport = async (report: ReportView) => {
    setBusyAction(`retry:${report.id}`);
    setError('');
    setNotice('');
    try {
      setProgress('Encolando un reintento seguro…');
      const job = await workshopApi.queueReportGeneration({
        workshopId,
        reportId: report.id,
        idempotencyKey: createIdempotencyKey('queueReportGenerationRetry'),
      });
      setActiveJobId(job.jobId);
      setJobStatus(job.status);
      setJobProgress(0);
      setNotice('Reintento en cola. Puedes volver más tarde.');
    } catch (retryError: unknown) {
      setProgress('');
      setError(getUserFacingError(retryError, 'No se pudo reintentar esta versión.'));
    } finally {
      setBusyAction('');
      await loadReports();
    }
  };

  const publish = async (report: ReportView) => {
    setBusyAction(`publish:${report.id}`);
    setError('');
    setNotice('');
    try {
      await workshopApi.publishReport({
        workshopId,
        reportId: report.id,
        idempotencyKey: createIdempotencyKey('publishReport'),
      });
      setNotice('Informe publicado correctamente.');
    } catch (publishError: unknown) {
      setError(getUserFacingError(publishError, 'No se pudo publicar el informe.'));
    } finally {
      setBusyAction('');
      setPublishCandidate(null);
      await loadReports();
    }
  };

  const download = async (report: ReportView, format: 'pdf' | 'pptx' | 'json') => {
    const artifact = report.artifacts?.[format];
    if (!artifact) return;
    setBusyAction(`download:${report.id}:${format}`);
    setError('');
    try {
      const sourceDate = report.artifactGeneratedAt || report.generatedAt || report.createdAt;
      const versionDate = sourceDate
        ? new Date(sourceDate).toISOString().slice(0, 10)
        : 'sin-fecha';
      const authorization = await workshopApi.createReportDownload({
        workshopId,
        reportId: report.id,
        format,
        idempotencyKey: createIdempotencyKey('createReportDownload'),
      });
      await downloadProtectedReport(
        authorization.url,
        `Kreatum_${roomCode}_${versionDate}_${report.id.slice(-8)}.${format}`,
        format,
      );
    } catch (downloadError: unknown) {
      setError(getUserFacingError(downloadError, `No se pudo descargar el ${format.toUpperCase()}.`));
    } finally {
      setBusyAction('');
    }
  };

  const canManage = role === 'owner' || role === 'facilitator';

  return (
    <section className="rounded-2xl border border-kreatum-purple/15 bg-white/90 p-6 dark:bg-white/[0.04]" aria-labelledby="reports-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-kreatum-purple/10 text-kreatum-purple">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 id="reports-heading" className="text-xl font-extrabold text-kreatum-dark dark:text-white">Informes</h2>
              <p className="text-sm text-kreatum-gray/60 dark:text-white/55">
                Versiones inmutables con PDF, PowerPoint editable y JSON de auditoría.
              </p>
            </div>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => void generateVersion()} disabled={Boolean(busyAction) || jobStatus === 'queued' || jobStatus === 'processing'} className="shrink-0">
            <FileText className="h-4 w-4" />
            {busyAction === 'generate' ? 'Generando…' : 'Generar nueva versión'}
          </Button>
        )}
      </div>

      {canManage && (
        <div className="mt-6 rounded-2xl border border-black/[0.06] bg-black/[0.02] p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-kreatum-dark dark:text-white">Anexo editorial opcional</h3>
            <p className="mt-1 text-xs leading-relaxed text-kreatum-gray/55 dark:text-white/45">
              Se identifica como anexo y no se mezcla con los datos del workshop. Cambiarlo crea otra versión.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="text-xs font-bold text-kreatum-gray dark:text-white/75">
              Resumen ejecutivo
              <textarea
                value={executiveSummary}
                onChange={(event) => setExecutiveSummary(event.target.value)}
                maxLength={20_000}
                rows={4}
                className="mt-2 w-full rounded-xl border border-black/10 bg-white p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-kreatum-purple/30 dark:border-white/10 dark:bg-white/[0.04]"
              />
            </label>
            <label className="text-xs font-bold text-kreatum-gray dark:text-white/75">
              Observaciones
              <textarea
                value={observations}
                onChange={(event) => setObservations(event.target.value)}
                maxLength={20_000}
                rows={4}
                className="mt-2 w-full rounded-xl border border-black/10 bg-white p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-kreatum-purple/30 dark:border-white/10 dark:bg-white/[0.04]"
              />
            </label>
            <label className="text-xs font-bold text-kreatum-gray dark:text-white/75">
              Próximos pasos
              <textarea
                value={nextSteps}
                onChange={(event) => setNextSteps(event.target.value)}
                maxLength={20_000}
                rows={4}
                className="mt-2 w-full rounded-xl border border-black/10 bg-white p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-kreatum-purple/30 dark:border-white/10 dark:bg-white/[0.04]"
              />
            </label>
          </div>
        </div>
      )}

      {progress && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-sm font-semibold text-amber-700" role="status">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>{progress}</span>
            {jobProgress !== null && <span className="ml-auto tabular-nums">{jobProgress}%</span>}
          </div>
          {jobProgress !== null && (
            <div
              aria-label="Progreso de generacion del informe"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={jobProgress}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-950/10"
              role="progressbar"
            >
              <div className="h-full rounded-full bg-amber-600 transition-[width]" style={{ width: `${jobProgress}%` }} />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm font-semibold text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-sm font-semibold text-green-700" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="py-8 text-center text-sm font-medium text-kreatum-gray/55">Cargando versiones…</p>
        ) : reports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/10 px-5 py-9 text-center dark:border-white/10">
            <FileText className="mx-auto h-8 w-8 text-kreatum-purple/30" />
            <p className="mt-3 text-sm font-bold text-kreatum-dark dark:text-white">Aún no hay informes</p>
            <p className="mt-1 text-xs text-kreatum-gray/55 dark:text-white/45">
              {canManage ? 'Genera la primera versión desde los datos registrados.' : 'No hay versiones publicadas disponibles.'}
            </p>
          </div>
        ) : reports.map((report, index) => {
          const isBusy = busyAction.includes(report.id);
          const hasCompleteArtifacts = hasCompleteReportArtifacts(report);
          const canRetryArtifacts = canRetryReportArtifacts(report, Boolean(activeJobId));
          const statusLabel = getReportStatusLabel(report);
          const statusStyle = !hasCompleteArtifacts && report.status === 'draft'
            ? 'bg-amber-500/10 text-amber-700'
            : STATUS_STYLES[report.status];
          return (
            <article key={report.id} className="rounded-2xl border border-black/[0.06] p-5 dark:border-white/[0.08]">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-kreatum-dark dark:text-white">
                      Versión {reports.length - index}
                    </span>
                    <span className={cn('rounded-lg px-2.5 py-1 text-[11px] font-extrabold', statusStyle)}>
                      {statusLabel}
                    </span>
                    {report.pageCount && (
                      <span className="rounded-lg bg-black/5 px-2.5 py-1 text-[11px] font-bold text-kreatum-gray/65 dark:bg-white/5 dark:text-white/55">
                        {report.pageCount} páginas
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-kreatum-gray/55 dark:text-white/45">
                    <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatDate(report.artifactGeneratedAt || report.generatedAt || report.createdAt)}</span>
                    <span>Plantilla {report.templateVersion || '—'}</span>
                    {report.artifacts?.pdf && <span>PDF {formatBytes(report.artifacts.pdf.size)}</span>}
                    {report.artifacts?.pptx && <span>PPTX {formatBytes(report.artifacts.pptx.size)}</span>}
                  </div>
                  {report.status === 'failed' && (
                    <p className="mt-2 text-xs font-semibold text-red-600">
                      La versión no se publicó; puedes reintentar sin duplicar los archivos.
                    </p>
                  )}
                  {!hasCompleteArtifacts && report.status !== 'failed' && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      Faltan el PDF y el PowerPoint. Completa esta misma versión sin crear otro snapshot.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {report.artifacts?.pdf && (
                    <Button variant="outline" size="sm" onClick={() => void download(report, 'pdf')} disabled={isBusy}>
                      <Download className="h-4 w-4" /> PDF
                    </Button>
                  )}
                  {report.artifacts?.pptx && (
                    <Button variant="outline" size="sm" onClick={() => void download(report, 'pptx')} disabled={isBusy}>
                      <Presentation className="h-4 w-4" /> PPTX
                    </Button>
                  )}
                  {report.artifacts?.json && (
                    <Button variant="outline" size="sm" onClick={() => void download(report, 'json')} disabled={isBusy}>
                      <Braces className="h-4 w-4" /> JSON
                    </Button>
                  )}
                  {canManage && canRetryArtifacts && (
                    <Button variant="outline" size="sm" onClick={() => void retryReport(report)} disabled={isBusy}>
                      <RefreshCw className="h-4 w-4" /> Completar PDF/PPTX
                    </Button>
                  )}
                  {canManage && report.status === 'draft' && hasCompleteArtifacts && (
                    <Button size="sm" onClick={() => setPublishCandidate(report)} disabled={isBusy}>
                      <Send className="h-4 w-4" /> Publicar
                    </Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <ActionDialog
        open={Boolean(publishCandidate)}
        title="Publicar versión"
        description="La versión será inmutable y quedará disponible para las personas autorizadas."
        confirmLabel="Publicar informe"
        busy={Boolean(publishCandidate && busyAction === 'publish:' + publishCandidate.id)}
        error={publishCandidate ? error : ''}
        onClose={() => setPublishCandidate(null)}
        onConfirm={async () => {
          if (publishCandidate) await publish(publishCandidate);
        }}
      />
    </section>
  );
}
