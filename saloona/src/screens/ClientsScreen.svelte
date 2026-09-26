<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { compareNames, searchRank } from '../domain/text';
  import { formatDateCompact } from '../domain/dates';
  import { computeRhythms } from '../domain/rhythm';
  import type { Client, Gender } from '../domain/types';
  import Icon from '../ui/icons/Icon.svelte';

  type Filter = 'all' | Gender;
  let filter = $state<Filter>('all');
  let query = $state('');

  const lastVisit = $derived.by(() => {
    const m = new Map<string, { date: string; treatment: string }>();
    for (const v of app.visits) {
      if (v.date > app.today) continue;
      const cur = m.get(v.clientId);
      if (!cur || v.date > cur.date) m.set(v.clientId, { date: v.date, treatment: v.treatment });
    }
    return m;
  });

  const lateIds = $derived(new Set(computeRhythms(app.visits, app.today).filter((r) => r.status === 'late').map((r) => r.clientId)));

  const counts = $derived({
    all: app.clients.length,
    dame: app.clients.filter((c) => c.gender === 'dame').length,
    herre: app.clients.filter((c) => c.gender === 'herre').length
  });

  const filtered = $derived(app.clients.filter((c) => filter === 'all' || c.gender === filter));

  const searching = $derived(query.trim().length > 0);

  const results = $derived.by(() => {
    if (!searching) return [];
    return filtered
      .map((c) => ({ c, rank: searchRank(c.name, query) }))
      .filter((x) => x.rank > 0)
      .sort((a, b) => b.rank - a.rank || compareNames(a.c.name, b.c.name))
      .map((x) => x.c);
  });

  /** Alphabetical sections: A–Z, then Æ, Ø, Å (Danish order), then "#". */
  const sections = $derived.by(() => {
    const sorted = [...filtered].sort((a, b) => compareNames(a.name, b.name));
    const out: { letter: string; clients: Client[] }[] = [];
    for (const c of sorted) {
      const first = c.name.charAt(0).toLocaleUpperCase('da');
      const letter = /\p{L}/u.test(first) ? first : '#';
      const last = out[out.length - 1];
      if (last && last.letter === letter) last.clients.push(c);
      else out.push({ letter, clients: [c] });
    }
    return out;
  });

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Alle' },
    { id: 'dame', label: 'Dame' },
    { id: 'herre', label: 'Herre' }
  ];
</script>

{#snippet clientRow(c: Client)}
  {@const lv = lastVisit.get(c.id)}
  <button class="row" onclick={() => nav.open({ name: 'client', id: c.id })}>
    <span class="grow">
      <span class="title">{c.name}{#if c.tag}<span class="tag">{c.tag}</span>{/if}</span>
      <span class="meta">
        {#if lv}Sidst {formatDateCompact(lv.date, app.today)} · {lv.treatment}{:else}Ingen besøg endnu{/if}
      </span>
    </span>
    {#if lateIds.has(c.id)}<span class="late-mark">Over tid</span>{/if}
    <span class="chev"><Icon name="forward" size={20} /></span>
  </button>
{/snippet}

<div class="screen">
  <div class="head">
    <h1>Kunder</h1>
    <button class="btn small quiet" onclick={() => nav.openSheet({ name: 'client' })}>
      <Icon name="plus" size={18} /> Ny kunde
    </button>
  </div>

  {#if app.clients.length === 0}
    <div class="empty">
      <p>Ingen kunder endnu. Når du registrerer et besøg, bliver kunden oprettet samtidig.</p>
      <div class="btn-row">
        <button class="btn" onclick={() => nav.openSheet({ name: 'visit' })}>Registrér besøg</button>
        <button class="btn outline" onclick={() => nav.open({ name: 'backup' })}>Hent backup</button>
      </div>
    </div>
  {:else}
    <div class="search">
      <span class="search-ic"><Icon name="search" size={20} /></span>
      <input class="input" type="search" placeholder="Søg efter navn" aria-label="Søg efter kunde" bind:value={query} enterkeyhint="search" autocomplete="off" />
    </div>

    <div class="chips filters" role="radiogroup" aria-label="Vis">
      {#each filters as f (f.id)}
        <button class="chip" role="radio" aria-checked={filter === f.id} onclick={() => (filter = f.id)}>
          {f.label} <span class="n">{counts[f.id]}</span>
        </button>
      {/each}
    </div>

    {#if searching}
      {#if results.length}
        <div class="group">{#each results as c (c.id)}{@render clientRow(c)}{/each}</div>
      {:else}
        <div class="empty">
          <p>Ingen kunder hedder noget med “{query.trim()}”.</p>
          <button class="btn" onclick={() => nav.openSheet({ name: 'visit', prefillName: query.trim() })}>
            Registrér besøg for {query.trim()}
          </button>
        </div>
      {/if}
    {:else if filtered.length === 0}
      <div class="empty"><p>Ingen kunder er markeret som {filter === 'dame' ? 'dame' : 'herre'} endnu.</p></div>
    {:else}
      {#each sections as s (s.letter)}
        <h2 class="letter" aria-label={`Bogstav ${s.letter}`}>{s.letter}</h2>
        <div class="group">{#each s.clients as c (c.id)}{@render clientRow(c)}{/each}</div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .head h1 {
    margin: 0;
  }
  .search {
    position: relative;
  }
  .search .input {
    padding-left: 44px;
  }
  .search-ic {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    display: flex;
  }
  .filters {
    margin: 12px 0 4px;
  }
  .letter {
    margin: 20px 0 8px 4px;
    font-size: 0.9rem;
    color: var(--accent);
  }
  .row .title,
  .row .meta {
    display: block;
  }
  .late-mark {
    color: var(--late);
    font-size: 0.8rem;
    font-weight: 620;
    white-space: nowrap;
  }
</style>
