<script lang="ts">
  import { fly } from 'svelte/transition';
  import { snackbar } from '../lib/snackbar.svelte';
  import { motionMs } from './motion';
</script>

<div class="wrap" role="status" aria-live="polite">
  {#if snackbar.current}
    {#key snackbar.current.id}
      <div class="bar" transition:fly={{ y: 24, duration: motionMs(180) }}>
        <span class="text">{snackbar.current.text}</span>
        {#if snackbar.current.action}
          <button class="act" onclick={() => snackbar.runAction()}>{snackbar.current.action.label}</button>
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .wrap {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--nav-h) + var(--safe-bottom) + 12px);
    z-index: 40;
    display: flex;
    justify-content: center;
    pointer-events: none;
    padding: 0 16px;
  }
  .bar {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 528px;
    width: 100%;
    min-height: 52px;
    padding: 6px 6px 6px 18px;
    border-radius: var(--radius-btn);
    background: var(--ink);
    color: var(--bg);
    font-size: 0.94rem;
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    padding: var(--space-1) 0;
  }
  .act {
    flex: none;
    min-height: var(--tap);
    min-width: var(--tap);
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-xs);
    background: none;
    color: var(--snack-action);
    font-weight: 700;
  }
</style>
