export const HISTORY_EXPORT_MAX_ROWS = 10_000;

export const HISTORY_EXPORT_HEADERS = [
  'ID Partida',
  'Código Sala',
  'Estado',
  'Fecha Creación',
  'Fecha Fin',
  'Cliente',
  'Facilitador',
  'Fase actual',
] as const;

export interface HistoryExportRow {
  id: string;
  roomCode: string;
  status: string;
  createdAt: number | null;
  completedAt: number | null;
  client: string;
  facilitator: string;
  currentPhase: string;
}

const neutralizeSpreadsheetFormula = (value: string) =>
  /^[\t\r ]*[=+\-@]/.test(value) ? "'" + value : value;

const escapeCsvCell = (value: string) =>
  '"' + neutralizeSpreadsheetFormula(value).replace(/"/g, '""') + '"';

const formatTimestamp = (value: number | null) =>
  value === null ? '' : new Date(value).toISOString();

export const serializeHistoryExportCsv = (rows: readonly HistoryExportRow[]) => [
  HISTORY_EXPORT_HEADERS.map(escapeCsvCell).join(','),
  ...rows.map((row) => [
    row.id,
    row.roomCode,
    row.status,
    formatTimestamp(row.createdAt),
    formatTimestamp(row.completedAt),
    row.client,
    row.facilitator,
    row.currentPhase,
  ].map((cell) => escapeCsvCell(String(cell))).join(',')),
].join('\n');

export const historyExportRowMatches = (
  row: HistoryExportRow,
  search: string,
  status: string,
) => {
  const normalizedSearch = search.trim().toLocaleLowerCase('es');
  const matchesStatus = status === 'all' || row.status === status;
  if (!matchesStatus) return false;
  if (!normalizedSearch) return true;
  return [row.roomCode, row.id, row.client, row.facilitator]
    .some((value) => value.toLocaleLowerCase('es').includes(normalizedSearch));
};
