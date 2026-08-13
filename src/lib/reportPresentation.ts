import type { ReportRecord } from '../../shared/contracts';

type ReportArtifactState = Pick<ReportRecord, 'artifacts' | 'status'>;

export const hasCompleteReportArtifacts = (report: ReportArtifactState): boolean => Boolean(
  report.artifacts?.pdf && report.artifacts?.pptx && report.artifacts?.json,
);

export const canRetryReportArtifacts = (
  report: ReportArtifactState,
  hasActiveJob: boolean,
): boolean => !hasActiveJob
  && !hasCompleteReportArtifacts(report)
  && !['queued', 'generating', 'published'].includes(report.status);

export const getReportStatusLabel = (report: ReportArtifactState): string => {
  if (hasCompleteReportArtifacts(report)) {
    return report.status === 'published' ? 'Publicado' : 'Listo';
  }
  if (report.status === 'queued') return 'En cola';
  if (report.status === 'generating') return 'Generando';
  if (report.status === 'failed') return 'Fallido';
  return 'Archivos pendientes';
};
