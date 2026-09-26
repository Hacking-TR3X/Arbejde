<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { PERIODS, computeEarnings, monthBars, periodTitle, type PeriodId, type Slice } from '../domain/earnings';
  import { formatAmount, formatNumber } from '../domain/money';
  import { PAY_LABELS, isPayMethod } from '../domain/types';
  import Icon from '../ui/icons/Icon.svelte';

  let period = $state<PeriodId>('month');

  const e = $derived(computeEarnings(app.visits, app.clientMap, period, app.today));
  const bars = $derived(monthBars(app.visits, app.today, 6));
  const maxBar = $derived(Math.max(1, ...bars.map((b) => b.total)));
  const anyAmounts = $derived(app.visits.some((v) => v.amountOre !== null));

  function payLabel(key: string): string {
    return isPayMethod(key) ? PAY_LABELS[key] : 'Ikke angivet';
  }

  function share(s: Slice): number {
    return e.total ? Math.round((s.total / e.total) * 100) : 0;
  }

  /** Short bar labels: 12.450 → "12,5k" */
  function compact(ore: number): string {
    const kr = ore / 100;
    if (kr >= 10_000) return `${(kr / 1000).toFixed(0)}k`;
    if (kr >= 1000) return `${(kr / 1000).toFixed(1).replace('.', ',')}k`;
    return String(Math.round(kr));
  }
</script>

{#snippet breakdown(title: string, slices: Slice[], label: (s: Slice) => string, onpick?: (s: Slice) => void)}
  {#if slices.length}
    <h2>{title}</h2>
    <div class="group brk">
      {#each slices as s (s.key)}
        {#if onpick}
          <button class="brk-row" onclick={() => onpick(s)}>{@render sliceBody(s, label(s))}</button>
        {:else}
          <div class="brk-row">{@render sliceBody(s, label(s))}</div>
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet sliceBody(s: Slice, name: string)}
  <span class="brk-top">
    <span class="brk-name">{name} <small>{s.count} {s.count === 1 ? 'besøg' : 'besøg'}</small></span>
    <span class="brk-sum">{formatAmount(s.total)}</span>
  </span>
  <span class="bar" aria-hidden="true"><i style:width={`${share(s)}%`}></i></span>
{/snippet}

<div class="screen">
  <h1>Indtjening</h1>
  <p class="sub">Kun gennemførte besøg med beløb tæller med.</p>

  <div class="chips periods" role="radiogroup" aria-label="Periode">
    {#each PERIODS as p (p.id)}
      <button class="chip" role="radio" aria-checked={period === p.id} onclick={() => (period = p.id)}>{p.label}</button>
    {/each}
  </div>

  <section class="hero" aria-label="Total">
    <span class="hero-title">{periodTitle(period, app.today)}</span>
    <span class="big">{formatAmount(e.total)}</span>
    <span class="hero-meta">
      {e.count}
      {e.count === 1 ? 'besøg' : 'besøg'}{#if e.average !== null}&nbsp;· gennemsnit {formatAmount(e.average)}{/if}
    </span>
  </section>

  {#if e.missing.length}
    <button class="missing" onclick={() => nav.open({ name: 'missing' })}>
      <span class="grow">
        <b>{e.missing.length} {e.missing.length === 1 ? 'besøg mangler' : 'besøg mangler'} beløb</b>
        <span>Skriv beløbet ind, så tallene passer</span>
      </span>
      <Icon name="forward" size={20} />
    </button>
  {/if}

  {#if !anyAmounts}
    <div class="empty">
      <p>Når du skriver beløb på dine besøg, kan du se her, hvad du har tjent, og hvordan kunderne betaler.</p>
    </div>
  {:else}
    <h2>Seneste 6 måneder</h2>
    <div class="months" role="img" aria-label={bars.map((b) => `${b.label}: ${formatNumber(b.total)} kr.`).join(', ')}>
      {#each bars as b (b.key)}
        <div class="mcol" class:cur={b.current}>
          <b>{b.total ? compact(b.total) : ''}</b>
          <i style:height={`${Math.max(2, Math.round((b.total / maxBar) * 100))}%`}></i>
          <small>{b.label}</small>
        </div>
      {/each}
    </div>

    {@render breakdown('Betaling', e.byPay, (s) => payLabel(s.key))}
    {@render breakdown('Behandlinger', e.byTreatment, (s) => s.label)}
    {@render breakdown('Topkunder', e.topClients, (s) => s.label, (s) => {
      if (app.clientMap.has(s.key)) nav.open({ name: 'client', id: s.key });
    })}
  {/if}
</div>

<style>
  .periods {
    margin-bottom: 14px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 22px;
    padding: 20px 20px 18px;
  }
  .hero-title {
    font-size: 0.9rem;
    opacity: 0.85;
  }
  .big {
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    font-variation-settings: 'opsz' 96;
    font-variant-numeric: tabular-nums;
    margin: 4px 0 2px;
  }
  .hero-meta {
    font-size: 0.92rem;
    opacity: 0.9;
  }
  .missing {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin-top: 10px;
    padding: 12px 14px;
    min-height: 56px;
    text-align: left;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--soon) 30%, var(--line));
    background: var(--soon-soft);
    color: var(--ink);
  }
  .missing .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .missing b {
    color: var(--soon);
    font-weight: 620;
  }
  .missing span span {
    font-size: 0.85rem;
    color: var(--ink-2);
  }
  .months {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 150px;
    padding: 14px 12px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .mcol {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
  }
  .mcol i {
    display: block;
    width: 100%;
    max-width: 30px;
    border-radius: 8px;
    background: var(--track);
    min-height: 3px;
  }
  .mcol.cur i {
    background: var(--accent);
  }
  .mcol b {
    font-size: 0.7rem;
    font-weight: 620;
    white-space: nowrap;
    min-height: 1em;
  }
  .mcol small {
    color: var(--muted);
    font-size: 0.74rem;
  }
  .mcol.cur small {
    color: var(--accent);
    font-weight: 620;
  }
  .brk-row {
    display: block;
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: 0;
    text-align: left;
    color: inherit;
  }
  button.brk-row:active {
    background: var(--surface-2);
  }
  .brk-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .brk-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .brk-name small {
    color: var(--muted);
    margin-left: 4px;
  }
  .brk-sum {
    font-weight: 620;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .brk-row .bar {
    display: block;
    margin-top: 8px;
  }
</style>
