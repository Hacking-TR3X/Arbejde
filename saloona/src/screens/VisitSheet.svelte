<script lang="ts">
  import { untrack } from 'svelte';
  import { app, type FieldErrors, type VisitDraft } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { addDays, formatDateShort, isValidISODate } from '../domain/dates';
  import { formatAmountInput } from '../domain/money';
  import { lastTreatmentFor, suggestPay, suggestPrice, treatmentOptions } from '../domain/pricing';
  import { computeRhythms } from '../domain/rhythm';
  import { LIMITS, cleanLine, compareNames, searchRank, treatmentKey } from '../domain/text';
  import { GENDER_LABELS, GENDERS, PAY_LABELS, PAY_METHODS, type Client } from '../domain/types';
  import Sheet from '../ui/Sheet.svelte';
  import Icon from '../ui/icons/Icon.svelte';
  import Chip from '../ui/Chip.svelte';

  interface Props {
    visitId?: string;
    clientId?: string;
    prefillName?: string;
  }
  let { visitId, clientId, prefillName }: Props = $props();

  const editing = untrack(() => (visitId ? app.visits.find((v) => v.id === visitId) : undefined));
  const initialClient = untrack(() => editing?.clientId ?? clientId ?? null);

  let draft = $state<VisitDraft>({
    id: editing?.id,
    clientId: initialClient,
    clientName: untrack(() => (initialClient ? (app.clientMap.get(initialClient)?.name ?? '') : (prefillName ?? ''))),
    newClientGender: null,
    // Opened from a client page: start from that client's most recent treatment,
    // so price and payment are prefilled too.
    treatment:
      editing?.treatment ??
      untrack(() => (initialClient ? (lastTreatmentFor(app.visits, initialClient, app.today)?.treatment ?? '') : '')),
    amountText: editing ? formatAmountInput(editing.amountOre) : '',
    pay: editing?.pay ?? null,
    date: editing?.date ?? untrack(() => app.today),
    time: editing?.time ?? '',
    note: editing?.note ?? ''
  });
  let errors = $state<FieldErrors>({});
  let saving = $state(false);
  let amountTouched = !!editing;
  let payTouched = !!editing;
  let showNote = $state(!!editing?.note);
  let showTime = $state(!!editing?.time);
  let pickingClient = $state(!initialClient);
  let dateMode = $state<'today' | 'yesterday' | 'other'>(
    untrack(() => (!editing || editing.date === app.today ? 'today' : editing.date === addDays(app.today, -1) ? 'yesterday' : 'other'))
  );

  const chosenClient = $derived(draft.clientId ? app.clientMap.get(draft.clientId) : undefined);
  const booking = $derived(draft.date > app.today);
  const typedName = $derived(cleanLine(draft.clientName, LIMITS.name));
  const exactMatch = $derived(draft.clientId ? undefined : app.findClientByName(draft.clientName));
  const isNewClient = $derived(!draft.clientId && !!typedName && !exactMatch);

  /** Clients to offer before anything is typed: overdue/soon first, then the most recent. */
  const quickClients = $derived.by(() => {
    const out: Client[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      const c = app.clientMap.get(id);
      if (c && !seen.has(id)) {
        seen.add(id);
        out.push(c);
      }
    };
    computeRhythms(app.visits, app.today)
      .filter((r) => r.status === 'late' || (r.status === 'soon' && (r.daysUntil ?? 99) <= 7))
      .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
      .forEach((r) => push(r.clientId));
    for (const v of app.visits) {
      if (out.length >= 8) break;
      if (v.date <= app.today) push(v.clientId);
    }
    return out.slice(0, 8);
  });

  const matches = $derived.by(() => {
    if (!typedName) return [];
    return app.clients
      .map((c) => ({ c, rank: searchRank(c.name, typedName) }))
      .filter((x) => x.rank > 0)
      .sort((a, b) => b.rank - a.rank || compareNames(a.c.name, b.c.name))
      .slice(0, 6)
      .map((x) => x.c);
  });

  const treatments = $derived(treatmentOptions(app.visits, draft.clientId).slice(0, 10));
  const tKey = $derived(treatmentKey(draft.treatment));

  const title = $derived(editing ? (booking ? 'Rediger aftale' : 'Rediger besøg') : booking ? 'Book aftale' : 'Nyt besøg');
  const saveLabel = $derived(editing ? 'Gem ændringer' : booking ? 'Book aftale' : 'Gem besøg');

  // Prefill price and payment from history until the user changes them.
  $effect(() => {
    const key = tKey;
    const cid = draft.clientId;
    untrack(() => {
      if (!amountTouched) {
        const ore = suggestPrice(app.visits, cid, key, app.prices, app.today);
        draft.amountText = formatAmountInput(ore);
      }
      if (!payTouched) draft.pay = suggestPay(app.visits, cid, app.today);
    });
  });

  function chooseClient(c: Client) {
    draft.clientId = c.id;
    draft.clientName = c.name;
    pickingClient = false;
    errors.client = undefined;
    if (!editing && !draft.treatment) {
      const last = lastTreatmentFor(app.visits, c.id, app.today);
      if (last) draft.treatment = last.treatment;
    }
  }

  function changeClient() {
    draft.clientId = null;
    draft.clientName = '';
    pickingClient = true;
  }

  function onNameInput() {
    draft.clientId = null;
    errors.client = undefined;
  }

  function setDate(mode: 'today' | 'yesterday' | 'other') {
    dateMode = mode;
    if (mode === 'today') draft.date = app.today;
    else if (mode === 'yesterday') draft.date = addDays(app.today, -1);
    else if (draft.date === app.today || draft.date === addDays(app.today, -1)) draft.date = addDays(app.today, 7);
  }

  async function save() {
    if (saving) return;
    if (!draft.clientId && exactMatch) draft.clientId = exactMatch.id;
    errors = app.validateVisit(draft);
    if (Object.keys(errors).length) return;
    saving = true;
    try {
      const res = await app.saveVisit(draft);
      if (res.ok) nav.closeSheet();
      else errors = res.errors;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!editing) return;
    nav.closeSheet();
    await app.deleteVisit(editing.id);
  }
