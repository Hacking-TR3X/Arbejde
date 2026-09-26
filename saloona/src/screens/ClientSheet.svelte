<script lang="ts">
  import { untrack } from 'svelte';
  import { app, type ClientDraft, type FieldErrors } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { LIMITS, formatPhone } from '../domain/text';
  import { GENDER_LABELS, GENDERS } from '../domain/types';
  import Sheet from '../ui/Sheet.svelte';

  let { clientId, prefillName }: { clientId?: string; prefillName?: string } = $props();

  const existing = untrack(() => (clientId ? app.clientMap.get(clientId) : undefined));
  let draft = $state<ClientDraft>({
    id: existing?.id,
    name: existing?.name ?? untrack(() => prefillName ?? ''),
    gender: existing?.gender ?? null,
    tag: existing?.tag ?? '',
    phone: existing?.phone ? formatPhone(existing.phone) : '',
    note: existing?.note ?? ''
  });
  let errors = $state<FieldErrors>({});
  let saving = $state(false);

  async function save() {
    if (saving) return;
    saving = true;
    try {
      const res = await app.saveClient(draft);
      if (!res.ok) {
        errors = res.errors;
        return;
      }
      if (!existing && res.id) nav.replaceSheetWithPage({ name: 'client', id: res.id });
      else nav.closeSheet();
    } finally {
      saving = false;
    }
  }
</script>

<Sheet title={existing ? 'Rediger kunde' : 'Ny kunde'} onclose={() => nav.closeSheet()}>
  <form
    id="client-form"
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <div class="field">
      <label for="c-name">Navn</label>
      <input
        id="c-name"
        class="input"
        type="text"
        autocomplete="off"
        autocapitalize="words"
        maxlength={LIMITS.name}
        bind:value={draft.name}
        oninput={() => (errors.name = undefined)}
        aria-invalid={errors.name ? 'true' : undefined}
      />
      {#if errors.name}<p class="error-text">{errors.name}</p>{/if}
    </div>

    <div class="field">
      <span class="label" id="c-gender">Dame eller herre</span>
      <div class="chips" role="radiogroup" aria-labelledby="c-gender">
        {#each GENDERS as g (g)}
          <button type="button" class="chip" role="radio" aria-checked={draft.gender === g} onclick={() => (draft.gender = draft.gender === g ? null : g)}>
            {GENDER_LABELS[g]}
          </button>
        {/each}
      </div>
    </div>

    <div class="field">
      <label for="c-tag">Mærke <span class="hint">(valgfrit, fx Barn)</span></label>
      <input id="c-tag" class="input" type="text" autocomplete="off" maxlength={LIMITS.tag} bind:value={draft.tag} />
    </div>

    <div class="field">
      <label for="c-phone">Telefon <span class="hint">(valgfrit)</span></label>
      <input
        id="c-phone"
        class="input"
        type="tel"
        inputmode="tel"
        autocomplete="off"
        maxlength={LIMITS.phone}
        bind:value={draft.phone}
        oninput={() => (errors.phone = undefined)}
        aria-invalid={errors.phone ? 'true' : undefined}
      />
      {#if errors.phone}<p class="error-text">{errors.phone}</p>{/if}
    </div>

    <div class="field">
      <label for="c-note">Note <span class="hint">(valgfri)</span></label>
      <textarea id="c-note" class="input" maxlength={LIMITS.note} bind:value={draft.note}></textarea>
    </div>
  </form>

  {#snippet footer()}
    <button class="btn block" type="submit" form="client-form" disabled={saving}>{existing ? 'Gem ændringer' : 'Opret kunde'}</button>
  {/snippet}
</Sheet>
