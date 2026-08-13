import type { AuditEventSummary } from '../../shared/contracts';
import { AUDIT_ACTION_LABELS } from '../../shared/audit';
import { downloadCsv } from './gameCsv';

const TARGET_LABELS: Record<AuditEventSummary['targetType'], string> = {
  workshop: 'Partida',
  member: 'Cuenta',
  invitation: 'Invitación',
  report: 'Informe',
  organization: 'Organización',
};

const stateCell = (state: AuditEventSummary['previousState']) => state
  ? Object.entries(state).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
  : '';

export const buildAuditCsvRows = (events: AuditEventSummary[]): string[][] => [
  ['Fecha y hora', 'Persona', 'Correo', 'Acción', 'Tipo de objetivo', 'ID del objetivo', 'Estado anterior', 'Estado nuevo', 'Motivo'],
  ...events.map((event) => [
    event.createdAt ? new Date(event.createdAt).toISOString() : '',
    event.actorName || 'Sistema',
    event.actorEmail,
    AUDIT_ACTION_LABELS[event.action] ?? event.action,
    TARGET_LABELS[event.targetType],
    event.targetId,
    stateCell(event.previousState),
    stateCell(event.newState),
    event.reason ?? '',
  ]),
];

export const downloadAuditCsv = (events: AuditEventSummary[], fileName: string) =>
  downloadCsv(buildAuditCsvRows(events), fileName);
