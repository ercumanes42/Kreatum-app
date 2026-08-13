import {
  REPORT_CSV_HEADERS,
  buildReportDataset,
  reportDatasetToCsvRows,
  type ReportGameSource,
  type ReportSourceDocument,
} from '../../shared/reporting';

export type GameExportDocument = ReportSourceDocument;

export interface GameCsvRecord extends Omit<ReportGameSource,
  'roomCode' | 'status' | 'createdAt' | 'completedAt' | 'globalState' | 'teams' |
  'attacks' | 'defenses' | 'solutions'> {
  roomCode: string;
  status: 'active' | 'completed';
  createdAt: number;
  completedAt?: number;
  client?: string;
  facilitator?: string;
  globalState: Record<string, unknown>;
  teams: Record<string, Record<string, unknown>>;
  attacks: GameExportDocument[];
  defenses: GameExportDocument[];
  solutions: GameExportDocument[];
}

export const buildGameCsvRows = (game: GameCsvRecord, includeHeader = true): string[][] =>
  reportDatasetToCsvRows(buildReportDataset(game), includeHeader);

export const buildGamesCsvRows = (games: GameCsvRecord[]): string[][] => [
  [...REPORT_CSV_HEADERS],
  ...games.flatMap((game) => buildGameCsvRows(game, false)),
];

const neutralizeSpreadsheetFormula = (value: string) =>
  /^[\t\r ]*[=+\-@]/.test(value) ? "'" + value : value;

export const serializeCsv = (rows: string[][]) => rows
  .map((row) => row.map((cell) => {
    const safeCell = neutralizeSpreadsheetFormula(String(cell));
    return '"' + safeCell.replace(/"/g, '""') + '"';
  }).join(','))
  .join('\n');

export const downloadCsv = (rows: string[][], fileName: string) => {
  const blob = new Blob(['\uFEFF' + serializeCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
