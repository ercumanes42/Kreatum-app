import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildGameCsvRows, type GameCsvRecord } from '../src/lib/gameCsv';
import {
  REPORT_TEAM_ORDER,
  buildReportDataset,
  buildReportDeck,
  reportDatasetToCsvRows,
} from './reporting';

const fixture: GameCsvRecord = {
  id: 'workshop-report-1',
  roomCode: 'ROBUSTA',
  status: 'completed',
  createdAt: 1_750_000_000_000,
  completedAt: 1_750_003_600_000,
  client: 'GFS',
  facilitator: 'Juan',
  globalState: {
    challenge: '¿Cómo mejorar la colaboración sin perder trazabilidad?',
    organizationId: 'private-org',
    createdBy: 'private-owner',
  },
  teams: {
    Agua: {
      team: 'Agua',
      playerId: 'private-participant',
      perspectives: ['Perspectiva uno', 'Perspectiva dos con ñ y emoji 🧪'],
      top3Perspectives: ['Perspectiva dos con ñ y emoji 🧪'],
      perspectiveVotes: [4],
      selectedPerspective: 'Perspectiva dos con ñ y emoji 🧪',
      solutions: ['Solución original'],
      top3Solutions: ['Solución original'],
      solutionVotes: { 'Solución original': 5 },
      selectedSolution: 'Solución original',
      reformulatedSolution: 'Solución reforzada',
      expectedResults: 'Resultado verificable',
      audience: 'Equipos internos',
      strengths: ['Claridad'],
      weaknesses: ['Tiempo'],
      pilot: 'Piloto de dos semanas',
      resources: ['Facilitación'],
      pitchStart: 'Una pregunta clara',
      pitchProblem: 'El problema observado',
      pitchSolution: 'La prueba propuesta',
      pitchAction: 'Medir y decidir',
      isFinished: true,
    },
    Aire: {
      team: 'Aire',
      perspectives: [],
      solutions: [],
    },
  },
  attacks: [{
    id: 'attack-1',
    fromTeam: 'Agua',
    toTeam: 'Aire',
    content: '¿Qué ocurre si no hay adopción?',
    timestamp: 1_750_002_000_000,
  }],
  defenses: [{
    id: 'defense-1',
    attackId: 'attack-1',
    team: 'Aire',
    content: 'Validación gradual con métricas.',
    timestamp: 1_750_002_100_000,
  }],
  solutions: [{
    id: 'solution-private-id',
    team: 'Agua',
    content: 'Solución original',
    timestamp: 1_750_001_500_000,
  }],
};

test('ReportDataset preserves the CSV functional contract exactly', () => {
  const dataset = buildReportDataset(fixture);
  assert.deepEqual(buildGameCsvRows(fixture), reportDatasetToCsvRows(dataset));
  assert.deepEqual(dataset.teams.map((team) => team.name), REPORT_TEAM_ORDER.slice(0, 2));
});

test('ReportDataset removes private identifiers and limits record IDs to attack/defense relations', () => {
  const dataset = buildReportDataset(fixture);
  const serialized = JSON.stringify(dataset);
  assert.equal(serialized.includes('private-org'), false);
  assert.equal(serialized.includes('private-owner'), false);
  assert.equal(serialized.includes('private-participant'), false);
  assert.equal(serialized.includes('solution-private-id'), false);
  assert.equal(serialized.includes('attack-1'), true);
  assert.equal(serialized.includes('defense-1'), true);
});

test('metrics and attack/defense relationships come only from recorded values', () => {
  const dataset = buildReportDataset(fixture);
  assert.deepEqual(dataset.metrics, {
    teams: 2,
    perspectives: 2,
    prioritizedPerspectives: 1,
    solutions: 1,
    prioritizedSolutions: 1,
    attacks: 1,
    defenses: 1,
    completedTeams: 1,
  });
  const contrast = dataset.teams.find((team) => team.name === 'Agua')?.contrasts[0];
  assert.equal(contrast?.attack, '¿Qué ocurre si no hay adopción?');
  assert.equal(contrast?.defense, 'Validación gradual con métricas.');
});
test('deleted attacks never shift an orphan defense onto the remaining attack', () => {
  const attacks = [
    {
      id: 'attack-a1',
      fromTeam: 'Agua',
      toTeam: 'Aire',
      content: 'Attack A1',
      timestamp: 1_750_002_000_000,
    },
    {
      id: 'attack-a2',
      fromTeam: 'Agua',
      toTeam: 'Aire',
      content: 'Attack A2',
      timestamp: 1_750_002_000_100,
    },
  ];
  const defenses = [
    {
      id: 'attack-a1',
      attackId: 'attack-a1',
      team: 'Aire',
      content: 'Defense D1 for A1',
      timestamp: 1_750_002_100_000,
    },
    {
      id: 'attack-a2',
      attackId: 'attack-a2',
      team: 'Aire',
      content: 'Defense D2 for A2',
      timestamp: 1_750_002_100_100,
    },
  ];
  const sourceAfterDeletingA1: GameCsvRecord = {
    ...fixture,
    teams: {
      ...fixture.teams,
      Aire: {
        ...fixture.teams.Aire,
        defenses: ['Legacy D1 by position', 'Legacy D2 by position'],
      },
    },
    attacks: attacks.filter((attack) => attack.id !== 'attack-a1'),
    defenses,
  };

  const dataset = buildReportDataset(sourceAfterDeletingA1);
  assert.deepEqual(dataset.attacks.map((attack) => attack.id), ['attack-a2']);
  assert.deepEqual(dataset.defenses.map((defense) => defense.attackId), ['attack-a2']);
  assert.equal(dataset.defenses[0]?.content, 'Defense D2 for A2');

  const contrasts = dataset.teams.flatMap((team) => team.contrasts)
    .filter((contrast) => contrast.attackId === 'attack-a2');
  assert.ok(contrasts.length > 0);
  assert.equal(contrasts.every((contrast) => contrast.defense === 'Defense D2 for A2'), true);

  const serialized = JSON.stringify(dataset);
  assert.equal(serialized.includes('Defense D1 for A1'), false);
  assert.equal(serialized.includes('Legacy D1 by position'), false);
  assert.equal(serialized.includes('Legacy D2 by position'), false);
  assert.equal(dataset.rows.some((row) => (
    row.relatedId === 'attack-a2' && row.value === 'Defense D2 for A2'
  )), true);
});


