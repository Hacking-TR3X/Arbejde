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
  <div class="topbar">
    <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Tilbage</button>
    {#if client}
      <button class="link edit" aria-label="Rediger kunde" onclick={() => nav.openSheet({ name: 'client', clientId: id })}>
        <Icon name="edit" size={20} /> Rediger
      </button>
    {/if}
  </div>

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

    <button class="btn block register" onclick={() => nav.openSheet({ name: 'visit', clientId: id })}>
      <Icon name="plus" size={20} /> Registrér besøg
    </button>

    {#if client.phone || client.note}
      <div class="info">
        {#if client.phone}
          <div class="contact">
            <span class="phone">{formatPhone(client.phone)}</span>
            {#if canCall}
              <span class="contact-actions">
                <button class="btn small outline" aria-label={`Ring til ${client.name}`} onclick={() => call('tel')}><Icon name="phone" size={18} /> Ring</button>
                <button class="btn small outline" aria-label={`SMS til ${client.name}`} onclick={() => call('sms')}><Icon name="message" size={18} /> SMS</button>
              </span>
            {/if}
          </div>
        {/if}
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
                  {capitalizeFirst(formatInterval(r.intervalDays))} · forventet {r.expected ? formatDateShort(r.expected, app.today) : ''}
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
        <div><b>{completed.length}</b><span>besøg</span></div>
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
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }
  .edit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: -6px -4px var(--space-1) 0;
    padding: 0 var(--space-1);
  }
  .tag.big {
    font-size: 0.85rem;
    vertical-align: 5px;
    margin-left: 10px;
  }
  .register {
    margin-top: var(--space-1);
  }
  /* Contact and note: a quiet, borderless panel, not another card */
  .info {
    margin-top: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }
  .info p {
    margin: 0;
  }
  .contact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
  }
  .phone {
    font-weight: 620;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .contact-actions {
    display: flex;
    gap: var(--space-2);
  }
  /* On the tinted panel the grey outline is too faint (2.8:1); the accent edge is 6:1. */
  .contact-actions .btn {
    border-color: var(--accent);
  }
  .client-note {
    color: var(--ink);
    white-space: pre-line;
  }
  .contact + .client-note {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
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
  .hist .amount {
    margin-left: auto;
    color: var(--ink);
    font-weight: 620;
    align-self: flex-start;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }
  .hist .amount.missing {
    color: var(--soon);
    font-weight: 500;
    font-size: 0.82rem;
  }
  .hist {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  /* With very large text the amount moves under the treatment instead of squeezing it */
  .hist .grow {
    flex: 1 1 10em;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    margin-top: var(--space-6);
    background: var(--line);
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--line);
  }
  .stats div {
    flex: 1 1 6.5em;
    background: var(--surface);
    padding: var(--space-3) 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .stats b {
    font-size: 1.02rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
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
