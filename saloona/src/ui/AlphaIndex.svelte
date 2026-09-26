<!--
  The letter index along the right edge of the client list, like the phone's contacts:
  put a finger on it and slide up or down to jump between letters. The letter under the
  finger is shown large beside it, with a small tick each time the list jumps.

  It is a touch shortcut only (aria-hidden): the letters are also headings in the list,
  and there is a search field.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { INDEX_LETTERS } from '../domain/text';
  import { haptic } from '../platform';

  interface Props {
    /** Letters that have clients; the others are dimmed and jump to the next one. */
    available: ReadonlySet<string>;
    /** The list; the index starts at its top edge, and sticks below the status bar. */
    anchor: HTMLElement | undefined;
    onpick: (letter: string) => void;
  }
  let { available, anchor, onpick }: Props = $props();

  let strip = $state<HTMLDivElement>();
  let anchorTop = $state(0);
  let active = $state(false);
  let current = $state<string | null>(null);
  let bubbleY = $state(0);
  let frame = 0;

  function place() {
    frame = 0;
    // Frozen while a finger is on it, so the letters stay under the finger.
    if (active || !anchor) return;
    anchorTop = Math.round(anchor.getBoundingClientRect().top);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(place);
  }

  onMount(() => {
    place();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  });

  // The list can move without a scroll (filters, search results closing).
  $effect(() => {
    void available;
    schedule();
  });

  function letterAt(y: number): string {
    const r = strip!.getBoundingClientRect();
    const i = Math.floor(((y - r.top) / r.height) * INDEX_LETTERS.length);
    return INDEX_LETTERS[Math.max(0, Math.min(INDEX_LETTERS.length - 1, i))]!;
  }

  function follow(e: PointerEvent) {
    bubbleY = e.clientY;
    const letter = letterAt(e.clientY);
    if (letter === current) return;
    current = letter;
    if (available.has(letter)) haptic('tick');
    onpick(letter);
  }

  function down(e: PointerEvent) {
    if (!strip) return;
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
    active = true;
    current = null;
    follow(e);
  }

  function up() {
    if (!active) return;
    active = false;
    current = null;
    schedule();
  }
</script>

<div
  class="index"
  class:active
  aria-hidden="true"
  bind:this={strip}
  style:--anchor-top={`${anchorTop}px`}
  onpointerdown={down}
  onpointermove={(e) => active && follow(e)}
  onpointerup={up}
  onpointercancel={up}
  onlostpointercapture={up}
>
  {#each INDEX_LETTERS as l (l)}
    <span class:on={available.has(l)} class:current={current === l}>{l}</span>
  {/each}
</div>

{#if active && current}
  <div class="bubble" class:empty={!available.has(current)} aria-hidden="true" style:top={`${bubbleY}px`}>{current}</div>
{/if}

<style>
  .index {
    position: fixed;
    z-index: 5;
    /* Beside the content column on wide screens, at the edge on phones. */
    right: max(0px, calc(50vw - 280px - 36px));
    top: max(calc(var(--safe-top) + 12px), var(--anchor-top));
    bottom: calc(var(--nav-h) + var(--safe-bottom) + 12px);
    max-height: 640px;
    width: 36px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    font-size: 0.68rem;
    font-weight: 650;
    line-height: 1;
    color: var(--outline);
    border-radius: var(--radius-pill);
    transition: background-color var(--dur) var(--ease);
  }
  .index.active {
    background: var(--accent-soft);
  }
  .index span {
    min-height: 0;
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  .index span.on {
    color: var(--accent);
  }
  .index span.current {
    color: var(--ink);
  }
  .bubble {
    position: fixed;
    z-index: 6;
    right: calc(max(0px, calc(50vw - 280px - 36px)) + 52px);
    width: 64px;
    height: 64px;
    margin-top: -32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 1.9rem;
    font-weight: 620;
    box-shadow: var(--sheet-lift);
    pointer-events: none;
  }
  .bubble.empty {
    background: var(--surface);
    color: var(--muted);
    border: 1px solid var(--line-strong);
  }
</style>
