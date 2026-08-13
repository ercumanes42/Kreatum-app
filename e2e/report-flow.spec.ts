import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const email = 'report-owner@example.test';
const password = 'ReportOwner123!';

test.skip(
  process.env.VITE_FIREBASE_USE_EMULATORS !== 'true',
  'The report flow requires isolated Firebase emulators.',
);

test('owner generates, downloads and publishes an immutable report version', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar al Panel' }).click();

  await expect(page.getByRole('heading', { name: 'Panel del Alquimista' }))
    .toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Ver Historial' }).click();
  await expect(page.getByRole('heading', { name: 'Historial de Partidas' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir partida E2E123' }).click();

  await expect(page.getByRole('heading', { name: 'Informes' })).toBeVisible();
  await page.getByRole('button', { name: 'Generar nueva versión' }).click();
  await expect(page.getByText(/Informe en cola/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Informe generado correctamente.', { exact: true }))
    .toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('Listo', { exact: true }).first()).toBeVisible();

  const downloadArtifact = async (name: 'PDF' | 'PPTX') => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name }).click(),
    ]);
    expect(download.suggestedFilename().toLowerCase().endsWith(`.${name.toLowerCase()}`)).toBe(true);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const bytes = await readFile(downloadedPath!);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, name === 'PDF' ? 4 : 2).toString('ascii'))
      .toBe(name === 'PDF' ? '%PDF' : 'PK');
  };

  await downloadArtifact('PDF');
  await downloadArtifact('PPTX');

  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Publicar versión' })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar informe' }).click();
  await expect(page.getByRole('status')).toContainText('Informe publicado correctamente.', { timeout: 60_000 });
  await expect(page.getByText('Publicado', { exact: true })).toBeVisible();

  await downloadArtifact('PDF');
  await downloadArtifact('PPTX');
});
