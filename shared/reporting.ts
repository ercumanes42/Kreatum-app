import type { ReportEditorial } from './contracts.js';
import {
  isMeaningfulReportEntry,
  proofreadReportDisplay,
  sanitizeReportEntry,
  sanitizeReportList,
} from './reportText.js';

export const REPORT_TEAM_ORDER = ['Agua', 'Aire', 'Fuego', 'Tierra'] as const;
export type ReportTeamName = (typeof REPORT_TEAM_ORDER)[number];

const REPORT_TIME_ZONE = 'Europe/Madrid';

export const REPORT_CSV_HEADERS = [
  'ID Partida',
  'Código Sala',
  'Estado',
  'Fecha Creación',
  'Fecha Fin',
  'Cliente',
  'Facilitador',
  'Reto Principal',
  'Equipo',
  'Fase',
  'Categoría',
  'Campo',
  'Índice',
  'Equipo Origen',
  'Equipo Destino',
  'Fecha Registro',
  'ID Registro',
  'ID Relacionado',
  'Valor',
] as const;

export const REPORT_FIELD_DEFINITIONS: Record<
  string,
  { phase: string; category: string; label: string }
> = {
  currentPhase: { phase: 'General', category: 'Estado del equipo', label: 'Fase actual' },
  challenge: { phase: 'Diluir', category: 'Reto', label: 'Reto del equipo' },
  perspectives: { phase: 'Diluir', category: 'Ideas generadas', label: 'Perspectiva' },
  top3Perspectives: { phase: 'Diluir', category: 'Preselección', label: 'Perspectiva preseleccionada' },
  perspectiveVotes: { phase: 'Diluir', category: 'Votaciones', label: 'Votos de perspectiva' },
  selectedPerspective: { phase: 'Diluir', category: 'Decisión', label: 'Perspectiva definitiva' },
  solutions: { phase: 'Conjugar', category: 'Ideas generadas', label: 'Solución' },
  top3Solutions: { phase: 'Conjugar', category: 'Preselección', label: 'Solución preseleccionada' },
  solutionVotes: { phase: 'Conjugar', category: 'Votaciones', label: 'Votos de solución' },
  selectedSolution: { phase: 'Conjugar', category: 'Decisión', label: 'Solución definitiva' },
  receivedSolutionToAttack: { phase: 'Sublimar', category: 'Ataque', label: 'Solución rival recibida' },
  attacksOnOthers: { phase: 'Sublimar', category: 'Ataques del equipo', label: 'Ataque enviado (copia local)' },
  receivedAttacks: { phase: 'Sublimar', category: 'Ataques recibidos', label: 'Ataque recibido (copia local)' },
  defenses: { phase: 'Sublimar', category: 'Defensas y mitigaciones', label: 'Mitigación' },
  reformulatedSolution: { phase: 'Sublimar', category: 'Reformulación', label: 'Solución reformulada' },
  expectedResults: { phase: 'Sublimar', category: 'Reformulación', label: 'Resultados esperados' },
  sublimarView: { phase: 'Sublimar', category: 'Estado', label: 'Vista final de Sublimar' },
  sublimarDefenseCompleted: { phase: 'Sublimar', category: 'Estado', label: 'Defensa completada' },
  audience: { phase: 'Fermentar', category: 'Aterrizaje', label: 'Audiencia' },
  strengths: { phase: 'Fermentar', category: 'Aterrizaje', label: 'Fortalezas' },
  weaknesses: { phase: 'Fermentar', category: 'Aterrizaje', label: 'Debilidades' },
  pilot: { phase: 'Fermentar', category: 'Aterrizaje', label: 'Prueba piloto / prototipo' },
  resources: { phase: 'Fermentar', category: 'Aterrizaje', label: 'Recursos necesarios' },
  pitch: { phase: 'Proyectar', category: 'Pitch', label: 'Pitch completo' },
  pitchStart: { phase: 'Proyectar', category: 'Pitch', label: '1. Captación' },
  pitchProblem: { phase: 'Proyectar', category: 'Pitch', label: '2. Acción' },
  pitchSolution: { phase: 'Proyectar', category: 'Pitch', label: '3. Testeo' },
  pitchAction: { phase: 'Proyectar', category: 'Pitch', label: '4. Conclusiones' },
  isFinished: { phase: 'Proyectar', category: 'Estado del equipo', label: 'Workshop finalizado' },
};

export const REPORT_PRIVATE_FIELDS = new Set([
  'actorHash',
  'activeDeviceExpiresAt',
  'activeParticipantHash',
  'activeParticipantId',
  'createdBy',
  'createdByHash',
  'editorialUpdatedByHash',
  'memberIds',
  'organizationId',
  'ownerId',
  'participantHash',
  'participantId',
  'participantIds',
  'playerId',
  'playerIds',
  'publishedByHash',
  'reassignments',
  'lastHeartbeatAt',
  'transitionAckAt',
  'transitionAckId',
  'uid',
]);

const GLOBAL_METADATA_FIELDS = new Set([
  'id',
  'roomCode',
  'status',
  'createdAt',
  'completedAt',
  'client',
  'facilitator',
  'challenge',
  'organizationId',
  'createdBy',
  'schemaVersion',
  'retentionMonths',
  'retentionDeleteAt',
  'updatedAt',
  'archivedAt',
]);

const TECHNICAL_TEAM_FIELDS = new Set([
  'id',
  'team',
  'playerId',
  'memberIds',
  'createdAt',
  'updatedAt',
  'assignmentResetAt',
  'defenses',
  'reassignments',
  'schemaVersion',
]);

const REPORT_ENTRY_FIELDS = new Set([
  'challenge',
  'perspectives',
  'top3Perspectives',
  'selectedPerspective',
  'solutions',
  'top3Solutions',
  'selectedSolution',
  'receivedSolutionToAttack',
  'attacksOnOthers',
  'receivedAttacks',
  'defenses',
  'reformulatedSolution',
  'expectedResults',
  'audience',
  'strengths',
  'weaknesses',
  'pilot',
  'resources',
  'pitch',
  'pitchStart',
  'pitchProblem',
  'pitchSolution',
  'pitchAction',
]);

