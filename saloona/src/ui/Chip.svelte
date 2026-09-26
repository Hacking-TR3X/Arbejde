<!--
  One chip. `kind` decides the semantics:
  - 'radio'  : one of several choices (put the chips in a role="radiogroup")
  - 'toggle' : a suggestion that can be on (aria-pressed)
  - 'action' : a plain shortcut, no state
  A selected chip shows a check mark in front of the label, so the state is never shown
  by colour alone. A leading `icon` is swapped for the check mark while selected.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';

  interface Props {
    kind?: 'radio' | 'toggle' | 'action';
    selected?: boolean;
    icon?: IconName;
    onclick: () => void;
    children: Snippet;
  }
  let { kind = 'radio', selected = false, icon, onclick, children }: Props = $props();

  const on = $derived(kind !== 'action' && selected);
</script>

<button
  type="button"
  class="chip"
  class:lead={on || !!icon}
  role={kind === 'radio' ? 'radio' : undefined}
  aria-checked={kind === 'radio' ? selected : undefined}
  aria-pressed={kind === 'toggle' ? selected : undefined}
  {onclick}
>
  {#if on}<Icon name="check" size={18} />{:else if icon}<Icon name={icon} size={18} />{/if}
  <span class="lbl">{@render children()}</span>
</button>

<style>
  .lbl {
    min-width: 0;
  }
</style>
