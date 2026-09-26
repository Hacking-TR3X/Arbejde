import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-09-01';

/** A Saloona backup with the given clients, each with one visit. */
function backup(clients: [name: string, treatment: string | null, tag?: string][]) {
  return JSON.stringify({
    app: 'saloona',
    version: 2,
    exported: `${NOW}T10:00:00.000Z`,
    clients: clients.map(([name, , tag], i) => ({ id: `c${i}`, name, note: '', ...(tag ? { tag } : {}) })),
    visits: clients.flatMap(([, treatment], i) => (treatment ? [{ id: `v${i}`, clientId: `c${i}`, treatment, date: NOW, note: '' }] : [])),
    prices: {}
  });
}

async function importBackup(page: Page, text: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hent fra backup' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Vælg backup-fil' }).click()]);
  await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Hent backup' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('sliding on the letter index jumps through the client list', async ({ page }) => {
  const names = [...'ABCDEFGHIJKLMNOPRSTUVY'].flatMap((l) => [`${l}lpha ${l}`, `${l}eta ${l}`]);
  await importBackup(page, backup([...names.map((n): [string, null] => [n, null]), ['Aage', null]]));
  await page.getByRole('button', { name: 'Kunder' }).click();

  const index = page.locator('.index');
  await expect(index).toBeVisible();
  const box = (await index.boundingBox())!;
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', '#'];
  const y = (l: string) => box.y + ((letters.indexOf(l) + 0.5) * box.height) / letters.length;
  const x = box.x + box.width / 2;
  const topLetter = () =>
    page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.block')].find((b) => b.getBoundingClientRect().bottom > 80)?.dataset.letter);

  await page.mouse.move(x, y('B'));
  await page.mouse.down();
  await page.mouse.move(x, y('M'), { steps: 6 });
  await expect(page.locator('.bubble')).toHaveText('M');
  expect(await topLetter()).toBe('M');
  await page.mouse.move(x, y('Q'), { steps: 2 }); // no Q: the next letter with clients
  expect(await topLetter()).toBe('R');
  await page.mouse.move(x, y('Å'), { steps: 4 }); // "Aage" is listed under Å
  await expect(page.locator('.block[data-letter="Å"]')).toBeInViewport();
  await page.mouse.up();
  await expect(page.locator('.bubble')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Aage/ })).toBeInViewport();
});

test('clients get their gender from herre- and dameklip; the rest are chosen under "Uden køn"', async ({ page }) => {
  await importBackup(page, backup([['Anna', 'Dameklip'], ['Bo', 'Herreklip'], ['Carla', 'Klip'], ['Dan', 'Farve']]));
  await page.getByRole('button', { name: 'Kunder' }).click();
  await expect(page.getByRole('radio', { name: /Dame 1/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Herre 1/ })).toBeVisible();

  // On the price list, "Klip" is for women: Carla becomes a dame.
  await page.getByRole('button', { name: 'Mere' }).click();
  await page.getByRole('button', { name: /Prisliste/ }).click();
  await page.getByRole('button', { name: /^Klip/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Dame' }).click();
  await page.getByRole('button', { name: 'Tilføj til prislisten' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Klip er tilføjet prislisten. Carla har fået køn ud fra behandlingen')).toBeVisible();

  await page.getByRole('button', { name: 'Kunder' }).click();
  await expect(page.getByRole('radio', { name: /Dame 2/ })).toBeVisible();
  await page.getByRole('radio', { name: /Uden køn 1/ }).click();
  await expect(page.getByText('Saloona kan ikke se på behandlingerne')).toBeVisible();
  await page.getByRole('group', { name: 'Køn for Dan' }).getByRole('button', { name: 'Herre' }).click();
  await expect(page.getByText('Dan er sat til herre')).toBeVisible();
  // Nobody left without a gender: back to everyone, and the filter is gone.
  await expect(page.getByRole('radio', { name: /Alle 4/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Uden køn/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /Herre 2/ })).toBeVisible();

  await page.locator('.bar').filter({ hasText: 'Dan er sat til herre' }).getByRole('button', { name: 'Fortryd' }).click();
  await expect(page.getByRole('radio', { name: /Uden køn 1/ })).toBeVisible();
});

test('a new client booked for a herreklip starts as herre', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start forfra' }).click();
  await page.getByRole('button', { name: 'Nyt besøg' }).click();
  await page.getByRole('textbox', { name: 'Kunde' }).fill('Egon');
  await page.getByLabel('Behandling').fill('Herreklip');
  await expect(page.getByRole('radiogroup', { name: /Ny kunde/ }).getByRole('radio', { name: 'Herre' })).toBeChecked();
  await page.getByRole('button', { name: 'Gem besøg' }).click();
  await page.getByRole('button', { name: 'Kunder' }).click();
  await expect(page.getByRole('radio', { name: /Herre 1/ })).toBeVisible();
});

test('"Barn" is a filter, and the client sheet has a shortcut for it', async ({ page }) => {
  await importBackup(page, backup([['Frida', 'Børneklip', 'Barn'], ['Grete', 'Dameklip']]));
  await page.getByRole('button', { name: 'Kunder' }).click();
  await page.getByRole('radio', { name: /Barn 1/ }).click();
  await expect(page.getByRole('button', { name: /^Frida/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Grete/ })).toHaveCount(0);

  await page.getByRole('radio', { name: /Alle/ }).click();
  await page.getByRole('button', { name: /^Grete/ }).click();
  await page.getByRole('button', { name: /Rediger/ }).click();
  await page.getByRole('button', { name: 'Barn', pressed: false }).click();
  await expect(page.getByLabel(/Mærke/)).toHaveValue('Barn');
  await page.getByRole('button', { name: 'Gem ændringer' }).click();
  await page.goBack();
  await expect(page.getByRole('radio', { name: /Barn 2/ })).toBeVisible();
});

test('the price list change can be undone, and a removed gender stays removed', async ({ page }) => {
  await importBackup(page, backup([['Anna', 'Klip'], ['Bo', 'Herreklip']]));
  await page.getByRole('button', { name: 'Mere' }).click();
  await page.getByRole('button', { name: /Prisliste/ }).click();
  await page.getByRole('button', { name: /^Klip/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Dame' }).click();
  await page.getByRole('button', { name: 'Tilføj til prislisten' }).click();
  await page.locator('.bar').filter({ hasText: 'Anna har fået køn' }).getByRole('button', { name: 'Fortryd' }).click();
  await page.getByRole('button', { name: 'Kunder' }).click();
  await expect(page.getByRole('radio', { name: /Uden køn 1/ })).toBeVisible();

  // Bo got herre from "Herreklip"; the owner removes it, and it is not put back.
  await page.getByRole('radio', { name: /Herre 1/ }).click();
  await page.getByRole('button', { name: /^Bo/ }).click();
  await page.getByRole('button', { name: /Rediger/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Herre' }).click();
  await page.getByRole('button', { name: 'Gem ændringer' }).click();
  await page.goBack();
  await expect(page.getByRole('radio', { name: /Uden køn 2/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Kunder' }).click();
  await expect(page.getByRole('radio', { name: /Uden køn 2/ })).toBeVisible();
});
