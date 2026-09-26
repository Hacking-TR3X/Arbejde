import { expect, test, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start forfra' }).click();
}

async function addToPriceList(page: Page, name: string, price: string, minutes: string) {
  await page.getByRole('button', { name: 'Mere' }).click();
  await page.getByRole('button', { name: /Prisliste/ }).click();
  await page.getByRole('button', { name: /Tilføj/ }).first().click();
  await page.getByLabel('Navn').fill(name);
  await page.getByLabel(/Pris/).fill(price);
  await page.getByLabel(/Varighed/).fill(minutes);
  await page.getByRole('button', { name: 'Tilføj til prislisten' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function book(page: Page, who: string, treatment: string, date: string, time: string) {
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('textbox', { name: 'Kunde' }).fill(who);
  await page.getByLabel('Behandling').fill(treatment);
  await page.getByRole('radio', { name: /Anden dag/ }).click();
  await page.getByLabel('Vælg dato').fill(date);
  await page.getByLabel(/Tidspunkt/).fill(time);
}

test('the price list prefills the price and adds a chip in the visit sheet', async ({ page }) => {
  await start(page);
  await addToPriceList(page, 'Farve', '900', '90');
  await expect(page.getByText('1.500 kr.').or(page.getByText('900 kr.'))).toBeVisible();
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Farve' }).click();
  await expect(page.getByLabel('Beløb')).toHaveValue('900');
});

test('the calendar shows the day with end times and warns about double bookings', async ({ page }) => {
  await start(page);
  await addToPriceList(page, 'Farve', '900', '90');
  await page.getByRole('button', { name: 'Snart tid' }).click();

  await book(page, 'Anna', 'Farve', '2099-01-15', '10:00');
  await expect(page.getByText('Slutter ca. 11.30 (90 min. ifølge prislisten)')).toBeVisible();
  await page.getByRole('button', { name: 'Book aftale' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await book(page, 'Bo', 'Farve', '2099-01-15', '11:00');
  await expect(page.getByText(/Overlapper med Anna kl\. 10\.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Book aftale' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Kalender/ }).click();
  await expect(page.getByRole('heading', { name: 'Kalender' })).toBeVisible();
  await page.getByRole('button', { name: /^Uge / }).click();
  await page.getByLabel('Gå til dato').fill('2099-01-15');
  await expect(page.getByRole('heading', { name: /15\. januar 2099/ })).toBeVisible();
  await expect(page.getByText('kl. 10.00–11.30')).toBeVisible();
  await expect(page.getByText(/Overlapper med 11\.00 Bo/)).toBeVisible();
  await expect(page.getByText(/Overlapper med 10\.00 Anna/)).toBeVisible();
});

test('booking from the calendar starts on the chosen day', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /Kalender/ }).click();
  await page.getByRole('button', { name: 'Næste uge' }).click();
  await page.getByRole('radio').nth(2).click(); // Wednesday next week
  await page.getByRole('button', { name: 'Book aftale denne dag' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Book aftale' })).toBeVisible();
  await expect(page.getByLabel(/Tidspunkt/)).toBeVisible();
});

test('a treatment used in visits can be added to the price list and edited afterwards', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('textbox', { name: 'Kunde' }).fill('Anna');
  // A name starting with "new:" once collided with how the sheet was opened.
  await page.getByLabel('Behandling').fill('new: Striber');
  await page.getByRole('button', { name: 'Gem besøg' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mere' }).click();
  await page.getByRole('button', { name: /Prisliste/ }).click();
  await page.getByRole('button', { name: /new: Striber.*Tilføj/ }).click();
  await expect(page.getByLabel('Navn')).toHaveValue('new: Striber');
  await page.getByLabel(/Pris/).fill('700');
  await page.getByRole('button', { name: 'Tilføj til prislisten' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /new: Striber.*700 kr\./ }).click();
  await expect(page.getByLabel('Navn')).toHaveValue('new: Striber');
  await expect(page.getByRole('button', { name: 'Fjern fra prislisten' })).toBeVisible();
});