const REPORT_LIST_ENTRY_FIELDS = new Set([
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

export interface ReportSourceDocument {
  id: string;
  [key: string]: unknown;
}

export interface ReportGameSource {
  id: string;
  roomCode?: string;
  status?: string;
  createdAt?: unknown;
  completedAt?: unknown;
  client?: string;
  facilitator?: string;
  globalState?: Record<string, unknown>;
  workshop?: Record<string, unknown>;
  teams: Record<string, Record<string, unknown>> | ReportSourceDocument[];
  attacks?: ReportSourceDocument[];
  defenses?: ReportSourceDocument[];
  solutions?: ReportSourceDocument[];
}

export interface ReportDataRow {
  workshopId: string;
  roomCode: string;
  status: string;
  createdAt: string;
  completedAt: string;
  client: string;
  facilitator: string;
  challenge: string;
  team: string;
  phase: string;
  category: string;
  field: string;
  index: string;
  fromTeam: string;
  toTeam: string;
  recordedAt: string;
  recordId: string;
  relatedId: string;
  value: string;
}

export interface ReportVote {
  option: string;
  votes: number | null;
}

export interface ReportAttack {
  id: string;
  fromTeam: string;
  toTeam: string;
  content: string;
  recordedAt: string;
}

export interface ReportDefense {
  id: string;
  attackId: string;
  team: string;
  content: string;
  recordedAt: string;
}

export interface ReportContrast {
  attackId: string;
  fromTeam: string;
  toTeam: string;
  attack: string;
  defense: string;
  attackRecordedAt: string;
  defenseRecordedAt: string;
}

export interface ReportTeamDataset {
  name: ReportTeamName;
  currentPhase: string;
  challenge: string;
  perspectives: string[];
  topPerspectives: string[];
  perspectiveVotes: ReportVote[];
  selectedPerspective: string;
  solutions: string[];
  topSolutions: string[];
  solutionVotes: ReportVote[];
  selectedSolution: string;
  contrasts: ReportContrast[];
  reformulatedSolution: string;
  expectedResults: string;
  ferment: {
    audience: string;
    strengths: string[];
    weaknesses: string[];
    pilot: string;
    resources: string[];
  };
  pitch: {
    complete: string;
    start: string;
    problem: string;
    solution: string;
    action: string;
  };
  finished: boolean | null;
  additionalFields: Array<{ field: string; label: string; value: string }>;
}

export interface ReportDataset {
  version: '1.0.0';
  workshop: {
    id: string;
    roomCode: string;
    status: string;
    createdAt: string;
    completedAt: string;
    client: string;
    facilitator: string;
    challenge: string;
    configuration: Array<{ field: string; value: string }>;
  };
  metrics: {
    teams: number;
    perspectives: number;
    prioritizedPerspectives: number;
    solutions: number;
    prioritizedSolutions: number;
    attacks: number;
    defenses: number;
    completedTeams: number;
  };
  teams: ReportTeamDataset[];
  attacks: ReportAttack[];
  defenses: ReportDefense[];
  editorial: ReportEditorial;
  rows: ReportDataRow[];
}

export type ReportBlock =
  | { kind: 'text'; label?: string; text: string; accent?: string; prominent?: boolean }
  | { kind: 'list'; label?: string; items: string[]; ordered?: boolean; accent?: string }
  | { kind: 'metrics'; items: Array<{ label: string; value: string }> }
  | { kind: 'votes'; label: string; items: ReportVote[]; accent?: string }
  | {
    kind: 'contrast';
    fromTeam: string;
    toTeam: string;
    attack: string;
    defense: string;
    attackRecordedAt?: string;
    defenseRecordedAt?: string;
  };

export interface ReportDeckPage {
  kind: 'cover' | 'technical' | 'index' | 'section' | 'metrics' | 'content' | 'editorial' | 'closing';
  sectionId: string;
  section: string;
  title: string;
  subtitle?: string;
  team?: ReportTeamName;
  blocks: ReportBlock[];
  pageNumber: number;
  totalPages: number;
}

export interface ReportDeck {
  templateVersion: string;
  title: string;
  roomCode: string;
  pages: ReportDeckPage[];
}

const TEAM_COLORS: Record<ReportTeamName, string> = {
  Agua: '#478DCF',
  Aire: '#56C6C8',
  Fuego: '#EF6D65',
  Tierra: '#66A66F',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const reportValueToString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const reportEntryToString = (value: unknown): string =>
  sanitizeReportEntry(reportValueToString(value));

const sanitizeReportFieldValue = (field: string, value: unknown): unknown => {
  if (!REPORT_LIST_ENTRY_FIELDS.has(field)) return reportEntryToString(value);
  const values = Array.isArray(value) ? value : [value];
  return sanitizeReportList(values.map(reportValueToString));
};

export const isMeaningfulReportValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isMeaningfulReportValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>)
    .some(isMeaningfulReportValue);
  return true;
};

const parseSpanishReportTimestamp = (value: string): {
  millis: number;
  formatted: string;
} | null => {
  const match = value.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?$/u,
  );
  if (!match) return null;
  const [, dayValue, monthValue, yearValue, hourValue, minuteValue, secondValue] = match;
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = Number(yearValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = secondValue === undefined ? 0 : Number(secondValue);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    millis: date.getTime(),
    formatted: `${pad(day)}/${pad(month)}/${year}, ${pad(hour)}:${pad(minute)}`
      + (secondValue === undefined ? '' : `:${pad(second)}`),
  };
};

export const reportTimestampToMillis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const spanishTimestamp = parseSpanishReportTimestamp(value);
    if (spanishTimestamp) return spanishTimestamp.millis;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const candidate = value as { toMillis?: unknown };
    if (typeof candidate.toMillis === 'function') {
      const millis = candidate.toMillis();
      return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
    }
  }
  return null;
};

export const formatReportTimestamp = (value: unknown): string => {
  if (typeof value === 'string') {
    const spanishTimestamp = parseSpanishReportTimestamp(value);
    if (spanishTimestamp) return spanishTimestamp.formatted;
  }
  const timestamp = reportTimestampToMillis(value);
  if (timestamp === null || timestamp <= 0) return '';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: REPORT_TIME_ZONE,
  }).format(new Date(timestamp));
};

const resolveReportCompletionTimestamp = (workshop: Record<string, unknown>): string => {
  const completedAt = formatReportTimestamp(workshop.completedAt);
  if (completedAt) return completedAt;
  const transition = asRecord(workshop.transition);
  const validCompletionTransition = reportValueToString(workshop.status) === 'completed'
    && reportValueToString(transition.kind) === 'complete'
    && reportValueToString(transition.state) === 'committed';
  if (validCompletionTransition) {
    const committedAt = formatReportTimestamp(transition.committedAt);
    if (committedAt) return committedAt;
  }
  return reportValueToString(workshop.status) === 'completed' ? 'No registrada' : '';
};

const sanitizeRecord = (value: Record<string, unknown>) => Object.fromEntries(
  Object.entries(value).filter(([key]) => !REPORT_PRIVATE_FIELDS.has(key)),
);

const toTextArray = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return sanitizeReportList(values.map(reportValueToString));
};

const toIndexedTextArray = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.map(reportEntryToString);
};

const toVotes = (value: unknown, options: string[]): ReportVote[] => {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number')) {
      return value.map((votes, index) => ({ option: options[index] || '', votes }))
        .filter((item) => item.option);
    }
    return value.map((item, index) => {
      const record = asRecord(item);
      const votesValue = record.votes ?? record.count ?? record.value;
      return {
        option: reportEntryToString(record.option ?? record.label ?? options[index] ?? ''),
        votes: typeof votesValue === 'number' && Number.isFinite(votesValue) ? votesValue : null,
      };
    }).filter((item) => item.option);
  }
  const record = asRecord(value);
  return Object.entries(record).map(([option, votes]) => ({
    option: reportEntryToString(option),
    votes: typeof votes === 'number' && Number.isFinite(votes) ? votes : null,
  })).filter((item) => item.option);
};

