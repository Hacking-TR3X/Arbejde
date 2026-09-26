<script lang="ts">
  import { app } from '../lib/app.svelte';
  import Icon from '../ui/icons/Icon.svelte';

  let message = $state<string | null>(null);

  async function unlock() {
    message = null;
    const res = await app.unlock();
    if (res === 'lockout') message = 'For mange forsøg. Vent lidt, og prøv igen.';
    else if (res === 'unavailable') message = 'Telefonens skærmlås er slået fra. Slå den til igen for at åbne Saloona.';
    else if (res === 'failed') message = 'Det lykkedes ikke. Prøv igen.';
  }

  // Ask once when the lock screen appears while the app is visible, and once each
  // time the app comes back to the foreground – never in a loop after "Annuller".
  let promptedFor = -1;
  $effect(() => {
    const activation = app.activations;
    if (!app.active || promptedFor === activation) return;
    promptedFor = activation;
    void unlock();
  });
</script>

<div class="lock">
  <div class="brand">Saloona</div>
  <span class="ic"><Icon name="lock" size={28} /></span>
  <p>Saloona er låst</p>
  <button class="btn block" onclick={unlock} disabled={app.authenticating}>Lås op</button>
  {#if message}<p class="msg" role="alert">{message}</p>{/if}
</div>

<style>
  .lock {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: calc(var(--safe-top) + 24px) 32px calc(var(--safe-bottom) + 24px);
    max-width: 420px;
    margin: 0 auto;
    text-align: center;
  }
  .brand {
    font-size: 3rem;
    margin-bottom: 20px;
  }
  .ic {
    display: flex;
    width: 64px;
    height: 64px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
  }
  p {
    margin: 0 0 16px;
    color: var(--ink-2);
  }
  .msg {
    color: var(--late);
    margin-top: 8px;
  }
</style>
