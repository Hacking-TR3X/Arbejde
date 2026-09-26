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

  // Drag the handle/header down to close, like a native bottom sheet.
  const CLOSE_AT = 110;
  let dragY = $state(0);
  let dragging = $state(false);
  let startY = 0;
  let pointer: number | null = null;

  function dragStart(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    pointer = e.pointerId;
    startY = e.clientY;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function dragMove(e: PointerEvent) {
    if (pointer === e.pointerId) dragY = Math.max(0, e.clientY - startY);
  }
  function dragEnd(e: PointerEvent) {
    if (pointer !== e.pointerId) return;
    pointer = null;
    dragging = false;
    if (dragY > CLOSE_AT) onclose();
    else dragY = 0;
  }
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

<div class="scrim" transition:fade|global={{ duration: motionMs(180) }} onclick={onclose} aria-hidden="true"></div>
<div
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  tabindex="-1"
  bind:this={panel}
  class:dragging
  style:transform={dragY ? `translateY(${dragY}px)` : undefined}
  transition:fly|global={{ y: 60, duration: motionMs(240), easing: cubicOut }}
>
  <div
    class="drag-zone"
    onpointerdown={dragStart}
    onpointermove={dragMove}
    onpointerup={dragEnd}
    onpointercancel={dragEnd}
    role="presentation"
  >
    <div class="grab" aria-hidden="true"></div>
    <header>
      <h2 id={titleId}>{title}</h2>
      <button class="close" aria-label="Luk" onclick={onclose}><Icon name="close" /></button>
    </header>
  </div>
  <div class="body">
    {@render children()}
  </div>
  {#if footer}
    <div class="footer">{@render footer()}</div>
  {/if}
</div>

<style>
  .drag-zone {
    touch-action: none;
    flex: none;
  }
  .sheet:not(.dragging) {
    transition: transform var(--dur) var(--ease);
  }
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
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--sheet-lift);
    outline: none;
  }
  .grab {
    width: 40px;
    height: 4px;
    border-radius: var(--radius-hair);
    background: var(--line-strong);
    margin: 8px auto 0;
    flex: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) 0 var(--gutter);
    flex: none;
  }
  h2 {
    margin: 0;
    min-width: 0;
    font-size: 1.25rem;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .close {
    flex: none;
    width: 48px;
    height: 48px;
    border: 0;
    background: none;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
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
