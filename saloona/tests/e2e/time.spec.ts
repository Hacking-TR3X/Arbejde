import { expect, test } from '@playwright/test';

test('a booked appointment can have a time, shown in Kommende aftaler and on the client page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start forfra' }).click();
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('textbox', { name: 'Kunde' }).fill('Tidskunde');
  await page.getByLabel('Behandling').fill('Klip');
  await page.getByRole('radio', { name: /Anden dag/ }).click();
  await page.getByLabel('Vælg dato').fill('2099-01-15');
  await page.getByLabel(/Tidspunkt/).fill('14:30');
  await page.getByRole('button', { name: 'Book aftale' }).click();
  await expect(page.getByText(/Aftale med Tidskunde er booket .* kl\. 14\.30/)).toBeVisible();
  await expect(page.getByText('kl. 14.30').first()).toBeVisible();

  // Edit it: the time is kept and can be cleared.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Tidskunde/ }).first().click();
  await expect(page.getByLabel(/Tidspunkt/)).toHaveValue('14:30');
  await page.getByRole('dialog').getByRole('button', { name: 'Ryd', exact: true }).click();
  await page.getByRole('button', { name: 'Gem ændringer' }).click();
  await expect(page.getByText('kl. 14.30')).toHaveCount(0);
});

test('a visit today can get a time from "Tilføj tidspunkt"', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start forfra' }).click();
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('textbox', { name: 'Kunde' }).fill('Morgenkunde');
  await page.getByLabel('Behandling').fill('Klip');
  await page.getByRole('button', { name: 'Tilføj tidspunkt' }).click();
  await page.getByLabel(/Tidspunkt/).fill('09:15');
  await page.getByRole('button', { name: 'Gem besøg' }).click();
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('button', { name: /Morgenkunde/ }).first().click();
  await expect(page.getByText(/kl\. 09\.15/).first()).toBeVisible();
});
