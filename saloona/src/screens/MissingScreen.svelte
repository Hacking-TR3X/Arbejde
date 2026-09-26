<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { formatDateCompact } from '../domain/dates';
  import { suggestPrice } from '../domain/pricing';
  import { formatAmountInput } from '../domain/money';
  import { snackbar } from '../lib/snackbar.svelte';
  import Icon from '../ui/icons/Icon.svelte';

  const missing = $derived(
    app.visits.filter((v) => v.amountOre === null && v.date <= app.today).sort((a, b) => b.date.localeCompare(a.date))
  );

  let values = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});

  const suggestions = $derived(
    new Map(missing.map((v) => [v.id, formatAmountInput(suggestPrice(app.visits, v.clientId, v.treatmentKey, app.prices, app.today))]))
  );

  async function save(id: string) {
    const res = await app.setVisitAmount(id, values[id] ?? suggestions.get(id) ?? '');
    if (!res.ok) errors[id] = res.errors.amount ?? 'Beløbet ser forkert ud. Skriv fx 450 eller 450,50.';
    else {
      delete errors[id];
      snackbar.show('Beløbet er gemt');
    }
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Indtjening</button>
  <h1>Mangler beløb</h1>
  <p class="sub">Besøg uden beløb. Forslaget er det, kunden betalte sidst.</p>

  {#if missing.length === 0}
    <div class="empty"><p>Alle besøg har et beløb. Tallene under Indtjening er komplette.</p></div>
  {:else}
    <div class="group">
      {#each missing as v (v.id)}
        <form
          class="item"
          novalidate
          onsubmit={(e) => {
            e.preventDefault();
            void save(v.id);
          }}
        >
          <div class="who">
            <b>{app.clientMap.get(v.clientId)?.name ?? 'Ukendt kunde'}</b>
            <span>{formatDateCompact(v.date, app.today)} · {v.treatment}</span>
          </div>
          <div class="enter">
            <span class="amount">
              <input
                class="input"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="Beløb"
                aria-label={`Beløb for ${app.clientMap.get(v.clientId)?.name ?? ''} ${formatDateCompact(v.date)}`}
                value={values[v.id] ?? suggestions.get(v.id) ?? ''}
                oninput={(e) => (values[v.id] = e.currentTarget.value)}
                aria-invalid={errors[v.id] ? 'true' : undefined}
                aria-describedby={errors[v.id] ? `err-${v.id}` : undefined}
              />
              <span class="unit" aria-hidden="true">kr.</span>
            </span>
            <button class="btn small quiet" type="submit">Gem</button>
          </div>
          {#if errors[v.id]}<p class="error-text" id={`err-${v.id}`}>{errors[v.id]}</p>{/if}
        </form>
      {/each}
    </div>
  {/if}
</div>

<style>
  .item {
    padding: var(--space-3) var(--space-4);
  }
  .who {
    display: flex;
    flex-direction: column;
  }
  .who span {
    color: var(--muted);
    font-size: 0.88rem;
  }
  .who b {
    overflow-wrap: anywhere;
  }
  .enter {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .amount {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .enter .input {
    min-height: var(--tap);
    padding: var(--space-2) 44px var(--space-2) var(--space-3);
    font-variant-numeric: tabular-nums;
  }
  .unit {
    position: absolute;
    right: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
  }
</style>
