<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { INDEX_LETTERS, alphabetSections, compareNames, searchRank } from '../domain/text';
  import { formatDateCompact } from '../domain/dates';
  import { guessGender, isChild } from '../domain/gender';
  import { computeRhythms } from '../domain/rhythm';
  import type { Client, Gender, Visit } from '../domain/types';
  import Icon from '../ui/icons/Icon.svelte';
  import Chip from '../ui/Chip.svelte';
  import AlphaIndex from '../ui/AlphaIndex.svelte';

  type Filter = 'all' | Gender | 'barn' | 'none';
  let filter = $state<Filter>('all');
  let query = $state('');
  let list = $state<HTMLElement>();

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

  function matchesFilter(c: Client, f: Filter): boolean {
    if (f === 'all') return true;
    if (f === 'barn') return isChild(c);
    if (f === 'none') return !c.gender;
    return c.gender === f;
  }

  const counts = $derived({
    all: app.clients.length,
    dame: app.clients.filter((c) => c.gender === 'dame').length,
    herre: app.clients.filter((c) => c.gender === 'herre').length,
    barn: app.clients.filter(isChild).length,
    none: app.clients.filter((c) => !c.gender).length
  });

  const filtered = $derived(app.clients.filter((c) => matchesFilter(c, filter)));

  // When the last client without a gender gets one, go back to everyone.
  $effect(() => {
    if (filter === 'none' && counts.none === 0) filter = 'all';
  });

  const visitsByClient = $derived.by(() => {
    const m = new Map<string, Visit[]>();
    for (const v of app.visits) {
      const list = m.get(v.clientId);
      if (list) list.push(v);
      else m.set(v.clientId, [v]);
    }
    return m;
  });

  /** Why Saloona could not tell the gender itself. */
  function genderReason(c: Client): string {
    const visits = visitsByClient.get(c.id) ?? [];
    if (visits.length === 0) return 'Ingen besøg endnu';
    if (guessGender(visits, app.treatments).kind === 'mixed') return 'Både dame og herre';
    const names = [...new Set(visits.map((v) => v.treatment))];
    return names.length > 3 ? `${names.slice(0, 3).join(', ')} …` : names.join(', ');
  }

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
  const sections = $derived(alphabetSections(filtered, (c) => c.name));
  const letters = $derived(new Set(sections.map((s) => s.letter)));
  const showIndex = $derived(sections.length >= 3 && filter !== 'none');

  /** Jumps to the letter, or the next letter that has clients (the last one at the end). */
  function jumpTo(letter: string) {
    if (!list) return;
    const at = INDEX_LETTERS.indexOf(letter);
    const target = sections.find((s) => INDEX_LETTERS.indexOf(s.letter) >= at) ?? sections[sections.length - 1];
    const el = target && list.querySelector<HTMLElement>(`[data-letter="${CSS.escape(target.letter)}"]`);
    if (!el) return;
    const pad = parseFloat(getComputedStyle(list.closest('.screen') ?? document.body).paddingTop) || 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - pad, behavior: 'instant' });
  }

  const filters = $derived(
    (
      [
        { id: 'all', label: 'Alle' },
        { id: 'dame', label: 'Dame' },
        { id: 'herre', label: 'Herre' },
        { id: 'barn', label: 'Barn' },
        { id: 'none', label: 'Uden køn' }
      ] as { id: Filter; label: string }[]
    ).filter((f) => f.id !== 'none' || counts.none > 0 || filter === 'none')
  );

  const emptyText: Record<Filter, string> = {
    all: '',
    dame: 'Ingen kunder er markeret som dame endnu.',
    herre: 'Ingen kunder er markeret som herre endnu.',
    barn: 'Ingen kunder er markeret som barn endnu. Skriv "Barn" som mærke på kunden.',
    none: 'Alle kunder har et køn.'
  };
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
      {#if query}
        <button class="clear" aria-label="Ryd søgning" onclick={() => (query = '')}><Icon name="close" size={20} /></button>
      {/if}
    </div>

    <div class="chips filters" role="radiogroup" aria-label="Vis">
      {#each filters as f (f.id)}
        <Chip selected={filter === f.id} onclick={() => (filter = f.id)}>{f.label} <span class="n">{counts[f.id]}</span></Chip>
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
      <div class="empty"><p>{emptyText[filter]}</p></div>
    {:else if filter === 'none'}
      <p class="note lead">Saloona kan ikke se på behandlingerne, om de er dame eller herre. Vælg for hver kunde.</p>
      <div class="group">
        {#each [...filtered].sort((a, b) => compareNames(a.name, b.name)) as c (c.id)}
          <div class="row pick-row">
            <button class="grow open" onclick={() => nav.open({ name: 'client', id: c.id })}>
              <span class="title">{c.name}{#if c.tag}<span class="tag">{c.tag}</span>{/if}</span>
              <span class="meta">{genderReason(c)}</span>
            </button>
            <div class="pick" role="group" aria-label={`Køn for ${c.name}`}>
              <button class="btn small outline" onclick={() => app.setClientGender(c.id, 'dame')}>Dame</button>
              <button class="btn small outline" onclick={() => app.setClientGender(c.id, 'herre')}>Herre</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <!-- One continuous list. The letter sits in a left gutter, like the phone's own contacts. -->
      <div class="group alpha" class:indexed={showIndex} bind:this={list}>
        {#each sections as s (s.letter)}
          <div class="block" data-letter={s.letter}>
            <h2 class="initial" aria-label={`Bogstav ${s.letter}`}>{s.letter}</h2>
            {#each s.items as c (c.id)}{@render clientRow(c)}{/each}
          </div>
        {/each}
      </div>
      {#if showIndex}<AlphaIndex available={letters} anchor={list} onpick={jumpTo} />{/if}
    {/if}
  {/if}
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-4);
  }
  .head h1 {
    margin: 0;
  }
  .search {
    position: relative;
  }
  .search .input {
    padding-left: 44px;
    padding-right: 48px;
  }
  /* Our own clear button instead of the browser's blue one */
  .search .input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .clear {
    position: absolute;
    right: 1px;
    top: 50%;
    transform: translateY(-50%);
    width: var(--tap);
    height: var(--tap);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: none;
    color: var(--muted);
    border-radius: var(--radius-sm);
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
    margin: var(--space-3) 0 var(--space-4);
  }
  .block {
    position: relative;
  }
  .initial {
    position: absolute;
    top: var(--space-3);
    left: 0;
    width: 48px;
    margin: 0;
    display: block;
    text-align: center;
    font-size: 1rem;
    line-height: 1.45;
    color: var(--accent);
    pointer-events: none;
  }
  .alpha .row {
    padding-left: 48px;
  }
  .block > .row + .row {
    border-top: 1px solid var(--line);
  }
  .row .title,
  .row .meta {
    display: block;
  }
  /* Room for the letter index at the right edge. */
  .alpha.indexed {
    margin-right: 18px;
  }
  .lead {
    margin: 0 0 var(--space-3);
  }
  .pick-row {
    padding-right: 12px;
  }
  .open {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    min-height: var(--tap);
  }
  .pick {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }
  .pick .btn {
    padding: 0 14px;
  }
  .late-mark {
    color: var(--late);
    font-size: 0.8rem;
    font-weight: 620;
    white-space: nowrap;
  }
</style>
