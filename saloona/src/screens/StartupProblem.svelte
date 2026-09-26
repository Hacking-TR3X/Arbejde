<script lang="ts">
  import { app } from '../lib/app.svelte';

  let confirming = $state(false);
</script>

<div class="problem">
  <div class="brand">Saloona</div>
  {#if app.phase === 'keylost'}
    <h1>Dine data kan ikke åbnes</h1>
    <p>Nøglen til den krypterede database findes ikke længere på telefonen. Det kan ske, hvis telefonens sikkerhed er blevet nulstillet.</p>
    <p>Du kan starte forfra og derefter hente din seneste backup under Mere, Backup.</p>
    {#if confirming}
      <button class="btn block danger solid" onclick={() => app.discardUnreadable()}>Ja, start forfra</button>
      <button class="btn block outline" onclick={() => (confirming = false)}>Annullér</button>
    {:else}
      <button class="btn block" onclick={() => (confirming = true)}>Start forfra</button>
    {/if}
  {:else if app.phase === 'toonew'}
    <h1>Opdatér Saloona</h1>
    <p>Dine data er gemt af en nyere version af Saloona end den, der er installeret. Installér den nyeste version. Dine data er ikke ændret.</p>
  {:else}
    <h1>Saloona kunne ikke starte</h1>
    <p>Dine data er ikke ændret. Luk appen helt, og åbn den igen.</p>
    <button class="btn block" onclick={() => window.location.reload()}>Prøv igen</button>
  {/if}
</div>

<style>
  .problem {
    max-width: 480px;
    margin: 0 auto;
    padding: calc(var(--safe-top) + 48px) 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .brand {
    margin-bottom: 20px;
  }
  p {
    color: var(--ink-2);
    margin: 0 0 8px;
  }
</style>
