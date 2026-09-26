<!--
  Renders one icon from ICONS. Decorative by default (aria-hidden). Pass `label` when the
  icon carries meaning on its own, for example an icon-only button without visible text.
  No {@html} and no inline styles: the strict CSP (style-src 'self') would block them.
-->
<script lang="ts">
  import { ICONS, type IconName } from './icons';

  interface Props {
    name: IconName;
    /** Rendered size in CSS px. The drawing always uses a 24 x 24 viewBox. */
    size?: number;
    /** Accessible name. Without it the icon is hidden from assistive technology. */
    label?: string;
  }

  let { name, size = 24, label }: Props = $props();
</script>

<svg
  class="icon"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  focusable="false"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  {#each ICONS[name] as d}<path {d} />{/each}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
