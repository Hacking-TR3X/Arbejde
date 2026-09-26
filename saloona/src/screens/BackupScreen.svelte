<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { nav } from '../lib/nav.svelte';
  import { snackbar } from '../lib/snackbar.svelte';
  import { MIN_PASSWORD_LENGTH } from '../domain/backup/crypto';
  import { formatDateLong, formatRelativeDays, diffDays, todayISO } from '../domain/dates';
  import Icon from '../ui/icons/Icon.svelte';
  import ImportFlow from './ImportFlow.svelte';

  let protect = $state(false);
  let pass1 = $state('');
  let pass2 = $state('');
  let passError = $state<string | null>(null);
  let busy = $state(false);

  const last = $derived(app.settings.lastBackupAt ? todayISO(new Date(app.settings.lastBackupAt)) : null);

  function checkPassword(): string | null | false {
    if (!protect) return null;
    if (pass1.length < MIN_PASSWORD_LENGTH) {
      passError = `Adgangskoden skal have mindst ${MIN_PASSWORD_LENGTH} tegn`;
      return false;
    }
    if (pass1 !== pass2) {
      passError = 'De to adgangskoder er ikke ens';
      return false;
    }
    passError = null;
    return pass1;
  }

  async function run(target: 'save' | 'share') {
    if (busy) return;
    const pw = checkPassword();
    if (pw === false) return;
    busy = true;
    try {
      const done = await app.exportBackup(target, pw);
      if (done) {
        snackbar.show(target === 'save' ? 'Backup er gemt' : 'Backup er klar til at dele');
        pass1 = '';
        pass2 = '';
      }
    } catch {
      snackbar.show('Backup kunne ikke gemmes. Prøv igen.');
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Tilbage</button>
  <h1>Backup</h1>
  <p class="sub">Alt ligger kun på denne telefon. Gem en backup jævnligt, fx i Google Drev, eller send den til dig selv.</p>

  <div class="status" class:due={app.backupDue}>
    {#if last}
      <b>Sidste backup: {formatDateLong(last, app.today)}</b>
      <span>{formatRelativeDays(diffDays(app.today, last))}</span>
    {:else}
      <b>Du har ikke taget en backup endnu</b>
      <span>Hvis telefonen bliver væk eller går i stykker, er en backup den eneste måde at få dine kunder tilbage.</span>
    {/if}
  </div>

  <h2>Gem backup</h2>
  <div class="group">
    <label class="switch-row">
      <span class="grow">
        <span class="title">Beskyt med adgangskode</span>
        <span class="meta">Filen kan kun åbnes med koden. Glemmer du den, kan filen ikke bruges.</span>
      </span>
      <input class="switch" type="checkbox" bind:checked={protect} />
    </label>
  </div>
  {#if protect}
    <div class="field">
      <label for="bk-p1">Adgangskode <span class="hint">(mindst {MIN_PASSWORD_LENGTH} tegn)</span></label>
      <input
        id="bk-p1"
        class="input"
        type="password"
        autocomplete="new-password"
        bind:value={pass1}
        aria-invalid={passError ? 'true' : undefined}
        aria-describedby={passError ? 'bk-err' : undefined}
      />
    </div>
    <div class="field">
      <label for="bk-p2">Gentag adgangskode</label>
      <input
        id="bk-p2"
        class="input"
        type="password"
        autocomplete="new-password"
        bind:value={pass2}
        aria-invalid={passError ? 'true' : undefined}
        aria-describedby={passError ? 'bk-err' : undefined}
      />
      {#if passError}<p class="error-text" id="bk-err">{passError}</p>{/if}
    </div>
  {/if}
  <div class="btn-row actions">
    <button class="btn" disabled={busy || app.clients.length === 0} onclick={() => run('save')}><Icon name="download" size={20} /> Gem som fil</button>
    <button class="btn outline" disabled={busy || app.clients.length === 0} onclick={() => run('share')}><Icon name="share" size={20} /> Del</button>
  </div>
  <p class="note">
    {app.clients.length === 0
      ? 'Der er ingen data at tage backup af endnu.'
      : `${app.clients.length} kunder og ${app.visits.length} besøg kommer med.`}
  </p>

  <h2>Hent backup</h2>
  <ImportFlow />
</div>

<style>
  .status {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    border-radius: var(--radius);
    background: var(--ok-soft);
  }
  .status span {
    color: var(--ink-2);
    font-size: 0.9rem;
  }
  .status.due {
    background: var(--soon-soft);
  }
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
  .actions {
    margin-top: 14px;
  }
</style>
