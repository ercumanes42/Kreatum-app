import type { AuditActorOption, AuditEventSummary } from '../../shared/contracts';
import { AUDIT_ACTION_LABELS } from '../../shared/audit';

const ADMIN_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  'invitation.initial_facilitator_cancelled': 'Invitación inicial cancelada',
  'invitation.initial_facilitator_created': 'Invitación inicial creada',
  'invitation.initial_facilitator_resent': 'Invitación inicial reenviada',
  'organization.accessMigration': 'Accesos de empresa migrados',
  'organization.commercialUpdated': 'Configuración comercial actualizada',
  'organization.global_viewed': 'Consulta global de empresa',
  'organization.initial_facilitator_activated': 'Facilitador inicial activado',
  'organization.platformAccessMigrated': 'Acceso de plataforma migrado',
  'organization.provisioned': 'Empresa creada',
  'organization.provisioned_pending': 'Empresa creada pendiente de activación',
  'organization.reactivated': 'Empresa reactivada',
  'organization.stagingAllowanceInitialized': 'Partidas de staging configuradas',
  'organization.suspended': 'Empresa suspendida',
  'organization.updated': 'Empresa actualizada',
  'organization.workshop_allowance_adjusted': 'Partidas contratadas ajustadas',
  'platformAdmin.granted': 'Permiso de plataforma concedido',
  'report.artifacts_generated': 'Archivos de informe generados',
  'report.downloaded': 'Informe descargado',
  'report.editorial_updated': 'Edición del informe actualizada',
  'report.global_downloaded': 'Informe descargado por GFS',
  'report.global_generation_queued': 'Generación global de informe solicitada',
  'report.global_regeneration_queued': 'Regeneración global de informe solicitada',
  'report.global_snapshot_generated': 'Instantánea global de informe generada',
  'report.jobQueued': 'Generación de informe solicitada',
  'workshop.controlUpdated': 'Control de partida actualizado',
  'workshop.facilitator_assignment_confirmed': 'Asignación de facilitador confirmada',
  'workshop.facilitator_reassigned': 'Facilitador reasignado',
  'workshop.facilitator_reassigned_by_platform': 'Facilitador reasignado por GFS',
  'workshop.facilitatorMigrated': 'Facilitador de partida migrado',
  'workshop.global_data_viewed': 'Consulta global de datos de partida',
  'workshop.global_listed': 'Consulta global del listado de partidas',
  'workshop.migrated': 'Partida migrada',
  'workshop.transitionCancelled': 'Cambio de fase cancelado',
  'workshop.transitionCommitted': 'Cambio de fase confirmado',
  'workshop.transitionRequested': 'Cambio de fase solicitado',
};

const READ_ACTIVITY_ACTIONS = new Set([
  'organization.global_viewed',
  'workshop.global_listed',
  'workshop.global_data_viewed',
]);

const SYSTEM_ACTOR_PATTERN = /(?:migration[ -]?script|staging[ -]?release|system|sistema)/i;

const STATE_KEY_LABELS: Readonly<Record<string, string>> = {
  status: 'Estado',
  role: 'Rol',
  ownerCount: 'Propietarios',
  workshopAllowance: 'Partidas contratadas',
};

const STATE_VALUE_LABELS: Readonly<Record<string, string>> = {
  active: 'Activa',
  archived: 'Archivada',
  cancelled: 'Cancelada',
  completed: 'Finalizada',
  deliveryFailed: 'Error de entrega',
  disabled: 'Desactivada',
  facilitator: 'Facilitador',
  owner: 'Propietario',
  pending: 'Pendiente',
};

export const normalizeAuditAction = (action: string) => action.replace(/_{2,}/g, '_');

export const formatAdminActivityAction = (action: string) => {
  const normalized = normalizeAuditAction(action);
  return ADMIN_ACTIVITY_LABELS[normalized] ?? AUDIT_ACTION_LABELS[normalized] ?? 'Actividad registrada';
};

export const isSystemAuditActor = (actor: Pick<AuditActorOption, 'email' | 'name'>) =>
  SYSTEM_ACTOR_PATTERN.test(`${actor.name} ${actor.email}`);

export const visibleAuditActors = (actors: AuditActorOption[]) =>
  actors.filter((actor) => !isSystemAuditActor(actor));

export const maskAuditEmail = (email: string) => {
  const [localPart = '', domain = ''] = email.trim().toLowerCase().split('@');
  if (!localPart || !domain) return '';
  const visibleLength = Math.min(2, localPart.length);
  return `${localPart.slice(0, visibleLength)}${'*'.repeat(Math.max(3, localPart.length - visibleLength))}@${domain}`;
};

export const auditActorLabel = (event: Pick<AuditEventSummary, 'actorName' | 'actorEmail'>) => {
  if (isSystemAuditActor({ name: event.actorName, email: event.actorEmail })) return 'Sistema';
  return event.actorName || (event.actorEmail ? 'Persona registrada' : 'Sistema');
};

export const auditTargetContextLabel = (targetType: AuditEventSummary['targetType']) => ({
  organization: 'Empresa actual',
  workshop: 'Partida registrada',
  member: 'Cuenta registrada',
  invitation: 'Invitación registrada',
  report: 'Informe registrado',
})[targetType];

export const formatAuditState = (state: AuditEventSummary['previousState']) => {
  if (!state) return '—';
  return Object.entries(state).map(([key, value]) => {
    const keyLabel = STATE_KEY_LABELS[key] ?? key;
    const valueLabel = typeof value === 'string' ? (STATE_VALUE_LABELS[value] ?? value) : String(value);
    return keyLabel + ': ' + valueLabel;
  }).join(' · ');
};

const normalizedStateEntries = (state: AuditEventSummary['previousState']) =>
  state
    ? Object.entries(state).sort(([left], [right]) => left.localeCompare(right))
    : [];

export const isAuditStateNoOp = (event: Pick<AuditEventSummary, 'previousState' | 'newState'>) =>
  JSON.stringify(normalizedStateEntries(event.previousState))
  === JSON.stringify(normalizedStateEntries(event.newState));

export interface AdminActivityGroup {
  key: string;
  items: AuditEventSummary[];
  isReadGroup: boolean;
}

const activityGroupingKey = (event: AuditEventSummary) => JSON.stringify([
  normalizeAuditAction(event.action),
  event.actorEmail,
  event.actorName,
  event.targetType,
  event.targetId,
  event.reason ?? '',
]);

export const groupConsecutiveAdminActivity = (
  events: AuditEventSummary[],
): AdminActivityGroup[] => {
  const groups: AdminActivityGroup[] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    const isRead = READ_ACTIVITY_ACTIONS.has(normalizeAuditAction(event.action));
    const matchesPrevious = previous
      && activityGroupingKey(previous.items[0]) === activityGroupingKey(event);
    if (isRead && previous?.isReadGroup && matchesPrevious) {
      previous.items.push(event);
      continue;
    }
    groups.push({ key: event.id, items: [event], isReadGroup: isRead });
  }
  return groups;
};