const normalizeDocuments = (value: unknown): ReportSourceDocument[] =>
  Array.isArray(value)
    ? value.map((item) => {
      const sanitized = sanitizeRecord(asRecord(item));
      return { ...sanitized, id: reportValueToString(sanitized.id) };
    })
    : [];

const normalizeTeams = (
  value: ReportGameSource['teams'],
): Record<string, Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((item) => {
      const sanitized = sanitizeRecord(asRecord(item));
      const name = reportValueToString(sanitized.team || sanitized.id);
      return [name, sanitized];
    }).filter(([name]) => REPORT_TEAM_ORDER.includes(name as ReportTeamName)));
  }
  return Object.fromEntries(Object.entries(value || {}).map(([name, data]) => [name, sanitizeRecord(data)]));
};

const normalizeSource = (source: ReportGameSource) => {
  const workshop = sanitizeRecord({ ...(source.globalState || {}), ...(source.workshop || {}) });
  return {
    workshop: {
      ...workshop,
      id: source.id || reportValueToString(workshop.id),
      roomCode: source.roomCode || reportValueToString(workshop.roomCode),
      status: source.status || reportValueToString(workshop.status),
      createdAt: source.createdAt ?? workshop.createdAt,
      completedAt: source.completedAt ?? workshop.completedAt,
      client: source.client || reportValueToString(workshop.client),
      facilitator: source.facilitator || reportValueToString(workshop.facilitator),
      challenge: reportEntryToString(workshop.challenge),
    },
    teams: normalizeTeams(source.teams),
    attacks: normalizeDocuments(source.attacks),
    defenses: normalizeDocuments(source.defenses),
    solutions: normalizeDocuments(source.solutions),
  };
};

const emptyEditorial = (): ReportEditorial => ({
  executiveSummary: '',
  observations: '',
  nextSteps: '',
  teamOverrides: {},
});

const normalizeTeamEditorialOverrides = (
  value: ReportEditorial['teamOverrides'],
): NonNullable<ReportEditorial['teamOverrides']> => Object.fromEntries(
  REPORT_TEAM_ORDER.flatMap((team) => {
    const override = value?.[team];
    if (!override) return [];
    const selectedPerspective = reportEntryToString(override.selectedPerspective);
    const selectedSolution = reportEntryToString(override.selectedSolution);
    if (!selectedPerspective && !selectedSolution) return [];
    return [[team, {
      ...(selectedPerspective ? { selectedPerspective } : {}),
      ...(selectedSolution ? { selectedSolution } : {}),
    }]];
  }),
);

const createBaseRow = (workshop: Record<string, unknown>): Omit<ReportDataRow,
  'team' | 'phase' | 'category' | 'field' | 'index' | 'fromTeam' | 'toTeam' |
  'recordedAt' | 'recordId' | 'relatedId' | 'value'> => ({
  workshopId: reportValueToString(workshop.id),
  roomCode: reportValueToString(workshop.roomCode),
  status: workshop.status === 'completed' ? 'Completada' : reportValueToString(workshop.status),
  createdAt: formatReportTimestamp(workshop.createdAt),
  completedAt: resolveReportCompletionTimestamp(workshop),
  client: reportValueToString(workshop.client),
  facilitator: reportValueToString(workshop.facilitator),
  challenge: reportValueToString(workshop.challenge),
});

const pushRows = (
  rows: ReportDataRow[],
  base: ReturnType<typeof createBaseRow>,
  value: unknown,
  details: Partial<Pick<ReportDataRow,
    'team' | 'fromTeam' | 'toTeam' | 'recordedAt' | 'recordId' | 'relatedId' | 'index'>> &
    Pick<ReportDataRow, 'phase' | 'category' | 'field'>,
) => {
  const values = Array.isArray(value) ? value : [value];
  values.forEach((item, index) => {
    if (!isMeaningfulReportValue(item) && item !== 0 && item !== false) return;
    rows.push({
      ...base,
      team: details.team || '',
      phase: details.phase,
      category: details.category,
      field: details.field,
      index: details.index ?? (Array.isArray(value) ? String(index + 1) : ''),
      fromTeam: details.fromTeam || '',
      toTeam: details.toTeam || '',
      recordedAt: details.recordedAt || '',
      recordId: details.recordId || '',
      relatedId: details.relatedId || '',
      value: reportValueToString(item),
    });
  });
};

const buildRows = (
  workshop: Record<string, unknown>,
  teams: Record<string, Record<string, unknown>>,
  attacks: ReportSourceDocument[],
  defenses: ReportSourceDocument[],
  solutions: ReportSourceDocument[],
) => {
  const rows: ReportDataRow[] = [];
  const base = createBaseRow(workshop);
  if (isMeaningfulReportValue(workshop.challenge)) {
    pushRows(rows, base, workshop.challenge, {
      phase: 'General', category: 'Datos de partida', field: 'Reto principal',
    });
  }
  Object.entries(workshop).forEach(([field, value]) => {
    if (GLOBAL_METADATA_FIELDS.has(field) || REPORT_PRIVATE_FIELDS.has(field) || !isMeaningfulReportValue(value)) return;
    pushRows(rows, base, value, {
      phase: 'General', category: 'Configuración de partida', field,
    });
  });

  REPORT_TEAM_ORDER.forEach((team) => {
    const teamData = teams[team];
    if (!teamData) return;
    Object.entries(teamData).forEach(([field, value]) => {
      const reportValue = REPORT_ENTRY_FIELDS.has(field)
        ? sanitizeReportFieldValue(field, value)
        : value;
      if (TECHNICAL_TEAM_FIELDS.has(field) || REPORT_PRIVATE_FIELDS.has(field)
        || !isMeaningfulReportValue(reportValue)) return;
      const config = REPORT_FIELD_DEFINITIONS[field] || {
        phase: 'General', category: 'Otros datos del equipo', label: field,
      };
      pushRows(rows, base, reportValue, {
        team, phase: config.phase, category: config.category, field: config.label,
      });
    });
  });

  attacks.slice().sort((left, right) =>
    (reportTimestampToMillis(left.timestamp) || 0) - (reportTimestampToMillis(right.timestamp) || 0))
    .forEach((attack) => pushRows(rows, base, reportEntryToString(attack.content), {
      team: reportValueToString(attack.fromTeam),
      phase: 'Sublimar',
      category: 'Ataques registrados',
      field: 'Ataque enviado',
      fromTeam: reportValueToString(attack.fromTeam),
      toTeam: reportValueToString(attack.toTeam),
      recordedAt: formatReportTimestamp(attack.timestamp),
      recordId: reportValueToString(attack.id),
    }));

  defenses.slice().sort((left, right) =>
    (reportTimestampToMillis(left.timestamp) || 0) - (reportTimestampToMillis(right.timestamp) || 0))
    .forEach((defense) => pushRows(rows, base, reportEntryToString(defense.content), {
      team: reportValueToString(defense.team),
      phase: 'Sublimar',
      category: 'Defensas registradas',
      field: 'Defensa / mitigación',
      recordedAt: formatReportTimestamp(defense.timestamp),
      recordId: reportValueToString(defense.id),
      relatedId: reportValueToString(defense.attackId),
    }));

  solutions.slice().sort((left, right) =>
    (reportTimestampToMillis(left.timestamp) || 0) - (reportTimestampToMillis(right.timestamp) || 0))
    .forEach((solution) => pushRows(rows, base, reportEntryToString(solution.content), {
      team: reportValueToString(solution.team),
      phase: 'Conjugar',
      category: 'Soluciones compartidas',
      field: 'Solución definitiva compartida',
      recordedAt: formatReportTimestamp(solution.timestamp),
    }));
  return rows;
};

