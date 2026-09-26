<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { formatAmount } from '../domain/money';
  import { compareNames } from '../domain/text';
  import { treatmentOptions } from '../domain/pricing';
  import Icon from '../ui/icons/Icon.svelte';

  const listed = $derived([...app.treatments.values()].sort((a, b) => compareNames(a.label, b.label)));
  /** Treatments used in visits that are not in the price list yet. */
  const unlisted = $derived(treatmentOptions(app.visits).filter((o) => !app.treatments.has(o.key)));

  function duration(min: number | null): string {
    if (min === null) return '';
    if (min < 60) return `${min} min.`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} t. ${m} min.` : `${h} t.`;
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Mere</button>
  <div class="head">
    <h1>Prisliste</h1>
    <button class="btn small quiet" onclick={() => nav.openSheet({ name: 'treatment' })}><Icon name="plus" size={18} /> Tilføj</button>
  </div>
  <p class="sub">Standardpris og varighed pr. behandling. Prisen foreslås, når kunden ikke har en tidligere pris, og varigheden bruges i kalenderen.</p>

  {#if listed.length === 0}
    <div class="empty">
      <p>Prislisten er tom. Tilføj dine behandlinger med pris og varighed.</p>
      <button class="btn" onclick={() => nav.openSheet({ name: 'treatment' })}>Tilføj behandling</button>
    </div>
  {:else}
    <div class="group">
      {#each listed as t (t.key)}
        <button class="row" onclick={() => nav.openSheet({ name: 'treatment', key: t.key })}>
          <span class="grow">
            <span class="title">{t.label}</span>
            <span class="meta">{t.durationMin !== null ? duration(t.durationMin) : 'Ingen varighed'}</span>
          </span>
          <span class="end price">{t.priceOre !== null ? formatAmount(t.priceOre) : 'Ingen pris'}</span>
          <span class="chev"><Icon name="forward" size={20} /></span>
        </button>
      {/each}
    </div>
  {/if}

  {#if unlisted.length}
    <h2>Brugt, men ikke i prislisten</h2>
    <div class="group">
      {#each unlisted as o (o.key)}
        <button class="row" onclick={() => nav.openSheet({ name: 'treatment', key: `new:${o.label}` })}>
          <span class="grow">
            <span class="title">{o.label}</span>
            <span class="meta">{o.count} {o.count === 1 ? 'besøg' : 'besøg'}</span>
          </span>
          <span class="end add">Tilføj</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .head h1 {
    margin: 0;
  }
  .sub {
    margin-top: 6px;
  }
  .title,
  .meta {
    display: block;
  }
  .price {
    color: var(--ink);
    font-weight: 620;
    font-variant-numeric: tabular-nums;
  }
  .add {
    color: var(--accent);
    font-weight: 620;
  }
</style>
