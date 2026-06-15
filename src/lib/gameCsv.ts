import { Team } from '../types';

export interface GameExportDocument {
  id: string;
  [key: string]: unknown;
}

export interface GameCsvRecord {
  id: string;
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

const TEAM_ORDER: Team[] = ['Agua', 'Aire', 'Fuego', 'Tierra'];

const CSV_HEADERS = [
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
];

const GLOBAL_METADATA_FIELDS = new Set([
  'roomCode',
  'status',
  'createdAt',
  'completedAt',
  'client',
  'facilitator',
  'challenge',
]);

const TECHNICAL_TEAM_FIELDS = new Set([
  'team',
  'playerId',
  'memberIds',
  'createdAt',
  'updatedAt',
  'assignmentResetAt',
]);

const TEAM_FIELD_CONFIG: Record<string, { phase: string; category: string; label: string }> = {
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

const toMillis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return null;
};

const formatTimestamp = (value: unknown) => {
  const timestamp = toMillis(value);
  if (timestamp === null || timestamp <= 0) return '';
  return new Date(timestamp).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const isMeaningful = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isMeaningful);
  return true;
};

const formatValue = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
};

const getMainChallenge = (game: GameCsvRecord) => formatValue(game.globalState.challenge);

const createBaseRow = (game: GameCsvRecord) => [
  game.id,
  game.roomCode,
  game.status === 'completed' ? 'Completada' : 'Activa',
  formatTimestamp(game.createdAt),
  formatTimestamp(game.completedAt),
  game.client || formatValue(game.globalState.client),
  game.facilitator || formatValue(game.globalState.facilitator),
  getMainChallenge(game),
];

const pushValueRows = (
  rows: string[][],
  base: string[],
  value: unknown,
  details: {
    team?: string;
    phase: string;
    category: string;
    field: string;
    fromTeam?: string;
    toTeam?: string;
    timestamp?: unknown;
    recordId?: string;
    relatedId?: string;
    index?: string;
  },
) => {
  const values = Array.isArray(value) ? value : [value];
  values.forEach((item, index) => {
    if (!isMeaningful(item) && item !== 0 && item !== false) return;
    rows.push([
      ...base,
      details.team || '',
      details.phase,
      details.category,
      details.field,
      details.index ?? (Array.isArray(value) ? String(index + 1) : ''),
      details.fromTeam || '',
      details.toTeam || '',
      formatTimestamp(details.timestamp),
      details.recordId || '',
      details.relatedId || '',
      formatValue(item),
    ]);
  });
};

export const buildGameCsvRows = (game: GameCsvRecord, includeHeader = true): string[][] => {
  const rows: string[][] = includeHeader ? [CSV_HEADERS] : [];
  const base = createBaseRow(game);

  if (isMeaningful(game.globalState.challenge)) {
    pushValueRows(rows, base, game.globalState.challenge, {
      phase: 'General',
      category: 'Datos de partida',
      field: 'Reto principal',
    });
  }

  Object.entries(game.globalState).forEach(([field, value]) => {
    if (GLOBAL_METADATA_FIELDS.has(field) || !isMeaningful(value)) return;
    pushValueRows(rows, base, value, {
      phase: 'General',
      category: 'Configuración de partida',
      field,
    });
  });

  TEAM_ORDER.forEach((team) => {
    const teamData = game.teams[team];
    if (!teamData) return;

    Object.entries(teamData).forEach(([field, value]) => {
      if (TECHNICAL_TEAM_FIELDS.has(field) || !isMeaningful(value)) return;
      const config = TEAM_FIELD_CONFIG[field] || {
        phase: 'General',
        category: 'Otros datos del equipo',
        label: field,
      };

      if (field === 'defenses' && Array.isArray(value)) {
        const receivedAttacks = game.attacks
          .filter((attack) => attack.toTeam === team)
          .sort((a, b) => (toMillis(a.timestamp) || 0) - (toMillis(b.timestamp) || 0));
        value.forEach((defense, index) => {
          const relatedAttack = receivedAttacks[index];
          pushValueRows(rows, base, defense, {
            team,
            phase: config.phase,
            category: config.category,
            field: config.label,
            fromTeam: formatValue(relatedAttack?.fromTeam),
            toTeam: team,
            timestamp: relatedAttack?.timestamp,
            relatedId: relatedAttack?.id,
            index: String(index + 1),
          });
        });
        return;
      }

      pushValueRows(rows, base, value, {
        team,
        phase: config.phase,
        category: config.category,
        field: config.label,
      });
    });
  });

  [...game.attacks]
    .sort((a, b) => (toMillis(a.timestamp) || 0) - (toMillis(b.timestamp) || 0))
    .forEach((attack) => {
      pushValueRows(rows, base, attack.content, {
        team: formatValue(attack.fromTeam),
        phase: 'Sublimar',
        category: 'Ataques registrados',
        field: 'Ataque enviado',
        fromTeam: formatValue(attack.fromTeam),
        toTeam: formatValue(attack.toTeam),
        timestamp: attack.timestamp,
        recordId: attack.id,
      });
    });

  [...game.defenses]
    .sort((a, b) => (toMillis(a.timestamp) || 0) - (toMillis(b.timestamp) || 0))
    .forEach((defense) => {
      pushValueRows(rows, base, defense.content, {
        team: formatValue(defense.team),
        phase: 'Sublimar',
        category: 'Defensas registradas',
        field: 'Defensa / mitigación',
        timestamp: defense.timestamp,
        recordId: defense.id,
        relatedId: formatValue(defense.attackId),
      });
    });

  [...game.solutions]
    .sort((a, b) => (toMillis(a.timestamp) || 0) - (toMillis(b.timestamp) || 0))
    .forEach((solution) => {
      pushValueRows(rows, base, solution.content, {
        team: formatValue(solution.team),
        phase: 'Conjugar',
        category: 'Soluciones compartidas',
        field: 'Solución definitiva compartida',
        timestamp: solution.timestamp,
        recordId: solution.id,
      });
    });

  return rows;
};

export const buildGamesCsvRows = (games: GameCsvRecord[]): string[][] => [
  CSV_HEADERS,
  ...games.flatMap((game) => buildGameCsvRows(game, false)),
];

export const serializeCsv = (rows: string[][]) => rows
  .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
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
