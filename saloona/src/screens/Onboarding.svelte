<script lang="ts">
  import { app } from '../lib/app.svelte';
  import ImportFlow from './ImportFlow.svelte';

  let importing = $state(false);
</script>

<div class="welcome">
  <div class="brand">Saloona</div>
  <h1>Din kundebog</h1>
  <ul class="points">
    <li>Se hvem der snart skal klippes igen. Saloona lærer hver kundes rytme efter 3 besøg.</li>
    <li>Registrér et besøg med få tryk. Pris og betaling er udfyldt på forhånd.</li>
    <li>Følg med i, hvad du tjener, måned for måned.</li>
  </ul>
  <p class="note">Alt bliver på telefonen, krypteret og uden internet.</p>

  <div class="actions">
    {#if importing}
      <ImportFlow ondone={() => app.finishOnboarding()} />
      <button class="link" onclick={() => (importing = false)}>Tilbage</button>
    {:else}
      <button class="btn block" onclick={() => (importing = true)}>Hent fra backup</button>
      <button class="btn block outline" onclick={() => app.finishOnboarding()}>Start forfra</button>
      <p class="note">Har du brugt Salonbog før? Så vælg Hent fra backup og find filen fra Salonbog.</p>
    {/if}
  </div>
</div>

<style>
  .welcome {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: calc(var(--safe-top) + 48px) 24px calc(var(--safe-bottom) + 24px);
  }
  .brand {
    font-size: 3.2rem;
    margin-bottom: 28px;
  }
  .points {
    padding-left: 20px;
    margin: 12px 0 8px;
    color: var(--ink-2);
  }
  .points li + li {
    margin-top: 10px;
  }
  .actions {
    margin-top: auto;
    padding-top: 32px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .actions .note {
    margin: 4px 0 0;
  }
</style>
