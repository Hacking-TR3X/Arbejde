<script lang="ts">
  import { untrack } from 'svelte';
  import { app, type FieldErrors, type TreatmentDraft } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { formatAmountInput } from '../domain/money';
  import { LIMITS } from '../domain/text';
  import Sheet from '../ui/Sheet.svelte';
  import Chip from '../ui/Chip.svelte';
  import Icon from '../ui/icons/Icon.svelte';

  // `key` is an existing entry; `prefillName` adds a treatment used in visits.
  let { key, prefillName = '' }: { key?: string; prefillName?: string } = $props();

  const existing = untrack(() => (key ? app.treatments.get(key) : undefined));

  let draft = $state<TreatmentDraft>({
    key: existing?.key,
    label: existing?.label ?? untrack(() => prefillName),
    priceText: formatAmountInput(existing?.priceOre ?? null),
    durationText: existing?.durationMin != null ? String(existing.durationMin) : ''
  });
  let errors = $state<FieldErrors>({});
  let saving = $state(false);

  const presets = [15, 30, 45, 60, 90, 120];

  async function save() {
    if (saving) return;
    saving = true;
    try {
      const res = await app.saveTreatment(draft);
      if (res.ok) nav.closeSheet();
      else errors = res.errors;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!existing) return;
    nav.closeSheet();
    await app.deleteTreatment(existing.key);
  }
</script>

<Sheet title={existing ? 'Rediger behandling' : 'Ny behandling'} onclose={() => nav.closeSheet()}>
  <form
    id="treatment-form"
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <div class="field">
      <label for="t-name">Navn</label>
      <input
        id="t-name"
        class="input"
        type="text"
        autocomplete="off"
        autocapitalize="sentences"
        placeholder="Fx Klip, Farve, Striber"
        maxlength={LIMITS.treatment}
        bind:value={draft.label}
        oninput={() => (errors.treatment = undefined)}
        aria-invalid={errors.treatment ? 'true' : undefined}
        aria-describedby={errors.treatment ? 'err-t-name' : undefined}
      />
      {#if errors.treatment}<p class="error-text" id="err-t-name">{errors.treatment}</p>{/if}
    </div>

    <div class="field">
      <label for="t-price">Pris <span class="hint">(valgfri)</span></label>
      <div class="unit-field">
        <input
          id="t-price"
          class="input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="Fx 450"
          maxlength={20}
          bind:value={draft.priceText}
          oninput={() => (errors.amount = undefined)}
          aria-invalid={errors.amount ? 'true' : undefined}
          aria-describedby={errors.amount ? 'err-t-price' : undefined}
        />
        <span class="unit">kr.</span>
      </div>
      {#if errors.amount}<p class="error-text" id="err-t-price">{errors.amount}</p>{/if}
    </div>

    <div class="field">
      <label for="t-duration">Varighed <span class="hint">(minutter, valgfri)</span></label>
      <div class="chips" role="radiogroup" aria-label="Hurtigvalg for varighed">
        {#each presets as p (p)}
          <Chip selected={draft.durationText === String(p)} onclick={() => ((draft.durationText = String(p)), (errors.duration = undefined))}>
            {p < 60 ? `${p} min.` : p % 60 ? `${Math.floor(p / 60)} t. ${p % 60} min.` : `${p / 60} t.`}
          </Chip>
        {/each}
      </div>
      <div class="unit-field duration">
        <input
          id="t-duration"
          class="input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="Fx 45"
          maxlength={3}
          bind:value={draft.durationText}
          oninput={() => (errors.duration = undefined)}
          aria-invalid={errors.duration ? 'true' : undefined}
          aria-describedby={errors.duration ? 'err-t-duration' : undefined}
        />
        <span class="unit">min.</span>
      </div>
      {#if errors.duration}<p class="error-text" id="err-t-duration">{errors.duration}</p>{/if}
    </div>

    {#if existing}
      <div class="field">
        <button type="button" class="btn danger wide" onclick={remove}><Icon name="trash" size={18} /> Fjern fra prislisten</button>
        <p class="note">Besøg med behandlingen bliver ikke ændret.</p>
      </div>
    {/if}
  </form>

  {#snippet footer()}
    <button class="btn block" type="submit" form="treatment-form" disabled={saving}>{existing ? 'Gem ændringer' : 'Tilføj til prislisten'}</button>
  {/snippet}
</Sheet>

<style>
  .field:first-child {
    margin-top: 8px;
  }
  .unit-field {
    position: relative;
  }
  .unit-field .input {
    padding-right: 56px;
    font-variant-numeric: tabular-nums;
  }
  .unit-field.duration {
    margin-top: 10px;
    max-width: 200px;
  }
  .unit {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
  }
  .wide {
    width: 100%;
  }
</style>