test('the latest linked defense wins without requiring legacy document IDs to match attack IDs', () => {
  const source: GameCsvRecord = {
    ...fixture,
    defenses: [
      {
        id: 'legacy-defense-old',
        attackId: 'attack-1',
        team: 'Aire',
        content: 'Original mitigation',
        timestamp: 1_750_002_100_000,
      },
      {
        id: 'legacy-defense-new',
        attackId: 'attack-1',
        team: 'Aire',
        content: 'Revised mitigation',
        timestamp: 1_750_002_200_000,
      },
    ],
  };

  const dataset = buildReportDataset(source);
  assert.equal(dataset.metrics.defenses, 1);
  assert.equal(dataset.defenses[0]?.id, 'legacy-defense-new');
  assert.equal(dataset.defenses[0]?.content, 'Revised mitigation');
  assert.equal(dataset.teams.flatMap((team) => team.contrasts)[0]?.defense, 'Revised mitigation');
  assert.equal(JSON.stringify(dataset).includes('Original mitigation'), false);
});

test('ReportDeck paginates long Unicode content and keeps the editorial appendix separate', () => {
  const longText = Array.from({ length: 180 }, (_, index) => `Bloque ${index + 1} con información útil áéíóú`).join(' ');
  const dataset = buildReportDataset({
    ...fixture,
    teams: {
      ...fixture.teams,
      Agua: { ...fixture.teams.Agua, perspectives: [longText] },
    },
  }, {
    executiveSummary: 'Resumen editorial',
    observations: 'Observación editorial',
    nextSteps: 'Próximo paso editorial',
  });
  const deck = buildReportDeck(dataset);
  const perspectivePages = deck.pages.filter((page) => page.sectionId === 'perspectives');
  assert.ok(perspectivePages.length > 1);
  const editorialPages = deck.pages.filter((page) => page.kind === 'editorial');
  assert.equal(editorialPages.length, 1);
  assert.match(editorialPages[0].subtitle || '', /No forma parte de los datos registrados/);
  assert.match(JSON.stringify(deck), /áéíóú/);
  assert.equal(deck.pages.every((page) => page.totalPages === deck.pages.length), true);
});

