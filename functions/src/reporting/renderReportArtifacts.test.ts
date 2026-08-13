import { strict as assert } from 'node:assert';
import test from 'node:test';
import JSZip from 'jszip';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import {
  buildReportDataset,
  buildReportDeck,
  type ReportGameSource,
} from '../../../shared/reporting.js';
import { loadReportAssets, renderReportPdf, renderReportPptx } from './renderReportArtifacts.js';

const source: ReportGameSource = {
  id: 'workshop-document-test',
  roomCode: 'DOC123',
  status: 'completed',
  createdAt: 1_750_000_000_000,
  completedAt: 1_750_003_600_000,
  client: 'Cliente de prueba',
  facilitator: 'Facilitador',
  workshop: {
    challenge: 'Cómo hacer que el calentamiento global no acabe con el planeta',
  },
  teams: {
    Agua: {
      team: 'Agua',
      perspectives: ['Primera perspectiva', 'Segunda perspectiva'],
      top3Perspectives: ['Primera perspectiva'],
      perspectiveVotes: [3],
      selectedPerspective: 'Primera perspectiva',
      solutions: ['Solución medible'],
      selectedSolution: 'Solución medible',
      reformulatedSolution: 'Solución medible reforzada',
      expectedResults: 'Resultado esperado verificable',
      activeParticipantId: 'private-participant',
      activeParticipantHash: 'private-hash',
      lastHeartbeatAt: 'private-heartbeat',
      transitionAckId: 'private-transition',
      isFinished: true,
    },
  },
  attacks: Array.from({ length: 6 }, (_, index) => ({
    id: `attack-${index + 1}`,
    fromTeam: 'Agua' as const,
    toTeam: 'Aire' as const,
    content: `Attack recorded ${index + 1}`,
  })),
  defenses: Array.from({ length: 6 }, (_, index) => ({
    id: `defense-${index + 1}`,
    attackId: `attack-${index + 1}`,
    team: 'Aire' as const,
    content: `Defense recorded ${index + 1}`,
  })),
  solutions: [],
};

test('PDF and PPTX are valid documents with identical page/slide order', async () => {
  const dataset = buildReportDataset(source, {
    executiveSummary: 'Resumen editorial claramente identificado.',
    observations: '',
    nextSteps: 'Siguiente paso editorial.',
  });
  const deck = buildReportDeck(dataset);
  const exactChallenge = 'Cómo hacer que el calentamiento global no acabe con el planeta';
  assert.equal(deck.pages[0]?.title, exactChallenge);
  assert.equal(deck.pages.some((page) => page.sectionId === 'traceability'), false);
  const assets = await loadReportAssets();
  assert.ok(assets.logo);
  assert.ok(assets.teams.Agua);
  assert.ok(assets.fonts.regular);
  assert.ok(assets.fonts.semibold);
  assert.ok(assets.fonts.bold);
  const [pdfBuffer, pptxBuffer] = await Promise.all([
    renderReportPdf(deck, assets),
    renderReportPptx(deck, assets),
  ]);

  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(pptxBuffer.subarray(0, 2).toString('ascii'), 'PK');

  const pdf = await PdfLibDocument.load(pdfBuffer);
  assert.equal(pdf.getPageCount(), deck.pages.length);

  const archive = await JSZip.loadAsync(pptxBuffer);
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  assert.equal(slideNames.length, deck.pages.length);
  assert.ok(archive.file('[Content_Types].xml'));
  assert.ok(archive.file('ppt/presentation.xml'));
  const themeXml = await archive.file('ppt/theme/theme1.xml')?.async('string');
  assert.ok(themeXml);
  assert.match(themeXml, /Montserrat/);

  const slideXml = await Promise.all(slideNames.map((name) => archive.file(name)?.async('string')));
  const joined = slideXml.join('\n');
  assert.match(joined, new RegExp(exactChallenge));
  for (const forbidden of [
    'Otros datos registrados',
    'Trazabilidad funcional',
    'ActiveParticipantId',
    'ActiveParticipantHash',
    'LastHeartbeatAt',
    'TransitionAckId',
  ]) assert.equal(joined.includes(forbidden), false);
  assert.match(joined, /Informe de resultados KREATUM/);
  assert.match(joined, /Anexo editorial opcional/);
  assert.match(joined, /Fin del informe/);
  assert.match(joined, /Volumen y trazabilidad/);
  assert.match(joined, /Soluciones finales documentadas/);
  assert.match(joined, /DEFENSA \/ MITIGACIÓN/);
  assert.equal(joined.includes('DOC123'), false);
  assert.equal(joined.includes('Contenido del informe'), false);
});
