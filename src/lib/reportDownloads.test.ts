import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProtectedReportDownload } from './reportDownloads';

test('prepares a direct signed Storage download without a cross-origin fetch', () => {
  const target = prepareProtectedReportDownload(
    'https://storage.googleapis.com/staging-bucket/reports/report.pdf?signature=test',
    'Informe final',
    'pdf',
  );

  assert.equal(
    target.href,
    'https://storage.googleapis.com/staging-bucket/reports/report.pdf?signature=test',
  );
  assert.equal(target.downloadName, 'Informe_final.pdf');
});

test('keeps the existing extension and rejects untrusted download hosts', () => {
  assert.equal(
    prepareProtectedReportDownload(
      'https://storage.googleapis.com/staging-bucket/report.pptx?signature=test',
      'Kreatum_report.pptx',
      'pptx',
    ).downloadName,
    'Kreatum_report.pptx',
  );
  assert.throws(
    () => prepareProtectedReportDownload(
      'https://example.invalid/report.pdf',
      'report',
      'pdf',
    ),
    /Invalid authorized report URL/,
  );
});