test('empty teams or sections do not create invented conclusions', () => {
  const dataset = buildReportDataset({
    ...fixture,
    teams: { Aire: { team: 'Aire' } },
    attacks: [],
    defenses: [],
    solutions: [],
  });
  const deck = buildReportDeck(dataset);
  assert.equal(deck.pages.some((page) => page.sectionId === 'contrast'), false);
  assert.equal(deck.pages.some((page) => page.kind === 'editorial'), false);
  assert.equal(JSON.stringify(deck).includes('conclusión alternativa'), false);
});
test('empty recorded values are omitted without fallback content', () => {
  const dataset = buildReportDataset({
    id: 'empty-workshop',
    roomCode: '',
    status: 'completed',
    teams: {
      Agua: { team: 'Agua', perspectiveVotes: [1, 2] },
    },
    attacks: [{ id: 'attack-empty-team', fromTeam: 'Agua', toTeam: '', content: 'Dato registrado' }],
    defenses: [],
    solutions: [],
  });
  const deck = buildReportDeck(dataset);
  const serialized = JSON.stringify(deck);
  assert.equal(serialized.includes('Workshop de'), false);
  assert.equal(serialized.includes('Sin contenido'), false);
  assert.equal(serialized.includes('otro equipo'), false);
  assert.equal(dataset.teams[0].perspectiveVotes.length, 0);
  const cover = deck.pages.find((page) => page.kind === 'cover');
  assert.equal(cover?.subtitle, '');
  assert.equal(cover?.blocks.length, 0);
});
test('ReportDeck follows the approved visible structure without exposing internal workshop fields', () => {
  const dataset = buildReportDataset({
    ...fixture,
    globalState: {
      ...fixture.globalState,
      challenge: 'CONSEGUIR QUE MÁS JÓVENES QUIERAN CONSTRUIR SU FUTURO',
      currentPhase: 'Sublimar',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir'],
    },
  });
  const deck = buildReportDeck(dataset);
  const cover = deck.pages.find((page) => page.kind === 'cover');
  assert.equal(cover?.title, 'Conseguir que más jóvenes quieran construir su futuro');
  assert.equal(cover?.blocks.some((block) => block.kind === 'text' && block.label === 'Código de sala'), false);
  assert.equal(cover?.blocks.some((block) => block.kind === 'text' && block.label === 'Empresa contratante'), true);

  const technical = deck.pages.find((page) => page.kind === 'technical');
  assert.deepEqual(
    technical?.blocks.map((block) => block.kind === 'text' ? block.label : ''),
    ['Reto', 'Facilitador', 'Empresa contratante', 'Inicio', 'Final'],
  );
  assert.equal(JSON.stringify(deck.pages).includes('ROBUSTA'), false);
  assert.equal(deck.pages.some((page) => page.kind === 'index'), false);
  assert.equal(JSON.stringify(deck.pages).includes('Contenido del informe'), false);

  const metricsPage = deck.pages.find((page) => page.kind === 'metrics');
  const metricBlock = metricsPage?.blocks.find((block) => block.kind === 'metrics');
  assert.ok(metricBlock?.kind === 'metrics');
  assert.deepEqual(metricBlock.items.map((item) => item.label), [
    'Equipos', 'Perspectivas', 'Perspectivas priorizadas', 'Soluciones',
    'Soluciones priorizadas', 'Ataques', 'Defensas/mitigaciones',
  ]);

  const sectionTitles = deck.pages.filter((page) => page.kind === 'section').map((page) => page.title);
  assert.deepEqual(sectionTitles.slice(0, 6), [
    'Volumen y trazabilidad', 'Nuevas perspectivas del reto', 'Perspectivas priorizadas',
    'Soluciones generadas', 'Ataques, defensas/mitigaciones y reformulación', 'Soluciones finales documentadas',
  ]);

  const perspectivesIndex = deck.pages.findIndex((page) => page.sectionId === 'perspectives');
  const priorityIndex = deck.pages.findIndex((page) => page.sectionId === 'priority');
  const solutionsIndex = deck.pages.findIndex((page) => page.sectionId === 'solutions');
  assert.ok(perspectivesIndex < priorityIndex && priorityIndex < solutionsIndex);
  const finalPage = deck.pages.find((page) => page.sectionId === 'reformulation' && page.kind === 'content');
  const finalSolution = finalPage?.blocks.find((block) => block.kind === 'text' && block.label === 'Solución definitiva');
  assert.equal(finalSolution?.kind === 'text' && finalSolution.prominent, true);
  assert.equal(deck.pages.at(-1)?.title, 'KREATUM™');
  assert.equal(deck.templateVersion, '2.2.0');
});

test('ReportDeck compacts repeated records without dropping stored content', () => {
  const attacks = Array.from({ length: 10 }, (_, index) => ({
    id: `compact-attack-${index + 1}`,
    fromTeam: 'Agua',
    toTeam: 'Aire',
    content: `Attack recorded ${index + 1}`,
    timestamp: 1_750_002_000_000 + index,
  }));
  const defenses = attacks.map((attack, index) => ({
    id: attack.id,
    attackId: attack.id,
    team: 'Aire',
    content: `Defense recorded ${index + 1}`,
    timestamp: 1_750_002_100_000 + index,
  }));
  const perspectives = Array.from(
    { length: 12 },
    (_, index) => `Perspective recorded ${index + 1}`,
  );
  const dataset = buildReportDataset({
    ...fixture,
    teams: {
      ...fixture.teams,
      Agua: { ...fixture.teams.Agua, perspectives },
    },
    attacks,
    defenses,
  });
  const deck = buildReportDeck(dataset);
  const perspectivePages = deck.pages.filter(
    (page) => page.sectionId === 'perspectives' && page.kind === 'content' && page.team === 'Agua',
  );
  const contrastPages = deck.pages.filter(
    (page) => page.sectionId === 'contrast' && page.kind === 'content',
  );
  assert.equal(perspectivePages.length, 2);
  assert.deepEqual(perspectivePages.map((page) => page.blocks[0].kind === 'list' ? page.blocks[0].items.length : 0), [10, 2]);
  assert.equal(contrastPages.length, 2);
  assert.deepEqual(contrastPages.map((page) => page.blocks.length), [5, 5]);
  const serialized = JSON.stringify(deck);
  attacks.forEach((attack) => assert.match(serialized, new RegExp(attack.content)));
  defenses.forEach((defense) => assert.match(serialized, new RegExp(defense.content)));
});
