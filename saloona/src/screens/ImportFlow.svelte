<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { snackbar } from '../lib/snackbar.svelte';
  import { decryptBackup } from '../domain/backup/crypto';
  import { MAX_FILE_CHARS, readBackupText, type EncryptedEnvelope, type ParsedBackup } from '../domain/backup/validate';
  import type { ImportMode } from '../domain/backup/merge';
  import { formatDateCompact, isValidISODate, todayISO } from '../domain/dates';
  import { openFile } from '../platform';
  import Icon from '../ui/icons/Icon.svelte';
  import Chip from '../ui/Chip.svelte';

  let { ondone }: { ondone?: () => void } = $props();

  type Step =
    | { kind: 'idle' }
    | { kind: 'password'; envelope: EncryptedEnvelope; name: string }
    | { kind: 'preview'; backup: ParsedBackup; name: string };

  let step = $state<Step>({ kind: 'idle' });
  let error = $state<string | null>(null);
  let password = $state('');
  let busy = $state(false);
  let mode = $state<ImportMode>(app.clients.length ? 'merge' : 'replace');

  const plan = $derived(step.kind === 'preview' ? app.planImport(step.backup, mode) : null);

  function exportedLabel(b: ParsedBackup): string | null {
    if (!b.exported) return null;
    const d = new Date(b.exported);
    if (Number.isNaN(d.getTime())) return null;
    const iso = todayISO(d);
    return isValidISODate(iso) ? formatDateCompact(iso) : null;
  }

  function n(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }

  async function pick() {
    error = null;
    app.expectExternalActivity();
    const res = await openFile(MAX_FILE_CHARS).catch(() => ({ canceled: true }) as const);
    if (res.canceled) return;
    if ('tooLarge' in res && res.tooLarge) {
      error = 'Filen er for stor til at være en backup.';
      return;
    }
    const text = 'data' in res ? (res.data ?? '') : '';
    const name = ('name' in res ? res.name : undefined) ?? 'backup';
    handleText(text, name);
  }

  function handleText(text: string, name: string) {
    const read = readBackupText(text);
    if (read.kind === 'error') error = read.error;
    else if (read.kind === 'encrypted') {
      password = '';
      step = { kind: 'password', envelope: read.envelope, name };
    } else {
      mode = app.clients.length ? 'merge' : 'replace';
      step = { kind: 'preview', backup: read.backup, name };
    }
  }

  async function unlockFile() {
    if (step.kind !== 'password' || busy) return;
    busy = true;
    error = null;
    try {
      const res = await decryptBackup(step.envelope, password);
      if (!res.ok) {
        error = res.error;
        return;
      }
      const read = readBackupText(res.text);
      if (read.kind !== 'plain') {
        error = 'Filen kunne ikke læses.';
        return;
      }
      mode = app.clients.length ? 'merge' : 'replace';
      step = { kind: 'preview', backup: read.backup, name: step.name };
    } finally {
      busy = false;
      password = '';
    }
  }

  async function confirm() {
    if (!plan || busy) return;
    busy = true;
    try {
      await app.applyImport(plan);
      const s = plan.stats;
      snackbar.show(
        plan.mode === 'replace'
          ? `Backup hentet: ${n(s.newClients, 'kunde', 'kunder')}, ${n(s.newVisits, 'besøg', 'besøg')}`
          : `Flettet: ${n(s.newClients, 'ny kunde', 'nye kunder')}, ${n(s.newVisits, 'nyt besøg', 'nye besøg')}`
      );
      step = { kind: 'idle' };
      ondone?.();
    } catch {
      error = 'Backup kunne ikke hentes. Intet er ændret.';
    } finally {
      busy = false;
    }
  }
</script>

{#if step.kind === 'idle'}
  <button class="btn outline wide" onclick={pick}><Icon name="upload" size={20} /> Vælg backup-fil</button>
  <p class="note">Virker med filer fra Saloona og fra den gamle Salonbog.</p>
{:else if step.kind === 'password'}
  <form
    class="panel"
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      void unlockFile();
    }}
  >
    <p><b>{step.name}</b> er beskyttet med en adgangskode.</p>
    <label for="imp-pass">Adgangskode</label>
    <input id="imp-pass" class="input" type="password" autocomplete="off" bind:value={password} aria-describedby={error ? 'imp-err' : undefined} />
    <div class="btn-row">
      <button type="button" class="btn outline" onclick={() => (step = { kind: 'idle' })}>Annullér</button>
      <button type="submit" class="btn" disabled={busy || !password}>{busy ? 'Åbner…' : 'Åbn fil'}</button>
    </div>
  </form>
{:else if plan}
  {@const b = step.backup}
  {@const exp = exportedLabel(b)}
  <div class="panel">
    <p class="summary">
      <b>{n(b.clients.length, 'kunde', 'kunder')} og {n(b.visits.length, 'besøg', 'besøg')}</b>
      <span class="muted">{b.source === 'salonbog' ? 'fra Salonbog' : 'fra Saloona'}{exp ? `, gemt ${exp}` : ''}</span>
    </p>
    {#if b.warnings.length}
      <ul class="warnings">
        {#each b.warnings as w, i (i)}<li>{w}</li>{/each}
      </ul>
    {/if}

    {#if app.clients.length}
      <div class="chips" role="radiogroup" aria-label="Hvordan">
        <Chip selected={mode === 'merge'} onclick={() => (mode = 'merge')}>Flet med appen</Chip>
        <Chip selected={mode === 'replace'} onclick={() => (mode = 'replace')}>Erstat alt</Chip>
      </div>
      <p class="note">
        {#if mode === 'merge'}
          Tilføjer {n(plan.stats.newClients, 'ny kunde', 'nye kunder')} og {n(plan.stats.newVisits, 'nyt besøg', 'nye besøg')}.
          {#if plan.stats.duplicateVisits}{n(plan.stats.duplicateVisits, 'besøg', 'besøg')} findes allerede og springes over.{/if}
          Det, der allerede er i appen, bliver ikke ændret.
        {:else}
          Alt i appen nu ({n(app.clients.length, 'kunde', 'kunder')}, {n(app.visits.length, 'besøg', 'besøg')}) bliver erstattet af filen.
        {/if}
      </p>
    {/if}

    <div class="btn-row">
      <button class="btn outline" onclick={() => (step = { kind: 'idle' })}>Annullér</button>
      <button class="btn" class:danger={mode === 'replace' && app.clients.length > 0} class:solid={mode === 'replace' && app.clients.length > 0} disabled={busy} onclick={confirm}>
        {mode === 'replace' && app.clients.length ? 'Erstat alt' : 'Hent backup'}
      </button>
    </div>
  </div>
{/if}
{#if error}<p class="error-text" id="imp-err" role="alert">{error}</p>{/if}

<style>
  .wide {
    width: 100%;
  }
  .panel {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px;
    background: var(--surface);
  }
  .panel p {
    margin: 0 0 10px;
  }
  .panel label {
    display: block;
    font-weight: 620;
    margin-bottom: 8px;
  }
  .panel .btn-row {
    margin-top: 14px;
  }
  .summary {
    display: flex;
    flex-direction: column;
  }
  .summary b {
    font-size: 1.1rem;
  }
  .warnings {
    margin: 0 0 12px;
    padding-left: 18px;
    color: var(--soon);
    font-size: 0.9rem;
  }
</style>
