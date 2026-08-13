import type { PlatformActivityItem, PlatformTimestamp } from './platformApi';

const ACTIVITY_LABELS: Record<string, string> = {
  'invitation.cancelled': 'Invitación cancelada',
  'invitation.created': 'Invitación creada',
  'invitation.initial_facilitator_cancelled': 'Invitación inicial cancelada',
  'invitation.initial_facilitator_created': 'Invitación inicial creada',
  'invitation.initial_facilitator_resent': 'Invitación inicial reenviada',
  'invitation.resent': 'Invitación reenviada',
  'member.activated': 'Usuario activado',
  'member.disabled': 'Usuario desactivado',
  'member.roleChanged': 'Rol de usuario modificado',
  'organization.global_viewed': 'Consulta global de la empresa',
  'organization.initial_facilitator_activated': 'Facilitador inicial activado',
  'organization.provisioned_pending': 'Empresa creada pendiente de activación',
  'organization.reactivated': 'Empresa reactivada',
  'organization.suspended': 'Empresa suspendida',
  'organization.updated': 'Empresa actualizada',
  'organization.workshop_allowance_adjusted': 'Partidas contratadas ajustadas',
  'report.downloaded': 'Informe descargado',
  'report.global_downloaded': 'Informe descargado por GFS',
  'report.global_generation_queued': 'Generación global de informe solicitada',
  'report.global_regeneration_queued': 'Regeneración global de informe solicitada',
  'report.global_snapshot_generated': 'Instantánea global de informe generada',
  'workshop.facilitator_assignment_confirmed': 'Asignación de facilitador confirmada',
  'workshop.facilitator_reassigned': 'Facilitador reasignado',
  'workshop.facilitator_reassigned_by_platform': 'Facilitador reasignado por GFS',
  'workshop.global_data_viewed': 'Consulta global de datos de partida',
  'workshop.global_listed': 'Consulta global del listado de partidas',
};

const READ_ACTIVITY_ACTIONS = new Set([
  'organization.global_viewed',
  'workshop.global_data_viewed',
  'workshop.global_listed',
]);

export const formatPlatformActivityAction = (action: string) =>
  ACTIVITY_LABELS[action] ?? 'Actividad registrada';

export const formatPlatformDate = (value: PlatformTimestamp, includeTime = false) => {
  if (value === null || value === undefined || value === '') return '—';
  const raw = typeof value === 'object'
    ? (value.seconds ?? value._seconds ?? 0) * 1_000
    : value;
  const parsed = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return '—';
  return new Intl.DateTimeFormat('es-ES', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(parsed);
};

export const formatPlatformValidity = (
  validFrom: PlatformTimestamp,
  validUntil: PlatformTimestamp,
) => {
  const start = formatPlatformDate(validFrom);
  if (validUntil === null || validUntil === undefined || validUntil === '') {
    return `Desde ${start} · Sin fecha de vencimiento`;
  }
  return `Desde ${start} · Hasta ${formatPlatformDate(validUntil)}`;
};

export interface PlatformActivityGroup {
  key: string;
  action: string;
  items: PlatformActivityItem[];
  isReadGroup: boolean;
}

const activityGroupingKey = (item: PlatformActivityItem) => JSON.stringify([
  item.action,
  item.actorHash,
  item.targetType,
  item.targetId,
  item.workshopId ?? '',
  item.reason ?? '',
]);

export const groupConsecutivePlatformActivity = (
  items: PlatformActivityItem[],
): PlatformActivityGroup[] => {
  const groups: PlatformActivityGroup[] = [];
  for (const item of items) {
    const previous = groups.at(-1);
    const isRead = READ_ACTIVITY_ACTIONS.has(item.action);
    const matchesPrevious = previous
      && activityGroupingKey(previous.items[0]) === activityGroupingKey(item);
    if (isRead && previous?.isReadGroup && matchesPrevious) {
      previous.items.push(item);
      continue;
    }
    groups.push({
      key: item.id,
      action: item.action,
      items: [item],
      isReadGroup: isRead,
    });
  }
  return groups;
};
