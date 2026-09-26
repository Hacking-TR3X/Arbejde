<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { dueOverview, MIN_DATES, type Rhythm } from '../domain/rhythm';
  import { capitalizeFirst } from '../domain/text';
  import { diffDays, formatDateCompact, formatDateLong, formatDateShort, formatInterval, formatRelativeDays, todayISO, formatTime } from '../domain/dates';
  import Icon from '../ui/icons/Icon.svelte';

  const overview = $derived(dueOverview(app.visits, app.clientMap, app.today));
  let showCollecting = $state(false);

  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (overview.upcoming.length) parts.push(overview.upcoming.length === 1 ? '1 aftale' : `${overview.upcoming.length} aftaler`);
    if (overview.late.length) parts.push(`${overview.late.length} over tid`);
    if (overview.soon.length) parts.push(`${overview.soon.length} inden for 2 uger`);
    if (parts.length) return parts.join(' · ');
    return app.visits.length ? 'Ingen kunder er over tid' : 'Ingen besøg endnu';
  });

  const daysSinceBackup = $derived(app.daysSinceBackup);

  function pillText(r: Rhythm): string {
    const d = r.daysUntil ?? 0;
    if (d < 0) return d === -1 ? '1 dag over' : `${-d} dage over`;
    return formatRelativeDays(d);
  }

  function openClient(id: string) {
    nav.open({ name: 'client', id });
  }
</script>

