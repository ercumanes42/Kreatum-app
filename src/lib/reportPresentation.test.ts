import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReportRecord } from '../../shared/contracts';
import {
  canRetryReportArtifacts,
  getReportStatusLabel,
  hasCompleteReportArtifacts,
} from './reportPresentation';

const artifact = {
  storagePath: 'organizations/org/workshops/workshop/reports/report.pdf',
  sha256: 'a'.repeat(64),
  size: 128,
  mimeType: 'application/pdf',
  generatedAt: 1,
  templateVersion: '2.1.1',
};

const report = (overrides: Partial<ReportRecord> = {}): ReportRecord => ({
  id: 'report-id',
  workshopId: 'workshop-id',
  organizationId: 'organization-id',
  templateVersion: '2.1.1',
  sourceSchemaVersion: 2,
  sourceSnapshotHash: 'b'.repeat(64),
  storagePath: artifact.storagePath.replace('.pdf', '.json'),
  status: 'draft',
  ...overrides,
});

test('a JSON-only snapshot is shown as pending and can be retried', () => {
  const jsonOnly = report({ artifacts: { json: { ...artifact, mimeType: 'application/json' } } });
  assert.equal(hasCompleteReportArtifacts(jsonOnly), false);
  assert.equal(getReportStatusLabel(jsonOnly), 'Archivos pendientes');
  assert.equal(canRetryReportArtifacts(jsonOnly, false), true);
});

test('an active or complete report cannot enqueue a duplicate retry', () => {
  const jsonOnly = report({ artifacts: { json: { ...artifact, mimeType: 'application/json' } } });
  const complete = report({
    artifacts: {
      json: { ...artifact, mimeType: 'application/json' },
      pdf: artifact,
      pptx: {
        ...artifact,
        storagePath: artifact.storagePath.replace('.pdf', '.pptx'),
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    },
  });
  assert.equal(canRetryReportArtifacts(jsonOnly, true), false);
  assert.equal(canRetryReportArtifacts(complete, false), false);
  assert.equal(getReportStatusLabel(complete), 'Listo');
});