export const reportDatasetToCsvRows = (dataset: ReportDataset, includeHeader = true): string[][] => [
  ...(includeHeader ? [[...REPORT_CSV_HEADERS]] : []),
  ...dataset.rows.map((row) => [
    row.workshopId,
    row.roomCode,
    row.status,
    row.createdAt,
    row.completedAt,
    row.client,
    row.facilitator,
    row.challenge,
    row.team,
    row.phase,
    row.category,
    row.field,
    row.index,
    row.fromTeam,
    row.toTeam,
    row.recordedAt,
    row.recordId,
    row.relatedId,
    row.value,
  ]),
];

export const buildReportDataset = (
  source: ReportGameSource,
  editorial: Partial<ReportEditorial> = {},
): ReportDataset => {
  const normalized = normalizeSource(source);
  const attacks: ReportAttack[] = normalized.attacks.map((attack) => ({
    id: reportValueToString(attack.id),
    fromTeam: reportValueToString(attack.fromTeam),
    toTeam: reportValueToString(attack.toTeam),
    content: reportEntryToString(attack.content),
    recordedAt: formatReportTimestamp(attack.timestamp),
  })).filter((attack) => attack.content);
  const attackById = new Map(attacks.map((attack) => [attack.id, attack]));
  const canonicalDefenseByAttackId = new Map<string, ReportSourceDocument>();
  normalized.defenses.forEach((defense) => {
    const id = reportValueToString(defense.id);
    const attackId = reportValueToString(defense.attackId);
    const team = reportValueToString(defense.team);
    const attack = attackById.get(attackId);
    if (!id || !attack || team !== attack.toTeam
      || !isMeaningfulReportEntry(reportValueToString(defense.content))) return;

    const current = canonicalDefenseByAttackId.get(attackId);
    const candidateTimestamp = reportTimestampToMillis(defense.editedAt ?? defense.timestamp) || 0;
    const currentTimestamp = current
      ? reportTimestampToMillis(current.editedAt ?? current.timestamp) || 0
      : -1;
    const currentId = current ? reportValueToString(current.id) : '';
    if (!current
      || candidateTimestamp > currentTimestamp
      || (candidateTimestamp === currentTimestamp && id.localeCompare(currentId) > 0)) {
      canonicalDefenseByAttackId.set(attackId, defense);
    }
  });
  const canonicalDefenseDocuments = [...canonicalDefenseByAttackId.values()];
  const defenses: ReportDefense[] = canonicalDefenseDocuments.map((defense) => ({
    id: reportValueToString(defense.id),
    attackId: reportValueToString(defense.attackId),
    team: reportValueToString(defense.team),
    content: reportEntryToString(defense.content),
    recordedAt: formatReportTimestamp(defense.timestamp),
  })).filter((defense) => defense.content);
  const defenseByAttack = new Map(defenses.map((defense) => [defense.attackId, defense]));

  const teams = REPORT_TEAM_ORDER.map((name): ReportTeamDataset | null => {
    const data = normalized.teams[name];
    if (!data) return null;
    const perspectives = toTextArray(data.perspectives);
    const indexedTopPerspectives = toIndexedTextArray(data.top3Perspectives);
    const topPerspectives = indexedTopPerspectives.filter(Boolean);
    const solutions = toTextArray(data.solutions);
    const indexedTopSolutions = toIndexedTextArray(data.top3Solutions);
    const topSolutions = indexedTopSolutions.filter(Boolean);
    const additionalFields = Object.entries(data)
      .filter(([field, value]) => !TECHNICAL_TEAM_FIELDS.has(field)
        && !REPORT_PRIVATE_FIELDS.has(field)
        && !REPORT_FIELD_DEFINITIONS[field]
        && isMeaningfulReportValue(value))
      .map(([field, value]) => ({ field, label: field, value: reportValueToString(value) }));
    const contrasts = attacks.filter((attack) => attack.fromTeam === name || attack.toTeam === name)
      .map((attack) => {
        const defense = defenseByAttack.get(attack.id);
        return {
          attackId: attack.id,
          fromTeam: attack.fromTeam,
          toTeam: attack.toTeam,
          attack: attack.content,
          defense: defense?.content || '',
          attackRecordedAt: attack.recordedAt,
          defenseRecordedAt: defense?.recordedAt || '',
        };
      });
    return {
      name,
      currentPhase: reportValueToString(data.currentPhase),
      challenge: reportEntryToString(data.challenge),
      perspectives,
      topPerspectives,
      perspectiveVotes: toVotes(data.perspectiveVotes, indexedTopPerspectives),
      selectedPerspective: reportEntryToString(data.selectedPerspective),
      solutions,
      topSolutions,
      solutionVotes: toVotes(data.solutionVotes, indexedTopSolutions),
      selectedSolution: reportEntryToString(data.selectedSolution),
      contrasts,
      reformulatedSolution: reportEntryToString(data.reformulatedSolution),
      expectedResults: reportEntryToString(data.expectedResults),
      ferment: {
        audience: reportEntryToString(data.audience),
        strengths: toTextArray(data.strengths),
        weaknesses: toTextArray(data.weaknesses),
        pilot: reportEntryToString(data.pilot),
        resources: toTextArray(data.resources),
      },
      pitch: {
        complete: reportEntryToString(data.pitch),
        start: reportEntryToString(data.pitchStart),
        problem: reportEntryToString(data.pitchProblem),
        solution: reportEntryToString(data.pitchSolution),
        action: reportEntryToString(data.pitchAction),
      },
      finished: typeof data.isFinished === 'boolean' ? data.isFinished : null,
      additionalFields,
    };
  }).filter((team): team is ReportTeamDataset => team !== null);

  const workshop = normalized.workshop;
  const configuration = Object.entries(workshop)
    .filter(([field, value]) => !GLOBAL_METADATA_FIELDS.has(field)
      && !REPORT_PRIVATE_FIELDS.has(field)
      && isMeaningfulReportValue(value))
    .map(([field, value]) => ({ field, value: reportValueToString(value) }));
  const rows = buildRows(
    workshop,
    normalized.teams,
    normalized.attacks,
    canonicalDefenseDocuments,
    normalized.solutions,
  );
  return {
    version: '1.0.0',
    workshop: {
      id: reportValueToString(workshop.id),
      roomCode: reportValueToString(workshop.roomCode),
      status: reportValueToString(workshop.status),
      createdAt: formatReportTimestamp(workshop.createdAt),
      completedAt: resolveReportCompletionTimestamp(workshop),
      client: reportValueToString(workshop.client),
      facilitator: reportValueToString(workshop.facilitator),
      challenge: reportEntryToString(workshop.challenge),
      configuration,
    },
    metrics: {
      teams: teams.length,
      perspectives: teams.reduce((sum, team) => sum + team.perspectives.length, 0),
      prioritizedPerspectives: teams.reduce((sum, team) => sum + team.topPerspectives.length, 0),
      solutions: teams.reduce((sum, team) => sum + team.solutions.length, 0),
      prioritizedSolutions: teams.reduce((sum, team) => sum + team.topSolutions.length, 0),
      attacks: attacks.length,
      defenses: defenses.length,
      completedTeams: teams.filter((team) => team.finished === true).length,
    },
    teams,
    attacks,
    defenses,
    editorial: {
      ...emptyEditorial(),
      executiveSummary: reportEntryToString(editorial.executiveSummary),
      observations: reportEntryToString(editorial.observations),
      nextSteps: reportEntryToString(editorial.nextSteps),
      teamOverrides: normalizeTeamEditorialOverrides(editorial.teamOverrides),
    },
    rows,
  };
};