</script>

<Sheet {title} onclose={() => nav.closeSheet()}>
  <form
    id="visit-form"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
    novalidate
  >
    <!-- Client -->
    <div class="field">
      <span class="label" id="lbl-client">Kunde</span>
      {#if chosenClient && !pickingClient}
        <div class="chosen">
          <span class="chosen-name">{chosenClient.name}{#if chosenClient.tag}<span class="tag">{chosenClient.tag}</span>{/if}</span>
          <button type="button" class="link" onclick={changeClient}>Skift</button>
        </div>
      {:else}
        <input
          class="input"
          type="text"
          aria-labelledby="lbl-client"
          placeholder="Skriv navn"
          autocomplete="off"
          autocapitalize="words"
          enterkeyhint="next"
          maxlength={LIMITS.name}
          bind:value={draft.clientName}
          oninput={onNameInput}
          aria-invalid={errors.client ? 'true' : undefined}
          aria-describedby={errors.client ? 'err-client' : undefined}
        />
        {#if errors.client}<p class="error-text" id="err-client">{errors.client}</p>{/if}
        <div class="chips suggest">
          {#each typedName ? matches : quickClients as c (c.id)}
            <Chip kind="action" onclick={() => chooseClient(c)}>{c.name}</Chip>
          {/each}
        </div>
        {#if isNewClient}
          <div class="new-client">
            <span class="hint" id="lbl-new-gender">Ny kunde. Dame eller herre?</span>
            <div class="chips" role="radiogroup" aria-labelledby="lbl-new-gender">
              {#each GENDERS as g (g)}
                <Chip selected={draft.newClientGender === g} onclick={() => (draft.newClientGender = draft.newClientGender === g ? null : g)}>
                  {GENDER_LABELS[g]}
                </Chip>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Treatment -->
    <div class="field">
      <label for="f-treat">Behandling</label>
      <input
        id="f-treat"
        class="input"
        type="text"
        placeholder="Fx Klip, Farve, Striber"
        autocomplete="off"
        autocapitalize="sentences"
        maxlength={LIMITS.treatment}
        bind:value={draft.treatment}
        oninput={() => (errors.treatment = undefined)}
        aria-invalid={errors.treatment ? 'true' : undefined}
        aria-describedby={errors.treatment ? 'err-treat' : undefined}
      />
      {#if errors.treatment}<p class="error-text" id="err-treat">{errors.treatment}</p>{/if}
      {#if treatments.length}
        <div class="chips suggest">
          {#each treatments as t (t.key)}
            <Chip
              kind="toggle"
              selected={tKey === t.key}
              onclick={() => {
                draft.treatment = t.label;
                errors.treatment = undefined;
              }}>{t.label}</Chip
            >
          {/each}
        </div>
      {/if}
    </div>

    <!-- Amount + payment -->
    <div class="field">
      <label for="f-amount">Beløb</label>
      <div class="amount">
        <input
          id="f-amount"
          class="input"
          type="text"
          inputmode="decimal"
          placeholder="Fx 450"
          autocomplete="off"
          maxlength={20}
          bind:value={draft.amountText}
          oninput={() => {
            amountTouched = true;
            errors.amount = undefined;
          }}
          aria-invalid={errors.amount ? 'true' : undefined}
          aria-describedby={errors.amount ? 'amount-unit err-amount' : 'amount-unit'}
        />
        <span class="unit" id="amount-unit">kr.</span>
      </div>
      {#if errors.amount}<p class="error-text" id="err-amount">{errors.amount}</p>{/if}
    </div>

    <div class="field">
      <span class="label" id="lbl-pay">Betaling</span>
      <div class="chips" role="radiogroup" aria-labelledby="lbl-pay">
        {#each PAY_METHODS as p (p)}
          <Chip
            selected={draft.pay === p}
            onclick={() => {
              payTouched = true;
              draft.pay = draft.pay === p ? null : p;
            }}>{PAY_LABELS[p]}</Chip
          >
        {/each}
      </div>
    </div>

    <!-- Date -->
    <div class="field">
      <span class="label" id="lbl-date">Dato</span>
      <div class="chips" role="radiogroup" aria-labelledby="lbl-date">
        <Chip selected={dateMode === 'today'} onclick={() => setDate('today')}>I dag</Chip>
        <Chip selected={dateMode === 'yesterday'} onclick={() => setDate('yesterday')}>I går</Chip>
        <Chip icon="calendar" selected={dateMode === 'other'} onclick={() => setDate('other')}>
          {dateMode === 'other' && isValidISODate(draft.date) ? formatDateShort(draft.date, app.today) : 'Anden dag'}
        </Chip>
      </div>
      {#if dateMode === 'other'}
        <input
          class="input date"
          type="date"
          aria-label="Vælg dato"
          min="2000-01-01"
          max="2100-12-31"
          bind:value={draft.date}
          aria-invalid={errors.date ? 'true' : undefined}
          aria-describedby={errors.date ? 'err-date' : undefined}
        />
        <p class="note">{booking ? 'En dag frem i tiden bliver en booket aftale.' : 'Vælg en dag frem i tiden for at booke en aftale.'}</p>
      {/if}
      {#if errors.date}<p class="error-text" id="err-date">{errors.date}</p>{/if}
    </div>

    <!-- Time (always offered for bookings, one tap away for visits) -->
    <div class="field">
      {#if showTime || booking || draft.time}
        <label for="f-time">Tidspunkt <span class="hint">(valgfrit)</span></label>
        <div class="time-row">
          <input
            id="f-time"
            class="input time"
            type="time"
            step="300"
            bind:value={draft.time}
            oninput={() => (errors.time = undefined)}
            aria-invalid={errors.time ? 'true' : undefined}
            aria-describedby={errors.time ? 'err-time' : undefined}
          />
          {#if draft.time}
            <button type="button" class="link" onclick={() => (draft.time = '')}>Ryd</button>
          {/if}
        </div>
        {#if errors.time}<p class="error-text" id="err-time">{errors.time}</p>{/if}
      {:else}
        <button type="button" class="link" onclick={() => (showTime = true)}><Icon name="clock" size={18} /> Tilføj tidspunkt</button>
      {/if}
    </div>

    <!-- Note -->
    <div class="field">
      {#if showNote}
        <label for="f-note">Note <span class="hint">(fx farvenummer eller ønsker til næste gang)</span></label>
        <textarea id="f-note" class="input" maxlength={LIMITS.note} bind:value={draft.note}></textarea>
      {:else}
        <button type="button" class="link" onclick={() => (showNote = true)}><Icon name="note" size={18} /> Tilføj note</button>
      {/if}
    </div>

    {#if editing}
      <div class="field">
        <button type="button" class="btn danger" onclick={remove}><Icon name="trash" size={18} /> {booking ? 'Slet aftale' : 'Slet besøg'}</button>
      </div>
    {/if}
  </form>

  {#snippet footer()}
    <button class="btn block" type="submit" form="visit-form" disabled={saving}>{saveLabel}</button>
  {/snippet}
</Sheet>

<style>
  .field:first-child {
    margin-top: 8px;
  }
  .suggest {
    margin-top: 10px;
  }
  .chosen {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 50px;
    padding: 4px 6px 4px 14px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }
  .chosen-name {
    min-width: 0;
    font-weight: 620;
    color: var(--accent);
    font-size: 1.05rem;
    overflow-wrap: anywhere;
  }
  .chosen .link {
    flex: none;
    padding: 0 var(--space-3);
  }
  .new-client {
    margin-top: 12px;
  }
  .new-client .chips {
    margin-top: 8px;
  }
  .amount {
    position: relative;
  }
  .amount .input {
    padding-right: 48px;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
  }
  .date {
    margin-top: 10px;
  }
  .time-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .time-row .input {
    max-width: 180px;
    font-variant-numeric: tabular-nums;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn.danger {
    width: 100%;
  }
</style>
