<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { snackbar } from '../lib/snackbar.svelte';
  import { lockAvailability } from '../platform';
  import Icon from '../ui/icons/Icon.svelte';
  import Chip from '../ui/Chip.svelte';

  let available = $state<boolean | null>(null);
  let busy = $state(false);

  onMount(async () => {
    available = (await lockAvailability()).available;
  });

  const delays = [
    { s: 0, label: 'Straks' },
    { s: 60, label: 'Efter 1 min.' },
    { s: 300, label: 'Efter 5 min.' },
    { s: 900, label: 'Efter 15 min.' }
  ];

  async function toggle(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (busy) return;
    busy = true;
    try {
      const res = await app.setLock(input.checked);
      if (res === 'unavailable') snackbar.show('Slå en skærmlås til på telefonen først');
      else if (res === 'ok') snackbar.show(app.settings.lockEnabled ? 'App-låsen er slået til' : 'App-låsen er slået fra');
      input.checked = app.settings.lockEnabled;
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Mere</button>
  <h1>App-lås</h1>
  <p class="sub">Lås Saloona med fingeraftryk, ansigt eller telefonens egen kode.</p>

  <div class="group">
    <label class="switch-row">
      <span class="grow">
        <span class="title">Lås Saloona</span>
        <span class="meta">Du skal låse op, når du åbner appen.</span>
      </span>
      <input class="switch" type="checkbox" checked={app.settings.lockEnabled} disabled={busy || available === false} onchange={toggle} />
    </label>
  </div>

  {#if available === false}
    <p class="note warn">Telefonen har ingen skærmlås. Slå en PIN-kode, et mønster eller fingeraftryk til i telefonens indstillinger først.</p>
  {/if}

  {#if app.settings.lockEnabled}
    <h2>Lås igen</h2>
    <div class="chips" role="radiogroup" aria-label="Lås igen">
      {#each delays as d (d.s)}
        <Chip selected={app.settings.lockAfterSeconds === d.s} onclick={() => app.setLockAfter(d.s)}>{d.label}</Chip>
      {/each}
    </div>
    <p class="note">Hvor længe Saloona må være i baggrunden, før du skal låse op igen.</p>
  {/if}

  <h2>Når låsen er slået til</h2>
  <ul class="facts">
    <li>Indholdet skjules i oversigten over åbne apps, og der kan ikke tages skærmbilleder i appen.</li>
    <li>Påmindelser viser ikke kundernes navne.</li>
    <li>Glemmer du telefonens kode, er det telefonens egen nulstilling, der gælder. Tag backup jævnligt.</li>
  </ul>
</div>

<style>
  .title,
  .meta {
    display: block;
  }
  .title {
    font-weight: 620;
  }
  .meta {
    color: var(--muted);
    font-size: 0.88rem;
  }
  .warn {
    color: var(--soon);
  }
  .facts {
    margin: 0;
    padding-left: 20px;
    color: var(--ink-2);
  }
  .facts li + li {
    margin-top: 8px;
  }
</style>
