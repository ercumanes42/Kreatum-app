import { EXPORT_VERSION, SCHEMA_VERSION } from '../../shared/contracts';

const PRIVATE_EXPORT_FIELDS = new Set([
  'actorHash',
  'createdBy',
  'memberIds',
  'participantId',
  'playerId',
  'reassignments',
]);

const isTimestampLike = (value: unknown): value is { toMillis: () => number } =>
  !!value
  && typeof value === 'object'
  && 'toMillis' in value
  && typeof (value as { toMillis?: unknown }).toMillis === 'function';

export const sanitizeExportValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (isTimestampLike(value)) {
    return new Date(value.toMillis()).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRIVATE_EXPORT_FIELDS.has(key))
      .map(([key, item]) => [key, sanitizeExportValue(item)]),
  );
};

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return '{' + entries
      .map(([key, item]) => JSON.stringify(key) + ':' + stableStringify(item))
      .join(',') + '}';
  }
  return JSON.stringify(value);
};

export const createSnapshotHash = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const createExportDocument = async (
  payload: Record<string, unknown>,
  schemaVersion: number = SCHEMA_VERSION,
) => {
  const sanitizedPayload = sanitizeExportValue(payload) as Record<string, unknown>;
  return {
    exportVersion: EXPORT_VERSION,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    sourceSnapshotHash: await createSnapshotHash(sanitizedPayload),
    ...sanitizedPayload,
  };
};

export const downloadJson = (value: unknown, fileName: string) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