const splitLongText = (text: string, maxCharacters = 440): string[] => {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxCharacters) return [normalized];
  const parts: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxCharacters) {
    let cut = remaining.lastIndexOf(' ', maxCharacters);
    if (cut < Math.floor(maxCharacters * 0.6)) cut = maxCharacters;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
};

const estimateWrappedLines = (text: string, charactersPerLine = 80): number => text
  .split(/\r?\n/u)
  .reduce((total, line) => total + Math.max(1, Math.ceil(line.trim().length / charactersPerLine)), 0);

const estimateListLines = (item: string, charactersPerLine = 80): number =>
  estimateWrappedLines(item, charactersPerLine);

const paginateItems = (
  items: string[],
  maxItems = 10,
  maxCharacters = 1_400,
  maxEstimatedLines = 16,
): string[][] => {
  const normalized = items.flatMap((item) => splitLongText(item));
  if (normalized.length === 0) return [];
  const pages: string[][] = [];
  let current: string[] = [];
  let length = 0;
  let estimatedLines = 0;
  normalized.forEach((item) => {
    const itemLines = estimateListLines(item);
    if (current.length > 0 && (
      current.length >= maxItems
      || length + item.length > maxCharacters
      || estimatedLines + itemLines > maxEstimatedLines
    )) {
      pages.push(current);
      current = [];
      length = 0;
      estimatedLines = 0;
    }
    current.push(item);
    length += item.length;
    estimatedLines += itemLines;
  });
  if (current.length > 0) pages.push(current);
  return pages;
};

type ReportContrastBlock = Extract<ReportBlock, { kind: 'contrast' }>;

const estimateContrastHeight = (contrast: ReportContrastBlock): number => {
  const attackLines = Math.max(1, Math.ceil(contrast.attack.length / 38));
  const defenseLines = Math.max(1, Math.ceil(contrast.defense.length / 38));
  return 31 + 16 * Math.max(attackLines, defenseLines);
};

const paginateContrasts = (
  contrasts: ReportContrastBlock[],
  maxItems = 5,
  maxEstimatedHeight = 400,
  gap = 8,
): ReportContrastBlock[][] => {
  const pages: ReportContrastBlock[][] = [];
  let current: ReportContrastBlock[] = [];
  let estimatedHeight = 0;
  contrasts.forEach((contrast) => {
    const contrastHeight = estimateContrastHeight(contrast);
    const nextHeight = estimatedHeight + contrastHeight + (current.length > 0 ? gap : 0);
    if (current.length > 0 && (current.length >= maxItems || nextHeight > maxEstimatedHeight)) {
      pages.push(current);
      current = [];
      estimatedHeight = 0;
    }
    current.push(contrast);
    estimatedHeight += contrastHeight + (current.length > 1 ? gap : 0);
  });
  if (current.length > 0) pages.push(current);
  return pages;
};


const compactBlocks = (...blocks: Array<ReportBlock | null | false>): ReportBlock[] =>
  blocks.filter((block): block is ReportBlock => Boolean(block));

export const capitalizeFirstAlphabeticCharacter = (value: string): string => value.replace(
  /\p{L}/u,
  (letter) => letter.toLocaleUpperCase('es-ES'),
);

const REPORT_DISPLAY_TERMS: Record<string, string> = {
  API: 'API',
  CAIXA: 'Caixa',
  CAIXABANK: 'CaixaBank',
  CASTILLA: 'Castilla',
  CRM: 'CRM',
  CYL: 'CyL',
  DT: 'DT',
  FP: 'FP',
  GFS: 'GFS',
  HOLABANK: 'HolaBank',
  IA: 'IA',
  KPI: 'KPI',
  KPIS: 'KPIs',
  KREATUM: 'KREATUM',
  LEON: 'León',
  'LEÓN': 'León',
  NPS: 'NPS',
  PDF: 'PDF',
  PPTX: 'PPTX',
  REVOLUT: 'Revolut',
  ROI: 'ROI',
  RRSS: 'RRSS',
  TIKTOK: 'TikTok',
  UI: 'UI',
  UX: 'UX',
  YOUTUBE: 'YouTube',
};

const restoreReportDisplayTerms = (value: string): string => value.replace(
  /(?<![\p{L}\p{N}])(api|caixa(?:bank)?|castilla|crm|cyl|dt|fp|gfs|holabank|ia|kpis?|kreatum|le[oó]n|nps|pdf|pptx|revolut|roi|rrss|tiktok|ui|ux|youtube)(?![\p{L}\p{N}])/giu,
  (term) => REPORT_DISPLAY_TERMS[term.toLocaleUpperCase('es-ES')] || term,
);

