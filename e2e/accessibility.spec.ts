import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const assertNoSeriousAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const seriousViolations = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(seriousViolations).toEqual([]);
};

test.beforeEach(async ({ page }) => {
  await page.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com/, (route) => route.abort());
});

test('participant entry remains keyboard accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido a Kreatum' })).toBeVisible();
  const roomCode = page.getByLabel('Código de sala');
  await roomCode.fill('A');
  await roomCode.press('Enter');
  await expect(page.getByRole('alert')).toContainText('entre');
  await assertNoSeriousAccessibilityViolations(page);
});

test('admin login and unknown route have accessible landmarks', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Acceso Alquimista' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await assertNoSeriousAccessibilityViolations(page);

  await page.goto('/ruta-inexistente');
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
});

test('activation rejects invalid links accessibly and without horizontal overflow', async ({ page }) => {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/activar');
    await expect(page.getByRole('heading', { name: 'Invitación no disponible' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('enlace');
    const dimensions = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }
  await assertNoSeriousAccessibilityViolations(page);
});

test('participant entry has no horizontal overflow at supported widths', async ({ page }) => {
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const dimensions = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }
});