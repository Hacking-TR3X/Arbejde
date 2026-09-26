import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../fixtures/salonbog-backup.json', import.meta.url));

/** Every test runs in a new browser context, so storage starts empty. */
async function fresh(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function importFixture(page: Page) {
  await page.getByRole('button', { name: 'Hent fra backup' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Vælg backup-fil' }).click()]);
  await chooser.setFiles(fixture);
  await expect(page.getByText(/kunder og .* besøg/)).toBeVisible();
  await page.getByRole('button', { name: 'Hent backup' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  (page as Page & { errors?: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  const errors = (page as Page & { errors?: string[] }).errors ?? [];
  expect(errors, 'no console errors or CSP violations').toEqual([]);
});

test('first start offers import or a fresh start', async ({ page }) => {
  await fresh(page);
  await expect(page.getByRole('heading', { name: 'Din kundebog' })).toBeVisible();
  await page.getByRole('button', { name: 'Start forfra' }).click();
  await expect(page.getByText('Tryk på + nederst for at registrere det første besøg.')).toBeVisible();
});

test('imports a Salonbog prototype backup', async ({ page }) => {
  await fresh(page);
  await importFixture(page);
  await page.getByRole('button', { name: 'Kunder' }).click();
  await expect(page.getByRole('button', { name: /Holger/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Theo.*Barn/ })).toBeVisible();
});

test('a regular client visit can be registered in a few taps', async ({ page }) => {
  await fresh(page);
  await importFixture(page);
  const started = Date.now();
  await page.getByRole('button', { name: 'Nyt besøg' }).click(); // 1
  await page.locator('.sheet .suggest .chip').first().click(); // 2
  await expect(page.getByLabel('Beløb')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Gem besøg' }).click(); // 3
  await expect(page.getByText(/Besøg for .* er gemt/)).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10_000);
});

test('a future date books an appointment', async ({ page }) => {
  await fresh(page);
  await importFixture(page);
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('textbox', { name: 'Kunde' }).fill('Ny Kunde');
  await page.getByRole('radio', { name: 'Dame' }).click();
  await page.getByLabel('Behandling').fill('Klip');
  await page.getByRole('radio', { name: /Anden dag/ }).click();
  await page.getByLabel('Vælg dato').fill('2099-01-15');
  await expect(page.getByRole('button', { name: 'Book aftale' })).toBeVisible();
  await page.getByRole('button', { name: 'Book aftale' }).click();
  await expect(page.getByText('Aftale med Ny Kunde er booket')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Kommende aftaler/ })).toBeVisible();
});

test('swiping a visit away deletes it, and Fortryd brings it back', async ({ page }) => {
  await fresh(page);
  await importFixture(page);
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('button', { name: /Holger/ }).click();
  const rows = page.locator('.hist');
  const before = await rows.count();
  const box = await page.locator('.swipe').first().boundingBox();
  if (!box) throw new Error('no row');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, y, { steps: 10 });
  await page.mouse.up();
  await expect(rows).toHaveCount(before - 1);
  await page.getByRole('button', { name: 'Fortryd' }).click();
  await expect(rows).toHaveCount(before);
});

test('a visit can be deleted from its edit sheet', async ({ page }) => {
  await fresh(page);
  await importFixture(page);
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('button', { name: /Holger/ }).click();
  const rows = page.locator('.hist');
  const before = await rows.count();
  await rows.first().click();
  await page.getByRole('dialog').getByRole('button', { name: /Slet besøg/ }).click();
  await expect(rows).toHaveCount(before - 1);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('back navigation closes the sheet before leaving the page', async ({ page }) => {
  await fresh(page);
  await importFixture(page);
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('button', { name: /Holger/ }).click();
  await page.getByRole('button', { name: 'Registrér besøg' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Holger' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Kunder' })).toBeVisible();
});
