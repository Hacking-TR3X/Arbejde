<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { computeRhythms, MIN_DATES } from '../domain/rhythm';
  import { formatAmount } from '../domain/money';
  import { formatDateCompact, formatDateShort, formatInterval, formatRelativeDays, diffDays, monthNameLong } from '../domain/dates';
  import { capitalizeFirst, formatPhone, phoneUri } from '../domain/text';
  import { GENDER_LABELS, PAY_LABELS } from '../domain/types';
  import { dial, sms } from '../platform';
  import { snackbar } from '../lib/snackbar.svelte';
  import Icon from '../ui/icons/Icon.svelte';
  import SwipeRow from '../ui/SwipeRow.svelte';

  let { id }: { id: string } = $props();

  const client = $derived(app.clientMap.get(id));
  const visits = $derived(app.visits.filter((v) => v.clientId === id));
  const completed = $derived(visits.filter((v) => v.date <= app.today));
  const upcoming = $derived(visits.filter((v) => v.date > app.today).sort((a, b) => a.date.localeCompare(b.date)));
  const rhythms = $derived(
    computeRhythms(visits, app.today).sort((a, b) => b.dates.length - a.dates.length || a.treatment.localeCompare(b.treatment))
  );
  const total = $derived(completed.reduce((s, v) => s + (v.amountOre ?? 0), 0));
  const paid = $derived(completed.filter((v) => v.amountOre !== null).length);
  const firstDate = $derived(completed.length ? completed[completed.length - 1]?.date : undefined);
  const canCall = $derived(!!phoneUri('tel', client?.phone ?? null));

  function since(date: string): string {
    return `${monthNameLong(Number(date.slice(5, 7)))} ${date.slice(0, 4)}`;
  }

  async function call(kind: 'tel' | 'sms') {
    if (!client?.phone) return;
    try {
      if (kind === 'tel') await dial(client.phone);
      else await sms(client.phone);
    } catch {
      snackbar.show('Telefonen kunne ikke åbne det');
    }
  }

  async function remove() {
    const cid = id;
    nav.back();
    await app.deleteClient(cid);
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Tilbage</button>

  {#if !client}
    <div class="empty"><p>Kunden findes ikke længere.</p></div>
  {:else}
    <h1>{client.name}{#if client.tag}<span class="tag big">{client.tag}</span>{/if}</h1>
    <p class="sub">
      {[
        client.gender ? GENDER_LABELS[client.gender] : null,
        completed.length ? `${completed.length} besøg siden ${since(firstDate ?? app.today)}` : 'Ingen besøg endnu'
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>

    <div class="actions">
      <button class="btn" onclick={() => nav.openSheet({ name: 'visit', clientId: id })}><Icon name="plus" size={20} /> Registrér besøg</button>
      {#if canCall}
        <button class="btn outline icon" aria-label={`Ring til ${client.name}`} onclick={() => call('tel')}><Icon name="phone" /></button>
        <button class="btn outline icon" aria-label={`Send SMS til ${client.name}`} onclick={() => call('sms')}><Icon name="message" /></button>
      {/if}
      <button class="btn outline icon" aria-label="Rediger kunde" onclick={() => nav.openSheet({ name: 'client', clientId: id })}><Icon name="edit" /></button>
    </div>

    {#if client.phone || client.note}
      <div class="info">
        {#if client.phone}<p class="phone">{formatPhone(client.phone)}</p>{/if}
        {#if client.note}<p class="client-note">{client.note}</p>{/if}
      </div>
    {/if}

    {#if upcoming.length}
      <h2>Næste aftale</h2>
      <div class="group">
        {#each upcoming as v (v.id)}
          <button class="row" onclick={() => nav.openSheet({ name: 'visit', visitId: v.id })}>
            <span class="grow">
              <span class="title">{capitalizeFirst(formatDateShort(v.date, app.today))}</span>
              <span class="meta">{v.treatment} · {formatRelativeDays(diffDays(app.today, v.date))}</span>
            </span>
            <span class="chev"><Icon name="forward" size={20} /></span>
          </button>
        {/each}
      </div>
    {/if}

    {#if rhythms.length}
      <h2>Rytme</h2>
      <div class="group">
        {#each rhythms as r (r.treatmentKey)}
          <div class="row {r.status}">
            <span class="grow">
              <span class="title">{r.treatment}</span>
              <span class="meta">
                {#if r.intervalDays}
                  {capitalizeFirst(formatInterval(r.intervalDays))} · næste ca. {r.expected ? formatDateShort(r.expected, app.today) : ''}
                {:else}
                  Samler data · {r.dates.length} af {MIN_DATES} besøg
                {/if}
              </span>
            </span>
            {#if r.status === 'late'}<span class="pill">Over tid</span>
            {:else if r.status === 'soon'}<span class="pill">{formatRelativeDays(r.daysUntil ?? 0)}</span>
            {:else if r.status === 'booked'}<span class="pill">Booket</span>{/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if completed.length}
      <div class="stats">
        <div><b>{formatAmount(total)}</b><span>brugt i alt</span></div>
        <div><b>{completed.length}</b><span>{completed.length === 1 ? 'besøg' : 'besøg'}</span></div>
        <div><b>{paid ? formatAmount(Math.round(total / paid)) : '–'}</b><span>pr. besøg</span></div>
      </div>
    {/if}

    <h2>Historik <span class="count">{visits.length}</span></h2>
    {#if visits.length === 0}
      <div class="empty"><p>Ingen besøg endnu.</p></div>
    {:else}
      <p class="note swipe-hint">Stryg til venstre for at slette et besøg.</p>
      <div class="group">
        {#each visits as v (v.id)}
          <SwipeRow onremove={() => app.deleteVisit(v.id)} label={`Slet besøg ${formatDateCompact(v.date)}`}>
            <button class="row hist" onclick={() => nav.openSheet({ name: 'visit', visitId: v.id })}>
              <span class="grow">
                <span class="title">
                  {formatDateCompact(v.date, app.today)}
                  {#if v.date > app.today}<span class="tag">Booket</span>{/if}
                </span>
                <span class="meta">{v.treatment}{v.pay ? ` · ${PAY_LABELS[v.pay]}` : ''}</span>
                {#if v.note}<span class="vnote">{v.note}</span>{/if}
              </span>
              <span class="end amount" class:missing={v.amountOre === null && v.date <= app.today}>
                {v.amountOre !== null ? formatAmount(v.amountOre) : v.date <= app.today ? 'Mangler beløb' : ''}
              </span>
            </button>
          </SwipeRow>
        {/each}
      </div>
    {/if}

    <div class="danger-zone">
      <button class="btn danger" onclick={remove}><Icon name="trash" size={20} /> Slet kunde og alle besøg</button>
    </div>
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin: -6px 0 4px -4px;
  }
  h1 {
    overflow-wrap: anywhere;
  }
  .tag.big {
    font-size: 0.85rem;
    vertical-align: 5px;
    margin-left: 10px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .actions .btn:first-child {
    flex: 1;
  }
  .btn.icon {
    width: 50px;
    padding: 0;
    flex: none;
  }
  .info {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .info p {
    margin: 0;
  }
  .phone {
    font-weight: 620;
    font-variant-numeric: tabular-nums;
  }
  .client-note {
    color: var(--ink-2);
    white-space: pre-line;
  }
  .phone + .client-note {
    margin-top: 6px !important;
  }
  .row .title,
  .row .meta {
    display: block;
  }
  .vnote {
    display: block;
    color: var(--muted);
    font-size: 0.85rem;
    font-style: italic;
    white-space: pre-line;
    margin-top: 2px;
  }
  .amount {
    color: var(--ink);
    font-weight: 620;
    align-self: flex-start;
    padding-top: 1px;
  }
  .amount.missing {
    color: var(--soon);
    font-weight: 500;
    font-size: 0.82rem;
  }
  .hist {
    align-items: flex-start;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    margin-top: 24px;
    background: var(--line);
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--line);
  }
  .stats div {
    background: var(--surface);
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .stats b {
    font-size: 1.02rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .stats span {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .swipe-hint {
    margin: -4px 0 8px;
  }
  .danger-zone {
    margin-top: 32px;
  }
  .danger-zone .btn {
    width: 100%;
  }
</style>