export const sentenceCaseReportDisplay = (value: string): string => {
  const normalized = proofreadReportDisplay(value);
  if (!normalized) return '';
  const letters = normalized.match(/\p{L}/gu) || [];
  const uppercaseLetters = letters.filter((letter) => (
    letter === letter.toLocaleUpperCase('es-ES')
    && letter !== letter.toLocaleLowerCase('es-ES')
  )).length;
  const isMostlyUppercase = letters.length > 3 && uppercaseLetters / letters.length >= 0.75;
  const sentence = isMostlyUppercase ? normalized.toLocaleLowerCase('es-ES') : normalized;
  const capitalizedLines = sentence
    .split(/(\r?\n)/u)
    .map((segment, index) => (
      index % 2 === 0 && segment.trim()
        ? capitalizeFirstAlphabeticCharacter(segment)
        : segment
    ))
    .join('');
  const capitalizedSentences = capitalizedLines.replace(
    /([.!?]\s+)([¿¡\s"'“”‘’(]*)(\p{L})/gu,
    (_match, punctuation: string, prefix: string, letter: string) => (
      punctuation + prefix + letter.toLocaleUpperCase('es-ES')
    ),
  );
  return restoreReportDisplayTerms(capitalizedSentences);
};

const lowercaseFirstAlphabeticCharacter = (value: string): string => value.replace(
  /\p{L}/u,
  (letter) => letter.toLocaleLowerCase('es-ES'),
);

export const formatPerspectiveAsQuestion = (value: string): string => {
  let perspective = sentenceCaseReportDisplay(value)
    .replace(/^\s*[¿?]\s*/u, '')
    .replace(/[.?!…\s]+$/u, '')
    .trim();
  if (!perspective) return '';

  perspective = perspective
    .replace(/^c[oó]mo\s+podr[ií]amos\s+/iu, '')
    .replace(/^c[oó]mo\s+podemos\s+/iu, '')
    .replace(/^c[oó]mo\s+/iu, '');
  if (/^que\s+/iu.test(perspective)) {
    perspective = 'conseguir ' + lowercaseFirstAlphabeticCharacter(perspective);
  }
  perspective = perspective.replace(/^podemos\s+/iu, '');

  return sentenceCaseReportDisplay(
    '¿Cómo podríamos ' + lowercaseFirstAlphabeticCharacter(perspective) + '?',
  );
};

export const reportBlockEstimatedHeight = (block: ReportBlock): number => {
  if (block.kind === 'text') {
    const lines = estimateWrappedLines(block.text, block.prominent ? 68 : 80);
    return Math.max(block.prominent ? 120 : 76, 48 + lines * (block.prominent ? 26 : 18));
  }
  if (block.kind === 'list') {
    const lines = block.items.reduce((total, item) => total + estimateListLines(item), 0);
    return Math.max(76, 51 + lines * 18 + Math.max(0, block.items.length - 1) * 8);
  }
  if (block.kind === 'votes') return Math.max(76, 48 + block.items.length * 23);
  return 76;
};

const splitBlockForLayout = (block: ReportBlock): ReportBlock[] => {
  if (block.kind === 'text') {
    return splitLongText(block.text, 680).map((text) => ({ ...block, text }));
  }
  if (block.kind === 'list') {
    return paginateItems(block.items, 8, 900, 12).map((items) => ({ ...block, items }));
  }
  return [block];
};

const paginateContentBlocks = (
  blocks: ReportBlock[],
  maxEstimatedHeight = 370,
  gap = 12,
): ReportBlock[][] => {
  const expanded = blocks.flatMap(splitBlockForLayout);
  const pages: ReportBlock[][] = [];
  let current: ReportBlock[] = [];
  let currentHeight = 0;
  expanded.forEach((block) => {
    const height = reportBlockEstimatedHeight(block);
    const nextHeight = currentHeight + height + (current.length > 0 ? gap : 0);
    if (current.length > 0 && nextHeight > maxEstimatedHeight) {
      pages.push(current);
      current = [];
      currentHeight = 0;
    }
    current.push(block);
    currentHeight += height + (current.length > 1 ? gap : 0);
  });
  if (current.length > 0) pages.push(current);
  return pages;
};

const addContentBlockPages = (
  pages: Array<Omit<ReportDeckPage, 'pageNumber' | 'totalPages'>>,
  input: {
    kind?: ReportDeckPage['kind'];
    sectionId: string;
    section: string;
    title: string;
    subtitle?: string;
    team?: ReportTeamName;
    blocks: ReportBlock[];
  },
) => {
  const chunks = paginateContentBlocks(input.blocks);
  chunks.forEach((blocks, index) => pages.push({
    kind: input.kind || 'content',
    sectionId: input.sectionId,
    section: input.section,
    title: chunks.length > 1 ? `${input.title} · ${index + 1}/${chunks.length}` : input.title,
    subtitle: input.subtitle,
    team: input.team,
    blocks,
  }));
};

const hasEditorial = (editorial: ReportEditorial) =>
  Boolean(editorial.executiveSummary || editorial.observations || editorial.nextSteps);

const addListPages = (
  pages: Array<Omit<ReportDeckPage, 'pageNumber' | 'totalPages'>>,
  input: {
    sectionId: string;
    section: string;
    title: string;
    subtitle?: string;
    team?: ReportTeamName;
    items: string[];
    label?: string;
  },
) => {
  paginateItems(input.items).forEach((items, index, chunks) => pages.push({
    kind: 'content',
    sectionId: input.sectionId,
    section: input.section,
    title: chunks.length > 1 ? `${input.title} · ${index + 1}/${chunks.length}` : input.title,
    subtitle: input.subtitle,
    team: input.team,
    blocks: [{ kind: 'list', label: input.label, items, accent: input.team ? TEAM_COLORS[input.team] : undefined }],
  }));
};

export const buildReportDeck = (dataset: ReportDataset, templateVersion = '2.3.1'): ReportDeck => {
const addSectionPage = (
  pages: Array<Omit<ReportDeckPage, 'pageNumber' | 'totalPages'>>,
  input: { sectionId: string; number: string; title: string; subtitle: string },
) => pages.push({
  kind: 'section',
  sectionId: input.sectionId,
  section: `Secci\u00f3n ${input.number}`,
  title: input.title,
  subtitle: input.subtitle,
  blocks: [],
});

const hasPerspectiveContent = (team: ReportTeamDataset) => team.perspectives.length > 0;
const selectedPerspectiveFor = (team: ReportTeamDataset) => (
  dataset.editorial.teamOverrides?.[team.name]?.selectedPerspective || team.selectedPerspective
);
const selectedSolutionFor = (team: ReportTeamDataset) => (
  dataset.editorial.teamOverrides?.[team.name]?.selectedSolution || team.selectedSolution
);
const hasPerspectivePriorityContent = (team: ReportTeamDataset) => Boolean(
  team.topPerspectives.length || selectedPerspectiveFor(team) || team.perspectiveVotes.length,
);
const hasSolutionContent = (team: ReportTeamDataset) => team.solutions.length > 0;
const hasSolutionPriorityContent = (team: ReportTeamDataset) => Boolean(
  team.topSolutions.length || selectedSolutionFor(team) || team.solutionVotes.length,
);
const hasFinalContent = (team: ReportTeamDataset) => Boolean(
  selectedSolutionFor(team) || team.reformulatedSolution || team.expectedResults,
);
const hasPitchContent = (team: ReportTeamDataset) => Boolean(
  team.pitch.complete || team.pitch.start || team.pitch.problem || team.pitch.solution || team.pitch.action,
);

  const pages: Array<Omit<ReportDeckPage, 'pageNumber' | 'totalPages'>> = [];
  const coverTitle = sentenceCaseReportDisplay(dataset.workshop.challenge) || 'Informe de resultados';
  pages.push({
    kind: 'cover',
    sectionId: 'cover',
    section: 'Portada',
    title: coverTitle,
    subtitle: '',
    blocks: [
      { kind: 'text', label: 'Empresa contratante', text: dataset.workshop.client },
      { kind: 'text', label: 'Facilitador', text: dataset.workshop.facilitator },
    ].filter((block) => block.text) as ReportBlock[],
  });
  pages.push({
    kind: 'technical',
    sectionId: 'technical',
    section: 'Ficha técnica',
    title: 'Datos de la partida',
    blocks: [
      { kind: 'text', label: 'Reto', text: dataset.workshop.challenge },
      { kind: 'text', label: 'Facilitador', text: dataset.workshop.facilitator },
      { kind: 'text', label: 'Empresa contratante', text: dataset.workshop.client },
      { kind: 'text', label: 'Inicio', text: dataset.workshop.createdAt },
      { kind: 'text', label: 'Final', text: dataset.workshop.completedAt || 'No registrada' },
    ].filter((block) => block.text) as ReportBlock[],
  });
  addSectionPage(pages, {
    sectionId: 'metrics', number: '01', title: 'Volumen y trazabilidad',
    subtitle: 'Resumen cuantitativo del contenido registrado en la plataforma.',
  });
  pages.push({
    kind: 'metrics',
    sectionId: 'metrics',
    section: 'Métricas',
    title: 'La partida, en cifras',
    blocks: [{
      kind: 'metrics',
      items: [
        { label: 'Equipos', value: String(dataset.metrics.teams) },
        { label: 'Perspectivas', value: String(dataset.metrics.perspectives) },
        { label: 'Perspectivas priorizadas', value: String(dataset.metrics.prioritizedPerspectives) },
        { label: 'Soluciones', value: String(dataset.metrics.solutions) },
        { label: 'Soluciones priorizadas', value: String(dataset.metrics.prioritizedSolutions) },
        { label: 'Ataques', value: String(dataset.metrics.attacks) },
        { label: 'Defensas/mitigaciones', value: String(dataset.metrics.defenses) },
      ],
    }],
  });

  if (dataset.teams.some(hasPerspectiveContent)) {
    addSectionPage(pages, {
      sectionId: 'perspectives', number: '02', title: 'Nuevas perspectivas del reto',
      subtitle: 'Registro completo de los ángulos planteados por cada equipo.',
    });
    dataset.teams.filter(hasPerspectiveContent).forEach((team) => {
      addListPages(pages, {
        sectionId: 'perspectives', section: 'Perspectivas', title: `Equipo ${team.name}: perspectivas completas`,
        subtitle: team.challenge,
        team: team.name,
        items: team.perspectives.map(formatPerspectiveAsQuestion),
        label: 'Perspectivas registradas',
      });
    });
  }

  if (dataset.teams.some(hasPerspectivePriorityContent)) {
    addSectionPage(pages, {
      sectionId: 'priority', number: '03', title: 'Perspectivas priorizadas',
      subtitle: 'Preselección, votaciones y enfoque definitivo de cada equipo.',
    });
    dataset.teams.filter(hasPerspectivePriorityContent).forEach((team) => {
      pages.push({
        kind: 'content', sectionId: 'priority', section: 'Priorización y votos',
        title: `Equipo ${team.name}: perspectivas priorizadas`, team: team.name,
        blocks: [
          ...(team.topPerspectives.length ? [{ kind: 'list' as const, label: 'Preselección', items: team.topPerspectives.map(formatPerspectiveAsQuestion), ordered: true, accent: TEAM_COLORS[team.name] }] : []),
          ...(team.perspectiveVotes.length ? [{ kind: 'votes' as const, label: 'Votación', items: team.perspectiveVotes.map((vote) => ({ ...vote, option: formatPerspectiveAsQuestion(vote.option) })), accent: TEAM_COLORS[team.name] }] : []),
          ...(selectedPerspectiveFor(team) ? [{ kind: 'text' as const, label: 'Perspectiva definitiva', text: formatPerspectiveAsQuestion(selectedPerspectiveFor(team)), accent: TEAM_COLORS[team.name], prominent: true }] : []),
        ],
      });
    });
  }

  if (dataset.teams.some((team) => hasSolutionContent(team) || hasSolutionPriorityContent(team))) {
    addSectionPage(pages, {
      sectionId: 'solutions', number: '04', title: 'Soluciones generadas',
      subtitle: 'Propuestas registradas y opciones priorizadas por los equipos.',
    });
    dataset.teams.filter(hasSolutionContent).forEach((team) => {
      addListPages(pages, {
        sectionId: 'solutions', section: 'Soluciones', title: `Equipo ${team.name}: soluciones completas`,
        subtitle: formatPerspectiveAsQuestion(selectedPerspectiveFor(team)), team: team.name, items: team.solutions, label: 'Soluciones registradas',
      });
    });
    dataset.teams.filter(hasSolutionPriorityContent).forEach((team) => {
      pages.push({
        kind: 'content', sectionId: 'solutions', section: 'Priorización de soluciones',
        title: `Equipo ${team.name}: solución elegida`, team: team.name,
        blocks: [
          ...(team.topSolutions.length ? [{ kind: 'list' as const, label: 'Preselección', items: team.topSolutions, ordered: true, accent: TEAM_COLORS[team.name] }] : []),
          ...(team.solutionVotes.length ? [{ kind: 'votes' as const, label: 'Votación', items: team.solutionVotes, accent: TEAM_COLORS[team.name] }] : []),
          ...(selectedSolutionFor(team) ? [{ kind: 'text' as const, label: 'Solución definitiva', text: selectedSolutionFor(team), accent: TEAM_COLORS[team.name], prominent: true }] : []),
        ],
      });
    });
  }

  const uniqueContrasts = new Map<string, ReportContrast>();
  dataset.teams.flatMap((team) => team.contrasts).forEach((contrast) => {
    uniqueContrasts.set(contrast.attackId || `${contrast.fromTeam}-${contrast.toTeam}-${contrast.attack}`, contrast);
  });
  if (uniqueContrasts.size > 0) {
    addSectionPage(pages, {
      sectionId: 'contrast', number: '05', title: 'Ataques, defensas/mitigaciones y reformulación',
      subtitle: 'Contraste registrado entre equipos, sin síntesis ni contenido añadido.',
    });
  }
  uniqueContrasts.forEach((contrast) => {
    const attackParts = splitLongText(contrast.attack, 520);
    const defenseParts = splitLongText(contrast.defense, 520);
    const count = Math.max(attackParts.length, defenseParts.length, 1);
    for (let index = 0; index < count; index += 1) {
      pages.push({
        kind: 'content', sectionId: 'contrast', section: 'Contraste ataque / defensa/mitigación',
        title: `${contrast.fromTeam} desafía a ${contrast.toTeam}`,
        subtitle: count > 1 ? `Parte ${index + 1} de ${count}` : undefined,
        blocks: [{
          kind: 'contrast', fromTeam: contrast.fromTeam, toTeam: contrast.toTeam,
          attack: attackParts[index] || '', defense: defenseParts[index] || '',
          attackRecordedAt: contrast.attackRecordedAt, defenseRecordedAt: contrast.defenseRecordedAt,
        }],
      });
    }
  });

  const contrastPages = pages.filter((page) => page.sectionId === 'contrast' && page.kind === 'content');
  const contrastPageIndex = pages.findIndex((page) => page.sectionId === 'contrast' && page.kind === 'content');
  if (contrastPageIndex >= 0) {
    const groupedContrasts = paginateContrasts(contrastPages.flatMap((page) => page.blocks.filter(
      (block): block is ReportContrastBlock => block.kind === 'contrast',
    )));
    pages.splice(
      contrastPageIndex,
      contrastPages.length,
      ...groupedContrasts.map((blocks, index, chunks) => ({
        kind: 'content' as const,
        sectionId: 'contrast',
        section: 'Contraste ataque / defensa/mitigación',
        title: chunks.length > 1
          ? `Contraste del concepto \u00b7 ${index + 1}/${chunks.length}`
          : 'Contraste del concepto',
        blocks,
      })),
    );
  }

  const finalTeams = dataset.teams.filter(hasFinalContent);
  if (finalTeams.length > 0) {
    addSectionPage(pages, {
      sectionId: 'reformulation', number: '06', title: 'Soluciones finales documentadas',
      subtitle: 'Resultado final de cada equipo utilizando exclusivamente los campos guardados.',
    });
    finalTeams.forEach((team) => {
      const finalBlocks = compactBlocks(
        selectedSolutionFor(team) ? { kind: 'text', label: 'Solución definitiva', text: selectedSolutionFor(team), accent: TEAM_COLORS[team.name], prominent: true } : null,
        team.reformulatedSolution ? { kind: 'text', label: 'Solución reformulada', text: team.reformulatedSolution, accent: TEAM_COLORS[team.name] } : null,
        team.expectedResults ? { kind: 'text', label: 'Resultados esperados', text: team.expectedResults, accent: TEAM_COLORS[team.name] } : null,
      );
      addContentBlockPages(pages, {
        sectionId: 'reformulation', section: 'Reformulación y resultados',
        title: `Equipo ${team.name}: solución final`, team: team.name, blocks: finalBlocks,
      });
    });
  }

  const pitchTeams = dataset.teams.filter(hasPitchContent);
  if (pitchTeams.length > 0) {
    addSectionPage(pages, {
      sectionId: 'pitch', number: 'A1', title: 'Presentación final',
      subtitle: 'Campos de pitch registrados durante la partida.',
    });
    pitchTeams.forEach((team) => {
      const pitchBlocks = compactBlocks(
        team.pitch.complete ? { kind: 'text', label: 'Pitch completo', text: team.pitch.complete } : null,
        team.pitch.start ? { kind: 'text', label: '1. Captación', text: team.pitch.start } : null,
        team.pitch.problem ? { kind: 'text', label: '2. Acción', text: team.pitch.problem } : null,
        team.pitch.solution ? { kind: 'text', label: '3. Testeo', text: team.pitch.solution } : null,
        team.pitch.action ? { kind: 'text', label: '4. Conclusiones', text: team.pitch.action } : null,
      );
      addContentBlockPages(pages, {
        sectionId: 'pitch', section: 'Pitch', title: `Equipo ${team.name}: presentación final`,
        team: team.name, blocks: pitchBlocks,
      });
    });
  }

  if (hasEditorial(dataset.editorial)) addContentBlockPages(pages, {
    kind: 'editorial', sectionId: 'editorial', section: 'Anexo editorial',
    title: 'Anexo editorial opcional',
    subtitle: 'Contenido añadido por el facilitador. No forma parte de los datos registrados durante el workshop.',
    blocks: compactBlocks(
      dataset.editorial.executiveSummary ? { kind: 'text', label: 'Resumen ejecutivo', text: dataset.editorial.executiveSummary } : null,
      dataset.editorial.observations ? { kind: 'text', label: 'Observaciones', text: dataset.editorial.observations } : null,
      dataset.editorial.nextSteps ? { kind: 'text', label: 'Próximos pasos', text: dataset.editorial.nextSteps } : null,
    ),
  });
  pages.push({
    kind: 'closing', sectionId: 'closing', section: 'Cierre', title: 'KREATUM™',
    subtitle: 'Fin del informe',
    blocks: [],
  });


  const proofreadBlock = (block: ReportBlock): ReportBlock => {
    switch (block.kind) {
      case 'text':
        return { ...block, text: sentenceCaseReportDisplay(block.text) };
      case 'list':
        return { ...block, items: block.items.map(sentenceCaseReportDisplay) };
      case 'votes':
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            option: sentenceCaseReportDisplay(item.option),
          })),
        };
      case 'contrast':
        return {
          ...block,
          attack: sentenceCaseReportDisplay(block.attack),
          defense: sentenceCaseReportDisplay(block.defense),
        };
      case 'metrics':
        return block;
      default:
        return block;
    }
  };

  const totalPages = pages.length;
  return {
    templateVersion,
    title: 'Informe de resultados KREATUM™',
    roomCode: dataset.workshop.roomCode,
    pages: pages.map((page, index) => ({
      ...page,
      subtitle: page.subtitle ? sentenceCaseReportDisplay(page.subtitle) : page.subtitle,
      blocks: page.blocks.map(proofreadBlock),
      pageNumber: index + 1,
      totalPages,
    })),
  };
};

export const reportSourceFromSnapshotDocument = (value: unknown): ReportGameSource => {
  const document = asRecord(value);
  const snapshot = asRecord(document.snapshot || document);
  const workshop = asRecord(snapshot.workshop);
  const id = reportValueToString(workshop.id);
  if (!id) throw new Error('El snapshot no contiene un ID de partida válido.');
  return {
    id,
    roomCode: reportValueToString(workshop.roomCode),
    status: reportValueToString(workshop.status),
    createdAt: workshop.createdAt,
    completedAt: workshop.completedAt,
    client: reportValueToString(workshop.client),
    facilitator: reportValueToString(workshop.facilitator),
    workshop,
    teams: normalizeDocuments(snapshot.teams),
    attacks: normalizeDocuments(snapshot.attacks),
    defenses: normalizeDocuments(snapshot.defenses),
    solutions: normalizeDocuments(snapshot.solutions),
  };
};
