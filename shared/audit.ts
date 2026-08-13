import {
  AUDIT_PERIOD_DAYS,
  type AuditActorOption,
  type AuditDailyCount,
  type AuditEventSummary,
  type AuditPeriodDays,
  type GetOrganizationAuditOverviewOutput,
  type OrganizationAuditFilters,
} from './contracts.js';

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'workshop.created': 'Partida creada y activada',
  'workshop.resumed': 'Partida reanudada',
  'workshop.phaseChanged': 'Fase cambiada',
  'workshop.selectionReset': 'Selección reiniciada',
  'workshop.completed': 'Partida finalizada',
  'workshop.archived': 'Partida archivada',
  'workshop.deleted': 'Partida enviada a la papelera',
  'workshop.restored': 'Partida restaurada',
  'report.generated': 'Informe generado',
  'report.published': 'Informe publicado',
  'invitation.created': 'Invitación creada',
  'invitation.resent': 'Invitación reenviada',
  'invitation.cancelled': 'Invitación cancelada',
  'member.activated': 'Cuenta activada',
  'member.disabled': 'Cuenta desactivada',
  'member.roleChanged': 'Rol modificado',
};

export const DEFAULT_AUDIT_PERIOD_DAYS: AuditPeriodDays = 30;
export const MAX_AUDIT_OVERVIEW_EVENTS = 20_000;
export const MAX_AUDIT_EXPORT_EVENTS = 10_000;

export const isAuditPeriodDays = (value: unknown): value is AuditPeriodDays =>
  typeof value === 'number'
  && (AUDIT_PERIOD_DAYS as readonly number[]).includes(value);

export const auditPeriodStartMillis = (
  periodDays: AuditPeriodDays,
  now = Date.now(),
) => {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - periodDays + 1);
  return start.getTime();
};

export const normalizeAuditText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es-ES')
  .trim();

export const auditEventMatchesFilters = (
  event: AuditEventSummary,
  filters: OrganizationAuditFilters,
) => {
  if (filters.actorEmail && event.actorEmail !== filters.actorEmail) return false;
  if (filters.action && event.action !== filters.action) return false;
  if (filters.targetType && event.targetType !== filters.targetType) return false;
  const search = normalizeAuditText(filters.search ?? '');
  if (!search) return true;
  const searchable = normalizeAuditText([
    event.actorName,
    event.actorEmail,
    event.action,
    AUDIT_ACTION_LABELS[event.action] ?? '',
    event.targetId,
    event.reason ?? '',
  ].join(' '));
  return searchable.includes(search);
};

const dayKey = (value: number) => new Date(value).toISOString().slice(0, 10);

export const buildOrganizationAuditOverview = (
  periodEvents: AuditEventSummary[],
  filters: OrganizationAuditFilters,
  now = Date.now(),
  truncated = false,
): GetOrganizationAuditOverviewOutput => {
  const periodDays = isAuditPeriodDays(filters.periodDays)
    ? filters.periodDays
    : DEFAULT_AUDIT_PERIOD_DAYS;
  const matchingEvents = periodEvents.filter((event) => auditEventMatchesFilters(event, filters));
  const actors = new Map<string, AuditActorOption>();
  const actions = new Set<string>();
  for (const event of periodEvents) {
    if (event.actorEmail) {
      actors.set(event.actorEmail, {
        email: event.actorEmail,
        name: event.actorName,
      });
    }
    if (event.action) actions.add(event.action);
  }

  const uniqueActors = new Set(
    matchingEvents.map((event) => event.actorEmail).filter(Boolean),
  );
  const workshops = new Set(
    matchingEvents
      .filter((event) => event.targetType === 'workshop' && event.targetId)
      .map((event) => event.targetId),
  );
  const dailyMap = new Map<string, number>();
  for (let offset = periodDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    dailyMap.set(dayKey(date.getTime()), 0);
  }
  for (const event of matchingEvents) {
    if (!event.createdAt) continue;
    const key = dayKey(event.createdAt);
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
  }
  const daily: AuditDailyCount[] = Array.from(dailyMap, ([date, count]) => ({ date, count }));

  return {
    metrics: {
      totalEvents: matchingEvents.length,
      uniqueActors: uniqueActors.size,
      workshopsAffected: workshops.size,
      accessOperations: matchingEvents.filter((event) => (
        event.targetType === 'member' || event.targetType === 'invitation'
      )).length,
    },
    daily,
    actors: Array.from(actors.values()).sort((left, right) => (
      (left.name || left.email).localeCompare(right.name || right.email, 'es')
    )),
    actions: Array.from(actions).sort((left, right) => (
      (AUDIT_ACTION_LABELS[left] ?? left).localeCompare(AUDIT_ACTION_LABELS[right] ?? right, 'es')
    )),
    scannedCount: periodEvents.length,
    truncated,
  };
};
