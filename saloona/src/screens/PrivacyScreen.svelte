<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import Icon from '../ui/icons/Icon.svelte';

  let confirming = $state(false);
  let typed = $state('');
  let busy = $state(false);

  const ok = $derived(typed.trim().toLocaleLowerCase('da') === 'slet');

  async function wipe() {
    if (!ok || busy) return;
    busy = true;
    await app.wipeAll();
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Mere</button>
  <h1>Privatliv og data</h1>

  <div class="text">
    <p>Kundernes navne, telefonnumre, noter og beløb er persondata. Saloona passer på dem sådan her:</p>
    <ul>
      <li>Alt ligger kun på denne telefon. Appen har ikke adgang til internettet og sender intet nogen steder hen.</li>
      <li>Databasen er krypteret. Nøglen ligger i telefonens sikre nøglelager.</li>
      <li>Android tager ikke automatisk backup af Saloona. Backup laver du selv under Backup, og du bestemmer, hvor filen gemmes.</li>
    </ul>
    <p>Slet kunder, der ikke kommer mere, og opbevar backup-filer et sikkert sted. Du kan beskytte dem med en adgangskode.</p>
  </div>

  <h2>Slet alle data</h2>
  <p class="note">Sletter alle kunder, besøg og indstillinger på telefonen. Det kan ikke fortrydes. Tag en backup først, hvis du vil kunne hente dem igen.</p>

  {#if !confirming}
    <button class="btn danger wide" onclick={() => (confirming = true)}><Icon name="trash" size={20} /> Slet alle data</button>
  {:else}
    <div class="confirm">
      <label for="wipe-confirm">Skriv <b>slet</b> for at bekræfte</label>
      <input id="wipe-confirm" class="input" type="text" autocomplete="off" autocapitalize="none" bind:value={typed} />
      <div class="btn-row">
        <button class="btn outline" onclick={() => ((confirming = false), (typed = ''))}>Annullér</button>
        <button class="btn danger solid" disabled={!ok || busy} onclick={wipe}>Slet alt</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .text {
    color: var(--ink-2);
  }
  .text ul {
    padding-left: 20px;
  }
  .text li + li {
    margin-top: 8px;
  }
  .wide {
    width: 100%;
  }
  .confirm {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    padding: 16px;
    background: var(--surface);
  }
  .confirm label {
    display: block;
    margin-bottom: 8px;
  }
  .confirm .btn-row {
    margin-top: 12px;
  }
</style>
