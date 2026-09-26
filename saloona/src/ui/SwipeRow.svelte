<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './icons/Icon.svelte';

  interface Props {
    onremove: () => void;
    label: string;
    children: Snippet;
  }
  let { onremove, label, children }: Props = $props();

  const THRESHOLD = 96;
  let dx = $state(0);
  let dragging = $state(false);
  let startX = 0;
  let startY = 0;
  let decided: 'h' | 'v' | null = null;
  let pointerId: number | null = null;

  function down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    decided = null;
    pointerId = e.pointerId;
  }
  function move(e: PointerEvent) {
    if (pointerId !== e.pointerId) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
      if (decided === 'h') {
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    }
    if (decided === 'h') dx = Math.min(0, mx);
  }
  function up() {
    if (decided === 'h') {
      if (dx < -THRESHOLD) {
        dx = -window.innerWidth;
        setTimeout(onremove, 120);
      } else dx = 0;
    }
    dragging = false;
    decided = null;
    pointerId = null;
  }
  function click(e: MouseEvent) {
    // A swipe must not also count as a tap on the row.
    if (dx !== 0) {
      e.stopPropagation();
      e.preventDefault();
    }
  }
</script>

<div class="swipe" class:armed={dx < -THRESHOLD}>
  <div class="behind" aria-hidden="true"><Icon name="trash" /><span>Slet</span></div>
  <div
    class="front"
    class:dragging
    style:transform={dx ? `translateX(${dx}px)` : undefined}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onclickcapture={click}
    role="presentation"
  >
    {@render children()}
  </div>
  <!-- For keyboard and screen reader users. Hidden until it gets keyboard focus. -->
  <button class="del" onclick={onremove}>{label}</button>
</div>

<style>
  .swipe {
    position: relative;
    overflow: hidden;
    background: var(--late-soft);
  }
  .behind {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding-right: 20px;
    color: var(--late);
    font-weight: 620;
    font-size: 0.9rem;
  }
  .armed .behind {
    color: var(--danger-ink);
    background: var(--late);
  }
  .del {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .del:focus-visible {
    width: auto;
    height: auto;
    margin: 0;
    clip-path: none;
    top: 50%;
    right: var(--space-3);
    transform: translateY(-50%);
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--late);
    color: var(--danger-ink);
    font-weight: 620;
    outline-offset: 2px;
  }
  .front {
    position: relative;
    background: var(--surface);
    touch-action: pan-y;
    transition: transform var(--dur) var(--ease);
  }
  .front.dragging {
    transition: none;
  }
</style>
