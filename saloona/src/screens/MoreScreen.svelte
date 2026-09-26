<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { snackbar } from '../lib/snackbar.svelte';
  import { formatDateCompact, formatRelativeDays, diffDays, todayISO } from '../domain/dates';
  import { remindersSupported } from '../platform/reminders';
  import Icon from '../ui/icons/Icon.svelte';
  import Chip from '../ui/Chip.svelte';
  import type { Settings } from '../data/repo';

  const lastBackup = $derived(app.settings.lastBackupAt ? todayISO(new Date(app.settings.lastBackupAt)) : null);
  let busy = $state(false);

  const themes: { id: Settings['theme']; label: string }[] = [
    { id: 'system', label: 'Som telefonen' },
    { id: 'light', label: 'Lys' },
    { id: 'dark', label: 'Mørk' }
  ];

  async function toggleReminders(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (busy) return;
    busy = true;
    try {
      const res = await app.setReminders(input.checked);
      if (res === 'denied') snackbar.show('Tillad notifikationer for Saloona i telefonens indstillinger');
      if (res === 'unsupported') snackbar.show('Påmindelser virker kun i appen på telefonen');
      input.checked = app.settings.remindersEnabled;
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <h1>Mere</h1>
  <p class="sub">Backup, lås og indstillinger.</p>

  <div class="group">
    <button class="row" onclick={() => nav.open({ name: 'backup' })}>
      <span class="ic"><Icon name="download" /></span>
      <span class="grow">
        <span class="title">Backup og gendannelse</span>
        <span class="meta" class:warn={app.backupDue}>
          {lastBackup ? `Sidst ${formatDateCompact(lastBackup, app.today)} (${formatRelativeDays(diffDays(app.today, lastBackup))})` : 'Ingen backup endnu'}
        </span>
      </span>
      <span class="chev"><Icon name="forward" size={20} /></span>
    </button>
    <button class="row" onclick={() => nav.open({ name: 'security' })}>
      <span class="ic"><Icon name="lock" /></span>
      <span class="grow">
        <span class="title">App-lås</span>
        <span class="meta">{app.settings.lockEnabled ? 'Slået til' : 'Slået fra'}</span>
      </span>
      <span class="chev"><Icon name="forward" size={20} /></span>
    </button>
  </div>

  <h2>Påmindelse</h2>
  <div class="group">
    <label class="switch-row">
      <span class="ic"><Icon name="bell" /></span>
      <span class="grow">
        <span class="title">Besked om kunder over tid</span>
        <span class="meta">Én notifikation om dagen kl. 9, kun når nogen er over tid.</span>
      </span>
      <input class="switch" type="checkbox" checked={app.settings.remindersEnabled} disabled={busy || !remindersSupported()} onchange={toggleReminders} />
    </label>
  </div>

  <h2>Udseende</h2>
  <div class="chips" role="radiogroup" aria-label="Udseende">
    {#each themes as t (t.id)}
      <Chip selected={app.settings.theme === t.id} onclick={() => app.setTheme(t.id)}>{t.label}</Chip>
    {/each}
  </div>

  <h2>Om appen</h2>
  <div class="group">
    <button class="row" onclick={() => nav.open({ name: 'privacy' })}>
      <span class="ic"><Icon name="shield" /></span>
      <span class="grow"><span class="title">Privatliv og data</span><span class="meta">Hvor data ligger, og hvordan du sletter dem</span></span>
      <span class="chev"><Icon name="forward" size={20} /></span>
    </button>
    <button class="row" onclick={() => nav.open({ name: 'about' })}>
      <span class="ic"><Icon name="info" /></span>
      <span class="grow"><span class="title">Om Saloona</span></span>
      <span class="chev"><Icon name="forward" size={20} /></span>
    </button>
  </div>
</div>

<style>
  .ic {
    color: var(--accent);
    display: flex;
    flex: none;
  }
  .title,
  .meta {
    display: block;
  }
  .switch-row .title {
    font-weight: 620;
  }
  .switch-row .meta {
    color: var(--muted);
    font-size: 0.88rem;
  }
  .warn {
    color: var(--soon);
  }
</style>
