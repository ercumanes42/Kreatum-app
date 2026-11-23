import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  isMeaningfulReportEntry,
  proofreadReportDisplay,
  sanitizeReportEntry,
  sanitizeReportList,
} from './reportText';
import { buildReportDataset } from './reporting';

test('report entries reject empty, punctuation-only and isolated numeric placeholders', () => {
  ['', '   ', '.', '...', '-', '--', '—', '•', 'I', '1', '1.', '2026', '✅'].forEach((value) => {
    assert.equal(sanitizeReportEntry(value), '', value);
    assert.equal(isMeaningfulReportEntry(value), false, value);
  });
});

test('customer-facing proofreading fixes high-confidence Spanish errors and spacing', () => {
  assert.equal(
    proofreadReportDisplay('  MEJORAR COMUNICACION., REFERENTE EN TECNOLGIA Y DIR¡FERENCIACION  '),
    'MEJORAR COMUNICACIÓN. REFERENTE EN TECNOLOGÍA Y DIFERENCIACIÓN',
  );
  assert.equal(
    proofreadReportDisplay('clientesn (no clientes)para captar mas jovenes con tecnologia. asi evitamos un trendingtopic'),
    'clientes (no clientes) para captar más jóvenes con tecnología. así evitamos un trending topic',
  );
  assert.equal(
    proofreadReportDisplay('COMUNICAR FACIL, FOMENTAR LA TECNOLOGIA Y MEJORAR LA CAPTACION EN EL AMBITO PUBLICO'),
    'COMUNICAR FÁCIL, FOMENTAR LA TECNOLOGÍA Y MEJORAR LA CAPTACIÓN EN EL ÁMBITO PÚBLICO',
  );
  assert.equal(
    proofreadReportDisplay('movil, opcion, origenes, autonomos, metodos, paginas y espectaculos'),
    'móvil, opción, orígenes, autónomos, métodos, páginas y espectáculos',
  );
  assert.equal(
    proofreadReportDisplay('Se da por echo. Fuente no valida. ¿Por que no? Explicamos el pq.'),
    'Se da por hecho. Fuente no válida. ¿Por qué no? Explicamos el porqué.',
  );
  assert.equal(proofreadReportDisplay('PROMOCION Y PROMOCIONES'), 'PROMOCIÓN Y PROMOCIONES');
});

test('customer-facing proofreading does not invent or rewrite the underlying idea', () => {
  assert.equal(
    proofreadReportDisplay('FOMENTAR LA TECNOLOGIA EN ENTORNOS RURALES'),
    'FOMENTAR LA TECNOLOGÍA EN ENTORNOS RURALES',
  );
  assert.equal(
    proofreadReportDisplay('JOVENES CAPTANDO A JOVENES'),
    'JÓVENES CAPTANDO A JÓVENES',
  );
});

test('report entries remove duplicated list markers and blank lines', () => {
  assert.deepEqual(sanitizeReportList([
    '-humanizar el neobanco\n--capacidad de llegada\n\n• seguridad',
  ]), ['Humanizar el neobanco', 'Capacidad de llegada', 'Seguridad']);
  assert.equal(sanitizeReportEntry('  -  • -- precios competitivos  '), 'Precios competitivos');
});

test('report entries capitalize the first visible letter without destroying original casing', () => {
  assert.equal(
    sanitizeReportEntry('¿cómo mejorar DT, CYL y rr ss?'),
    '¿Cómo mejorar DT, CYL y rr ss?',
  );
  assert.equal(
    sanitizeReportEntry('HACER PILOTO CON DT Y CYL'),
    'HACER PILOTO CON DT Y CYL',
  );
  assert.equal(sanitizeReportEntry('DT'), 'DT');
  assert.equal(sanitizeReportEntry('IA'), 'IA');
  assert.equal(sanitizeReportEntry('10%'), '10%');
  assert.equal(sanitizeReportEntry('—No cambiaremos DT'), '—No cambiaremos DT');
  assert.equal(sanitizeReportEntry('24/7 con soporte'), '24/7 Con soporte');
});

test('ReportDataset omits placeholder records before metrics, rows and deck generation', () => {
  const dataset = buildReportDataset({
    id: 'editorial-sanitization',
    status: 'completed',
    globalState: { challenge: '¿cómo mejorar DT y rr ss?' },
    teams: {
      Agua: {
        team: 'Agua',
        perspectives: ['.', '--', '2026', '- idea válida'],
        top3Perspectives: ['.', '- candidata válida'],
        perspectiveVotes: [9, 4],
        strengths: '-humanizar el neobanco\n--capacidad en CYL',
        weaknesses: '---',
        pilot: 'HACER PILOTO CON DT',
        resources: '1',
      },
    },
    attacks: [
      { id: 'noise-attack', fromTeam: 'Agua', toTeam: 'Aire', content: '.', timestamp: 1 },
      { id: 'valid-attack', fromTeam: 'Agua', toTeam: 'Aire', content: '- barrera real', timestamp: 2 },
    ],
    defenses: [
      { id: 'noise-defense', attackId: 'valid-attack', team: 'Aire', content: '-', timestamp: 3 },
    ],
    solutions: [],
  });

  assert.equal(dataset.workshop.challenge, '¿Cómo mejorar DT y rr ss?');
  assert.deepEqual(dataset.teams[0]?.perspectives, ['Idea válida']);
  assert.deepEqual(dataset.teams[0]?.topPerspectives, ['Candidata válida']);
  assert.deepEqual(dataset.teams[0]?.perspectiveVotes, [
    { option: 'Candidata válida', votes: 4 },
  ]);
  assert.deepEqual(dataset.teams[0]?.ferment, {
    audience: '',
    strengths: ['Humanizar el neobanco', 'Capacidad en CYL'],
    weaknesses: [],
    pilot: 'HACER PILOTO CON DT',
    resources: [],
  });
  assert.deepEqual(dataset.attacks.map(({ id, content }) => ({ id, content })), [
    { id: 'valid-attack', content: 'Barrera real' },
  ]);
  assert.equal(dataset.metrics.attacks, 1);
  assert.equal(dataset.metrics.defenses, 0);
  assert.equal(dataset.rows.some((row) => ['.', '-', '--', '2026', '1'].includes(row.value)), false);
});

test('sanitizing ranked options preserves perspective and solution vote positions', () => {
  const dataset = buildReportDataset({
    id: 'ranked-option-sanitization',
    status: 'completed',
    teams: {
      Agua: {
        team: 'Agua',
        top3Perspectives: ['Perspectiva uno', '.', 'Perspectiva tres'],
        perspectiveVotes: [3, 2, 4],
        top3Solutions: ['Solución uno', '-', 'Solución tres'],
        solutionVotes: [5, 1, 7],
      },
    },
    attacks: [],
    defenses: [],
    solutions: [],
  });

  assert.deepEqual(dataset.teams[0]?.topPerspectives, [
    'Perspectiva uno',
    'Perspectiva tres',
  ]);
  assert.deepEqual(dataset.teams[0]?.perspectiveVotes, [
    { option: 'Perspectiva uno', votes: 3 },
    { option: 'Perspectiva tres', votes: 4 },
  ]);
  assert.deepEqual(dataset.teams[0]?.topSolutions, [
    'Solución uno',
    'Solución tres',
  ]);
  assert.deepEqual(dataset.teams[0]?.solutionVotes, [
    { option: 'Solución uno', votes: 5 },
    { option: 'Solución tres', votes: 7 },
  ]);
});
