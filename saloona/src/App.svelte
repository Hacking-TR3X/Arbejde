<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/app.svelte';
  import { nav } from './lib/nav.svelte';
  import NavBar from './ui/NavBar.svelte';
  import Snackbar from './ui/Snackbar.svelte';
  import DueScreen from './screens/DueScreen.svelte';
  import ClientsScreen from './screens/ClientsScreen.svelte';
  import ClientScreen from './screens/ClientScreen.svelte';
  import MoneyScreen from './screens/MoneyScreen.svelte';
  import MissingScreen from './screens/MissingScreen.svelte';
  import MoreScreen from './screens/MoreScreen.svelte';
  import BackupScreen from './screens/BackupScreen.svelte';
  import SecurityScreen from './screens/SecurityScreen.svelte';
  import PrivacyScreen from './screens/PrivacyScreen.svelte';
  import AboutScreen from './screens/AboutScreen.svelte';
  import VisitSheet from './screens/VisitSheet.svelte';
  import ClientSheet from './screens/ClientSheet.svelte';
  import LockScreen from './screens/LockScreen.svelte';
  import Onboarding from './screens/Onboarding.svelte';
  import StartupProblem from './screens/StartupProblem.svelte';

  onMount(() => {
    nav.init();
    void app.start();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => app.applyTheme());
  });

  const page = $derived(nav.page);
  const sheet = $derived(nav.state.sheet);
</script>

{#if app.phase === 'loading'}
  <div class="loading" aria-busy="true"></div>
{:else if app.phase !== 'ready'}
  <StartupProblem />
{:else if app.locked}
  <LockScreen />
{:else if !app.settings.onboarded && app.clients.length === 0}
  <Onboarding />
{:else}
  <main inert={!!sheet}>
    {#if page}
      {#key page}
        {#if page.name === 'client'}<ClientScreen id={page.id} />
        {:else if page.name === 'backup'}<BackupScreen />
        {:else if page.name === 'security'}<SecurityScreen />
        {:else if page.name === 'privacy'}<PrivacyScreen />
        {:else if page.name === 'about'}<AboutScreen />
        {:else if page.name === 'missing'}<MissingScreen />
        {/if}
      {/key}
    {:else if nav.state.tab === 'due'}<DueScreen />
    {:else if nav.state.tab === 'clients'}<ClientsScreen />
    {:else if nav.state.tab === 'money'}<MoneyScreen />
    {:else}<MoreScreen />
    {/if}
  </main>
  <div inert={!!sheet}><NavBar /></div>

  {#if sheet}
    {#key sheet}
      {#if sheet.name === 'visit'}
        <VisitSheet visitId={sheet.visitId} clientId={sheet.clientId} prefillName={sheet.prefillName} />
      {:else}
        <ClientSheet clientId={sheet.clientId} prefillName={sheet.prefillName} />
      {/if}
    {/key}
  {/if}
{/if}

<Snackbar />

<style>
  .loading {
    min-height: 100vh;
    background: var(--bg);
  }
</style>
