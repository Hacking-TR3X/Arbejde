<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { formatDateCompact } from '../domain/dates';
  import { suggestPrice } from '../domain/pricing';
  import { formatAmountInput } from '../domain/money';
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
    if (!res.ok) errors[id] = res.errors.amount ?? 'Beløbet ser forkert ud';
    else delete errors[id];
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Indtjening</button>
  <h1>Mangler beløb</h1>
  <p class="sub">Gennemførte besøg uden beløb. Forslaget er det, kunden betalte sidst.</p>

  {#if missing.length === 0}
    <div class="empty"><p>Alle besøg har et beløb.</p></div>
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
            <input
              class="input"
              type="text"
              inputmode="decimal"
              aria-label={`Beløb for ${app.clientMap.get(v.clientId)?.name ?? ''} ${formatDateCompact(v.date)}`}
              value={values[v.id] ?? suggestions.get(v.id) ?? ''}
              oninput={(e) => (values[v.id] = e.currentTarget.value)}
              aria-invalid={errors[v.id] ? 'true' : undefined}
            />
            <button class="btn small" type="submit">Gem</button>
          </div>
          {#if errors[v.id]}<p class="error-text">{errors[v.id]}</p>{/if}
        </form>
      {/each}
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
  .item {
    padding: 12px 16px;
  }
  .who {
    display: flex;
    flex-direction: column;
  }
  .who span {
    color: var(--muted);
    font-size: 0.88rem;
  }
  .enter {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .enter .input {
    min-height: 44px;
    padding: 8px 12px;
  }
  .enter .btn {
    min-height: 44px;
  }
</style>
