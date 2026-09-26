<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { addDays, formatDateLong, isValidISODate, monthNameShort } from '../domain/dates';
  import { capitalizeFirst } from '../domain/text';
  import { countByDay, dayAgenda, formatTimeRange, isoWeek, weekOf, type AgendaItem } from '../domain/calendar';
  import Icon from '../ui/icons/Icon.svelte';

  let { day }: { day?: string } = $props();

  let selected = $state(untrack(() => (day && isValidISODate(day) ? day : app.today)));
  let picking = $state(false);
  let pickValue = $state('');

  function pick(value: string) {
    if (isValidISODate(value)) selected = value;
    picking = false;
  }

  const week = $derived(weekOf(selected));
  const counts = $derived(countByDay(app.visits, week));
  const agenda = $derived(dayAgenda(app.visits, app.clientMap, app.treatments, selected));
  const total = $derived(agenda.timed.length + agenda.untimed.length);
  const byId = $derived(new Map(agenda.timed.map((i) => [i.visit.id, i])));

  const WEEKDAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

  function weekLabel(days: string[]): string {
    const a = days[0]!;
    const b = days[6]!;
    const d = (iso: string) => `${Number(iso.slice(8, 10))}. ${monthNameShort(Number(iso.slice(5, 7)))}`;
    return `Uge ${isoWeek(a)} · ${d(a)}–${d(b)}`;
  }

  function overlapText(item: AgendaItem): string {
    const others = item.overlapsWith
      .map((id) => byId.get(id))
      .filter((o): o is AgendaItem => !!o)
      .map((o) => `${o.start?.replace(':', '.')} ${o.client?.name ?? ''}`.trim());
    return `Overlapper med ${others.join(' og ')}`;
  }

  function book() {
    nav.openSheet({ name: 'visit', date: selected });
  }
</script>

{#snippet itemRow(item: AgendaItem)}
  <button class="row item" class:clash={item.overlapsWith.length > 0} onclick={() => nav.openSheet({ name: 'visit', visitId: item.visit.id })}>
    <span class="time">
      {#if item.start}
        <b>{item.start.replace(':', '.')}</b>
        {#if item.end}<small>{item.end.replace(':', '.')}</small>{/if}
      {:else}
        <small>–</small>
      {/if}
    </span>
    <span class="grow">
      <span class="title">{item.client?.name ?? 'Ukendt kunde'}{#if item.client?.tag}<span class="tag">{item.client.tag}</span>{/if}</span>
      <span class="meta">
        {item.visit.treatment}{item.start ? ` · ${formatTimeRange(item.start, item.end)}` : ''}{item.durationMin === null && item.start ? ' (varighed ukendt)' : ''}
      </span>
      {#if item.overlapsWith.length}<span class="warn"><Icon name="info" size={16} /> {overlapText(item)}</span>{/if}
    </span>
    <span class="chev"><Icon name="forward" size={20} /></span>
  </button>
{/snippet}

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Tilbage</button>
  <div class="head">
    <h1>Kalender</h1>
    {#if selected !== app.today}
      <button class="btn small quiet" onclick={() => (selected = app.today)}>I dag</button>
    {/if}
  </div>

  <div class="weeknav">
    <button class="nav-btn" aria-label="Forrige uge" onclick={() => (selected = addDays(selected, -7))}><Icon name="back" /></button>
    <button class="week-label" aria-expanded={picking} onclick={() => ((pickValue = selected), (picking = !picking))}>
      {weekLabel(week)} <Icon name="down" size={18} />
    </button>
    <button class="nav-btn" aria-label="Næste uge" onclick={() => (selected = addDays(selected, 7))}><Icon name="forward" /></button>
  </div>

  {#if picking}
    <input
      class="input go-to"
      type="date"
      aria-label="Gå til dato"
      min="2000-01-01"
      max="2100-12-31"
      bind:value={pickValue}
      onchange={() => pick(pickValue)}
    />
  {/if}

  <div class="days" role="radiogroup" aria-label="Vælg dag">
    {#each week as d, i (d)}
      {@const n = counts.get(d) ?? 0}
      <button
        class="day"
        class:today={d === app.today}
        role="radio"
        aria-checked={d === selected}
        aria-label={`${formatDateLong(d, app.today)}${n ? `, ${n} ${n === 1 ? 'aftale' : 'aftaler'}` : ''}`}
        onclick={() => (selected = d)}
      >
        <small>{WEEKDAYS[i]}</small>
        <b>{Number(d.slice(8, 10))}</b>
        <span class="dots" aria-hidden="true">
          {#each Array.from({ length: Math.min(n, 3) }, (_, k) => k) as k (k)}<i></i>{/each}
        </span>
      </button>
    {/each}
  </div>

  <h2>{capitalizeFirst(formatDateLong(selected, app.today))} <span class="count">{total || ''}</span></h2>

  {#if total === 0}
    <div class="empty">
      <p>{selected < app.today ? 'Ingen besøg denne dag.' : 'Ingen aftaler denne dag.'}</p>
    </div>
  {:else}
    {#if agenda.timed.length}
      <div class="group">{#each agenda.timed as item (item.visit.id)}{@render itemRow(item)}{/each}</div>
    {/if}
    {#if agenda.untimed.length}
      <h2 class="sub-h">Uden tidspunkt</h2>
      <div class="group">{#each agenda.untimed as item (item.visit.id)}{@render itemRow(item)}{/each}</div>
    {/if}
  {/if}

  <button class="btn block book" onclick={book}>
    <Icon name="plus" size={20} />
    {selected >= app.today ? 'Book aftale denne dag' : 'Registrér besøg denne dag'}
  </button>
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
  .weeknav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px 0 8px;
  }
  .week-label {
    font-weight: 620;
    color: var(--ink-2);
    background: none;
    border: 0;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
  }
  .go-to {
    margin-bottom: 10px;
  }
  .nav-btn {
    width: 48px;
    height: 48px;
    border: 0;
    background: none;
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .day {
    min-height: 64px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 4px 0;
  }
  .day small {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .day b {
    font-size: 1.05rem;
    font-weight: 620;
    font-variant-numeric: tabular-nums;
  }
  .day.today b {
    color: var(--accent);
  }
  .day[aria-checked='true'] {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .day[aria-checked='true'] small,
  .day[aria-checked='true'] b {
    color: var(--accent-ink);
  }
  .dots {
    display: flex;
    gap: 3px;
    min-height: 5px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }
  .day[aria-checked='true'] .dots i {
    background: var(--accent-ink);
  }
  .item {
    align-items: flex-start;
  }
  .time {
    width: 52px;
    flex: none;
    display: flex;
    flex-direction: column;
    font-variant-numeric: tabular-nums;
  }
  .time b {
    font-weight: 650;
    color: var(--accent);
  }
  .time small {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .title,
  .meta {
    display: block;
  }
  .warn {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--late);
    font-size: 0.85rem;
    font-weight: 620;
    margin-top: 2px;
  }
  .sub-h {
    font-size: 0.9rem;
    color: var(--muted);
  }
  .book {
    margin-top: 24px;
  }
</style>
