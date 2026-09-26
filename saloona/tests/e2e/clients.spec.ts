import { expect, test } from '@playwright/test';

test('creating a client opens the new client page, and back returns to the list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start forfra' }).click();
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('button', { name: /Ny kunde/ }).click();
  await page.getByLabel('Navn').fill('Anne-Marie Østergaard');
  await page.getByLabel(/Telefon/).fill('12 34 56 78');
  await page.getByRole('button', { name: 'Opret kunde' }).click();
  await expect(page.getByRole('heading', { name: 'Anne-Marie Østergaard' })).toBeVisible();
  await expect(page.getByText('12 34 56 78')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Kunder' })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('an invalid phone number is rejected with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start forfra' }).click();
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('button', { name: /Ny kunde/ }).click();
  await page.getByLabel('Navn').fill('Bo');
  await page.getByLabel(/Telefon/).fill('tel:12;evil');
  await page.getByRole('button', { name: 'Opret kunde' }).click();
  await expect(page.getByText('Telefonnummeret ser forkert ud')).toBeVisible();
});