{#snippet rhythmCard(r: Rhythm)}
  {@const c = app.clientMap.get(r.clientId)}
  <button class="card {r.status}" onclick={() => openClient(r.clientId)}>
    <span class="top">
      <span class="who">
        <span class="name">{c?.name}{#if c?.tag}<span class="tag">{c.tag}</span>{/if}</span>
        <span class="treat">{r.treatment} · {formatInterval(r.intervalDays ?? 0)}</span>
      </span>
      <span class="pill">{pillText(r)}</span>
    </span>
    <span class="bar"><i style:width={`${Math.round(r.progress * 100)}%`}></i></span>
    <span class="meta">
      <span>Sidst {r.lastDate ? formatDateCompact(r.lastDate, app.today) : ''}</span>
      <span>Forventet {r.expected ? formatDateShort(r.expected, app.today) : ''}</span>
    </span>
  </button>
{/snippet}

<div class="screen">
  <div class="brand" aria-hidden="true">Saloona</div>
  <h1>{capitalizeFirst(formatDateLong(app.today))}</h1>
  <p class="sub">{summary}</p>

  {#if app.backupDue}
    <div class="banner">
      <span>
        {daysSinceBackup === null ? 'Du har ikke taget en backup endnu.' : `Det er ${daysSinceBackup} dage siden sidste backup.`}
      </span>
      <button class="btn small quiet" onclick={() => nav.open({ name: 'backup' })}>Tag backup</button>
    </div>
  {/if}

  {#if app.visits.length === 0}
    <div class="empty">
      <p>Her kan du se, hvem der snart skal klippes igen. Når en kunde har været her {MIN_DATES} gange til samme behandling, regner Saloona rytmen ud.</p>
      <p>Tryk på + nederst for at registrere det første besøg.</p>
      <div class="btn-row">
        <button class="btn" onclick={() => nav.openSheet({ name: 'visit' })}>Registrér besøg</button>
        <button class="btn outline" onclick={() => nav.open({ name: 'backup' })}>Hent backup</button>
      </div>
    </div>
  {:else}
    {#if overview.upcoming.length}
      <h2>Kommende aftaler <span class="count">{overview.upcoming.length}</span></h2>
      <div class="group">
        {#each overview.upcoming as a (a.visit.id)}
          <button class="row" onclick={() => nav.openSheet({ name: 'visit', visitId: a.visit.id })}>
            <span class="when">
              <b>{capitalizeFirst(formatRelativeDays(diffDays(app.today, a.visit.date)))}</b>
              <small>{formatDateShort(a.visit.date, app.today)}</small>
              {#if a.visit.time}<small class="clock">{formatTime(a.visit.time)}</small>{/if}
            </span>
            <span class="grow">
              <span class="title">{a.client?.name ?? 'Ukendt kunde'}</span>
              <span class="meta">{a.visit.treatment}</span>
            </span>
            <span class="chev"><Icon name="forward" size={20} /></span>
          </button>
        {/each}
      </div>
    {/if}

    {#if overview.late.length}
      <h2>Over tid <span class="count">{overview.late.length}</span></h2>
      <div class="cards">
        {#each overview.late as r (r.clientId + r.treatmentKey)}{@render rhythmCard(r)}{/each}
      </div>
    {/if}

    {#if overview.soon.length}
      <h2>Inden for 2 uger <span class="count">{overview.soon.length}</span></h2>
      <div class="cards">
        {#each overview.soon as r (r.clientId + r.treatmentKey)}{@render rhythmCard(r)}{/each}
      </div>
    {/if}

    {#if overview.later.length}
      <h2>Senere <span class="count">{overview.later.length}</span></h2>
      <div class="group">
        {#each overview.later as r (r.clientId + r.treatmentKey)}
          {@const c = app.clientMap.get(r.clientId)}
          <button class="row later" onclick={() => openClient(r.clientId)}>
            <span class="grow">
              <span class="title">{c?.name}</span>
              <span class="meta">{r.treatment} · {formatInterval(r.intervalDays ?? 0)}</span>
            </span>
            <span class="end">{r.expected ? formatDateShort(r.expected, app.today) : ''}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if !overview.late.length && !overview.soon.length && !overview.later.length}
      <div class="empty quiet">
        <p>Ingen kunder har en rytme endnu. Den kommer, når en kunde har været her {MIN_DATES} gange til samme behandling.</p>
      </div>
    {/if}

    {#if overview.collecting.length}
      <button class="fold" aria-expanded={showCollecting} onclick={() => (showCollecting = !showCollecting)}>
        <span>Samler data <span class="count">{overview.collecting.length}</span></span>
        <span class="fold-ic" class:open={showCollecting}><Icon name="down" size={20} /></span>
      </button>
      {#if showCollecting}
        <p class="note">Kunder med færre end {MIN_DATES} besøg til samme behandling.</p>
        <div class="group">
          {#each overview.collecting as r (r.clientId + r.treatmentKey)}
            {@const c = app.clientMap.get(r.clientId)}
            <button class="row" onclick={() => openClient(r.clientId)}>
              <span class="grow">
                <span class="title">{c?.name}</span>
                <span class="meta">{r.treatment}{r.booked ? ` · booket ${formatDateShort(r.booked, app.today)}` : ''}</span>
              </span>
              <span class="dots" aria-hidden="true">
                {#each Array.from({ length: MIN_DATES }, (_, i) => i) as i (i)}
                  <i class:on={i < r.dates.length}></i>
                {/each}
              </span>
              <span class="sr-only">{r.dates.length} af {MIN_DATES} besøg</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .cards {
    display: grid;
    gap: 10px;
  }
  .card {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px var(--space-4) var(--space-3);
    color: inherit;
    box-shadow: var(--lift);
    overflow-wrap: anywhere;
  }
  .card.late {
    border-color: color-mix(in srgb, var(--late) 22%, var(--line));
  }
  .card:active {
    background: var(--surface-2);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-1) var(--space-3);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 620;
    font-size: 1.05rem;
    overflow-wrap: anywhere;
  }
  .treat {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .card .bar {
    display: block;
    margin-top: 12px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    color: var(--muted);
    font-size: 0.8rem;
    margin-top: 7px;
    gap: 0 var(--space-3);
  }
  .row .meta {
    display: block;
    margin: 0;
    font-size: 0.88rem;
  }
  .row .title {
    display: block;
  }
  .when {
    display: flex;
    flex-direction: column;
    width: 5.5em;
    max-width: 40%;
    flex: none;
  }
  .when b {
    font-weight: 620;
    color: var(--accent);
  }
  .when small {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .when small.clock {
    color: var(--ink-2);
    font-weight: 620;
  }
  .fold {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    min-height: var(--tap);
    margin-top: 22px;
    padding: 0;
    background: none;
    border: 0;
    font-weight: 620;
    color: var(--ink-2);
  }
  .fold .count {
    color: var(--muted);
    font-weight: 500;
    margin-left: 6px;
  }
  .fold-ic {
    display: flex;
    color: var(--muted);
    transition: transform var(--dur) var(--ease);
  }
  .fold-ic.open {
    transform: rotate(180deg);
  }
  .dots {
    display: flex;
    gap: 4px;
  }
  .dots i {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--outline);
  }
  .dots i.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .empty.quiet {
    margin-top: 18px;
  }
</style>
