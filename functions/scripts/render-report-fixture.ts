import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReportEditorial } from '../../shared/contracts.js';
import {
  REPORT_FIELD_DEFINITIONS,
  REPORT_TEAM_ORDER,
  buildReportDataset,
  buildReportDeck,
  type ReportGameSource,
} from '../../shared/reporting.js';
import {
  loadReportAssets,
  renderReportPdf,
  renderReportPptx,
} from '../src/reporting/renderReportArtifacts.js';

const parseCsv = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
};

const listFields = new Set([
  'perspectives',
  'top3Perspectives',
  'solutions',
  'top3Solutions',
  'attacksOnOthers',
  'receivedAttacks',
  'defenses',
  'strengths',
  'weaknesses',
  'resources',
]);
const voteFields = new Set(['perspectiveVotes', 'solutionVotes']);
const reverseFields = new Map(Object.entries(REPORT_FIELD_DEFINITIONS)
  .map(([field, definition]) => [definition.label, field]));

const parseValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'Sí') return true;
  if (trimmed === 'No') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  }
  return trimmed;
};

const sourceFromCsv = (rows: string[][]): ReportGameSource => {
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ''));
  const records = rows.slice(1).filter((row) => row.some(Boolean)).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
  const first = records[0];
  if (!first) throw new Error('The CSV contains no report rows.');
  const workshop: Record<string, unknown> = { challenge: first['Reto Principal'], status: 'completed' };
  const teams = Object.fromEntries(REPORT_TEAM_ORDER.map((team) => [team, { team }]));
  const attacks: Array<Record<string, unknown> & { id: string }> = [];
  const defenses: Array<Record<string, unknown> & { id: string }> = [];
  const solutions: Array<Record<string, unknown> & { id: string }> = [];

  records.forEach((record, rowIndex) => {
    const team = record.Equipo;
    const value = parseValue(record.Valor);
    if (!team && record.Fase === 'General' && record.Campo && record.Campo !== 'Reto principal') {
      const existing = workshop[record.Campo];
      if (existing === undefined) workshop[record.Campo] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else workshop[record.Campo] = [existing, value];
      return;
    }
    if (record.Categoría === 'Ataques registrados') {
      attacks.push({
        id: record['ID Registro'] || `attack-${rowIndex + 1}`,
        fromTeam: record['Equipo Origen'] || team,
        toTeam: record['Equipo Destino'],
        timestamp: record['Fecha Registro'],
        content: value,
      });
      return;
    }
    if (record.Categoría === 'Defensas registradas') {
      defenses.push({
        id: record['ID Registro'] || `defense-${rowIndex + 1}`,
        attackId: record['ID Relacionado'],
        team,
        timestamp: record['Fecha Registro'],
        content: value,
      });
      return;
    }
    if (record.Categoría === 'Soluciones compartidas') {
      solutions.push({ id: '', team, timestamp: record['Fecha Registro'], content: value });
      return;
    }
    if (!REPORT_TEAM_ORDER.includes(team as typeof REPORT_TEAM_ORDER[number])) return;
    const teamData = teams[team] as Record<string, unknown>;
    const field = reverseFields.get(record.Campo) || record.Campo;
    if (!field) return;
    if (listFields.has(field)) {
      const values = Array.isArray(teamData[field]) ? teamData[field] as unknown[] : [];
      values.push(value);
      teamData[field] = values;
    } else if (voteFields.has(field)) {
      const values = Array.isArray(teamData[field]) ? teamData[field] as unknown[] : [];
      values.push(value);
      teamData[field] = values;
    } else teamData[field] = value;
  });

  return {
    id: first['ID Partida'],
    roomCode: first['Código Sala'],
    status: 'completed',
    createdAt: first['Fecha Creación'],
    completedAt: first['Fecha Fin'],
    client: first.Cliente,
    facilitator: first.Facilitador,
    workshop,
    teams,
    attacks,
    defenses,
    solutions,
  };
};

const main = async () => {
  const [csvArgument, outputArgument, editorialArgument, workshopArgument] = process.argv.slice(2);
if (!csvArgument || !outputArgument) {
  throw new Error(
    'Usage: render-report-fixture.ts <input.csv> <output-directory> '
      + '[editorial-overrides.json] [workshop-overrides.json]',
  );
}

const csvPath = resolve(csvArgument);
const outputDirectory = resolve(outputArgument);
const rows = parseCsv(await readFile(csvPath, 'utf8'));
const source = sourceFromCsv(rows);
if (workshopArgument) {
  const parsed = JSON.parse(await readFile(resolve(workshopArgument), 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The workshop overrides file must contain a JSON object.');
  }
  const overrides = parsed as Record<string, unknown>;
  for (const field of ['createdAt', 'completedAt'] as const) {
    const value = overrides[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Workshop override ${field} must be a non-empty string.`);
    }
    source[field] = value.trim();
  }
}
const editorial = editorialArgument
  ? JSON.parse(await readFile(resolve(editorialArgument), 'utf8')) as Partial<ReportEditorial>
  : {};
const dataset = buildReportDataset(source, editorial);
const deck = buildReportDeck(dataset);
const assets = await loadReportAssets(resolve('assets/report'));
const [pdf, pptx] = await Promise.all([
  renderReportPdf(deck, assets),
  renderReportPptx(deck, assets),
]);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, 'kreatum-report-fixture.pdf'), pdf),
  writeFile(resolve(outputDirectory, 'kreatum-report-fixture.pptx'), pptx),
  writeFile(resolve(outputDirectory, 'kreatum-report-dataset.json'), JSON.stringify(dataset, null, 2)),
  writeFile(resolve(outputDirectory, 'kreatum-report-deck.json'), JSON.stringify(deck, null, 2)),
]);

console.log(JSON.stringify({
  csvRows: rows.length - 1,
  datasetRows: dataset.rows.length,
  pages: deck.pages.length,
  pdfBytes: pdf.length,
  pptxBytes: pptx.length,
  outputDirectory,
}, null, 2));
};

void main();
