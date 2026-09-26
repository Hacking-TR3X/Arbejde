// WCAG 2.x contrast for Saloona's colour tokens, read straight from src/styles/app.css.
// Prints a table for the light and dark theme and exits with 1 if a pair fails.
// Usage: node scripts/contrast.mjs [path/to/app.css]
import { readFileSync } from 'node:fs';

const css = readFileSync(process.argv[2] ?? new URL('../src/styles/app.css', import.meta.url), 'utf8');

function block(re) {
  const m = css.match(re);
  if (!m) throw new Error(`block not found: ${re}`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}
const light = block(/:root\s*\{([\s\S]*?)\n\}/);
const dark = { ...light, ...block(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/) };

function hex(c) {
  c = c.trim();
  if (c === '#fff' || c === 'white') return [255, 255, 255, 1];
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`cannot parse ${c}`);
}
const over = (fg, bg, a = fg[3]) => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
const mix = (a, b, pa) => [0, 1, 2].map((i) => a[i] * pa + b[i] * (1 - pa)).concat(1);
function lum([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [label, fg, bg, required, note]; fg/bg: token name, literal, or function(theme) -> rgba
const T = (name) => (t) => {
  const v = t[name];
  if (!v) throw new Error(`missing token --${name}`);
  return v.startsWith('var(') ? T(v.slice(6, -1))(t) : hex(v);
};
const L = (c) => () => hex(c);
const navBg = (t) => mix(T('surface')(t), T('bg')(t), 0.94);
const heroBg = (t) => (t['hero-bg'] ? T('hero-bg')(t) : T('accent')(t));
const heroInk = (t) => (t['hero-ink'] ? T('hero-ink')(t) : T('accent-ink')(t));
const pairs = [
  ['Brødtekst: ink på bg', T('ink'), T('bg'), 4.5],
  ['Brødtekst: ink på surface', T('ink'), T('surface'), 4.5],
  ['ink-2 på bg (lister, noter)', T('ink-2'), T('bg'), 4.5],
  ['ink-2 på surface-2 (kundenote)', T('ink-2'), T('surface-2'), 4.5],
  ['muted på bg', T('muted'), T('bg'), 4.5],
  ['muted på surface', T('muted'), T('surface'), 4.5],
  ['muted på surface-2', T('muted'), T('surface-2'), 4.5],
  ['muted på navbar', T('muted'), navBg, 4.5],
  ['muted på accent-soft (tæller i valgt chip)', T('muted'), T('accent-soft'), 4.5],
  ['accent på bg (links, bogstaver)', T('accent'), T('bg'), 4.5],
  ['accent på surface', T('accent'), T('surface'), 4.5],
  ['accent på accent-soft (valgt chip, mærke, pill, quiet-knap)', T('accent'), T('accent-soft'), 4.5],
  ['accent på navbar (aktiv fane)', T('accent'), navBg, 4.5],
  ['accent-ink på accent (knap)', T('accent-ink'), T('accent'), 4.5],
  ['accent-ink på accent-press (knap trykket)', T('accent-ink'), T('accent-press'), 4.5],
  ['Hero: tal på hero-flade', heroInk, heroBg, 3, 'stor tekst'],
  ['Hero: meta-tekst på hero-flade', (t) => over([...heroInk(t).slice(0, 3), 0.9], heroBg(t)), heroBg, 4.5],
  ['Hero: periode-titel på hero-flade', (t) => over([...heroInk(t).slice(0, 3), 0.85], heroBg(t)), heroBg, 4.5],
  ['late på bg (fejltekst i sheet)', T('late'), T('bg'), 4.5],
  ['late på surface (over tid-mærke, fejl)', T('late'), T('surface'), 4.5],
  ['late på late-soft (pill, swipe)', T('late'), T('late-soft'), 4.5],
  ['danger-ink på late (Slet alt)', (t) => (t['danger-ink'] ? T('danger-ink')(t) : hex('#fff')), T('late'), 4.5],
  ['soon på bg', T('soon'), T('bg'), 4.5],
  ['soon på surface (Mangler beløb)', T('soon'), T('surface'), 4.5],
  ['soon på soon-soft (pill, mangler-knap)', T('soon'), T('soon-soft'), 4.5],
  ['ok på ok-soft (pill)', T('ok'), T('ok-soft'), 4.5],
  ['ink-2 på ok-soft (backup-status)', T('ink-2'), T('ok-soft'), 4.5],
  ['ink-2 på soon-soft (backup-status, mangler)', T('ink-2'), T('soon-soft'), 4.5],
  ['ink på accent-soft (banner)', T('ink'), T('accent-soft'), 4.5],
  ['Snackbar: tekst', T('bg'), T('ink'), 4.5],
  ['Snackbar: Fortryd', T('snack-action'), T('ink'), 4.5],
  ['Placeholder (muted) på surface', T('muted'), T('surface'), 4.5],
  ['Deaktiveret knap: accent-ink på accent 50 % over bg', (t) => over([...T('accent-ink')(t).slice(0, 3), 0.5], over([...T('accent')(t).slice(0, 3), 0.5], T('bg')(t))), (t) => over([...T('accent')(t).slice(0, 3), 0.5], T('bg')(t)), 0, 'undtaget (WCAG 1.4.3), kun info'],
  ['UI-kant: outline mod surface', (t) => T(t.outline ? 'outline' : 'line-strong')(t), T('surface'), 3],
  ['UI-kant: outline mod bg', (t) => T(t.outline ? 'outline' : 'line-strong')(t), T('bg'), 3],
  ['UI-kant: Ring/SMS-knap (accent) mod accent-soft info-felt', T('accent'), T('accent-soft'), 3],
  ['UI-kant: valgt chip (accent) mod bg', T('accent'), T('bg'), 3],
  ['Ikon: check i valgt chip (accent på accent-soft)', T('accent'), T('accent-soft'), 3],
  ['Switch fra: outline mod surface', (t) => T(t.outline ? 'outline' : 'line-strong')(t), T('surface'), 3],
  ['UI-kant: input-fokus accent mod surface', T('accent'), T('surface'), 3],
  ['Fejl-kant: late mod surface', T('late'), T('surface'), 3],
  ['Fokusring: accent mod bg', T('accent'), T('bg'), 3],
  ['Switch til: accent mod surface', T('accent'), T('surface'), 3],
  ['Switch-knop (surface) mod accent', T('surface'), T('accent'), 3],
  ['Chevron/ikon: chev-farve mod surface', (t) => T(t.outline ? 'outline' : 'line-strong')(t), T('surface'), 3],
  ['Ikon: accent på surface (Mere-ikoner)', T('accent'), T('surface'), 3],
  ['Søjle (inaktiv måned) mod surface', (t) => T(t['bar-muted'] ? 'bar-muted' : 'track')(t), T('surface'), 3, 'værdien står også som tekst'],
  ['Progress: late mod track', T('late'), T('track'), 3],
  ['Progress: soon mod track', T('soon'), T('track'), 3],
  ['Progress: ok mod track', T('ok'), T('track'), 3],
  ['Progress: accent mod track', T('accent'), T('track'), 3]
];

const fmt = (n) => n.toFixed(2).replace('.', ',');
let fails = 0;
const rows = [];
for (const [label, fg, bg, req, note] of pairs) {
  const r = [light, dark].map((t) => ratio(fg(t), bg(t)));
  const ok = r.map((x) => (req ? x >= req : true));
  if (ok.includes(false)) fails++;
  rows.push(
    `| ${label} | ${req ? `${fmt(req)}:1` : '–'} | ${fmt(r[0])}:1 ${ok[0] ? 'OK' : 'FEJL'} | ${fmt(r[1])}:1 ${ok[1] ? 'OK' : 'FEJL'} |${note ? ` ${note}` : ''}`
  );
}
console.log('| Par | Krav | Lys | Mørk |');
console.log('|---|---|---|---|');
console.log(rows.join('\n'));
console.log(`\n${fails} par fejler`);
if (fails) process.exitCode = 1;
