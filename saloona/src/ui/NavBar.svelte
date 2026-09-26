<script lang="ts">
  import { nav, type Tab } from '../lib/nav.svelte';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';
  import { motionMs } from './motion';

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'due', label: 'Snart tid', icon: 'clock' },
    { id: 'clients', label: 'Kunder', icon: 'people' }
  ];
  const tabsRight: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'money', label: 'Indtjening', icon: 'chart' },
    { id: 'more', label: 'Mere', icon: 'more' }
  ];

  function go(tab: Tab) {
    if (nav.state.tab === tab && nav.state.pages.length === 0) {
      window.scrollTo({ top: 0, behavior: motionMs(1) ? 'smooth' : 'auto' });
      return;
    }
    nav.switchTab(tab);
  }
</script>

{#snippet tabButton(t: { id: Tab; label: string; icon: IconName })}
  <button class="tab" aria-current={nav.state.tab === t.id ? 'page' : undefined} onclick={() => go(t.id)}>
    <span class="ic"><Icon name={t.icon} /></span>
    <span class="lbl">{t.label}</span>
  </button>
{/snippet}

<nav aria-label="Hovedmenu">
  <div class="inner">
    {#each tabs as t (t.id)}{@render tabButton(t)}{/each}
    <button class="tab add" aria-label="Nyt besøg" onclick={() => nav.openSheet({ name: 'visit' })}>
      <span class="plus"><Icon name="plus" size={26} /></span>
    </button>
    {#each tabsRight as t (t.id)}{@render tabButton(t)}{/each}
  </div>
</nav>

<style>
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    background: var(--nav-bg);
    border-top: 1px solid var(--line);
    padding-bottom: var(--safe-bottom);
  }
  .inner {
    max-width: 560px;
    margin: 0 auto;
    min-height: var(--nav-h);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    align-items: center;
    padding: 0 4px;
  }
  .tab {
    background: none;
    border: 0;
    align-self: stretch;
    min-width: 48px;
    min-height: var(--tap);
    padding: 6px 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.2;
  }
  .lbl {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ic {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 30px;
    border-radius: var(--radius-pill);
    transition: background var(--dur) var(--ease);
  }
  .tab[aria-current='page'] {
    color: var(--accent);
    font-weight: 620;
  }
  .tab[aria-current='page'] .ic {
    background: var(--accent-soft);
  }
  .plus {
    width: 54px;
    height: 54px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--dur) var(--ease);
  }
  .add:active .plus {
    background: var(--accent-press);
  }
</style>
