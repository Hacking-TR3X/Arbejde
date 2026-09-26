<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import Icon from './icons/Icon.svelte';
  import { motionMs } from './motion';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { title, onclose, children, footer }: Props = $props();

  let panel: HTMLDivElement | undefined = $state();
  const titleId = `sheet-${Math.random().toString(36).slice(2, 8)}`;

  onMount(() => {
    document.body.classList.add('sheet-open');
    const prev = document.activeElement as HTMLElement | null;
    panel?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('sheet-open');
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  });
</script>

<div class="scrim" transition:fade={{ duration: motionMs(180) }} onclick={onclose} aria-hidden="true"></div>
<div
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  tabindex="-1"
  bind:this={panel}
  transition:fly={{ y: 60, duration: motionMs(240), easing: cubicOut }}
>
  <div class="grab" aria-hidden="true"></div>
  <header>
    <h2 id={titleId}>{title}</h2>
    <button class="close" aria-label="Luk" onclick={onclose}><Icon name="close" /></button>
  </header>
  <div class="body">
    {@render children()}
  </div>
  {#if footer}
    <div class="footer">{@render footer()}</div>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 30;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 31;
    max-width: 560px;
    margin: 0 auto;
    max-height: calc(100% - var(--safe-top) - 24px);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-radius: 24px 24px 0 0;
    box-shadow: var(--sheet-lift);
    outline: none;
  }
  .grab {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--line-strong);
    margin: 8px auto 0;
    flex: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 0 var(--gutter);
    flex: none;
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
    letter-spacing: -0.01em;
  }
  .close {
    width: 48px;
    height: 48px;
    border: 0;
    background: none;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }
  .body {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--gutter) 16px;
    flex: 1 1 auto;
  }
  .footer {
    flex: none;
    padding: 10px var(--gutter) calc(12px + var(--safe-bottom));
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
  :global(body.sheet-open) {
    overflow: hidden;
  }
</style>
