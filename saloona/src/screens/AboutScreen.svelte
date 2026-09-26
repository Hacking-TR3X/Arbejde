<script lang="ts">
  import { nav } from '../lib/nav.svelte';
  import Icon from '../ui/icons/Icon.svelte';

  const version = __APP_VERSION__;
</script>

<div class="screen">
  <button class="back link" onclick={() => nav.back()}><Icon name="back" size={20} /> Mere</button>
  <h1 class="brand">Saloona</h1>
  <p>En lille kundebog til en frisør, der klipper hjemme. Hvem kommer snart igen, hvad har de fået, og hvad er der tjent.</p>
  <div class="group facts">
    <div class="row"><span class="grow">Version</span><span class="end">{version}</span></div>
    <div class="row"><span class="grow">Internetadgang</span><span class="end">Ingen</span></div>
    <div class="row"><span class="grow">Data</span><span class="end">Kun på telefonen, krypteret</span></div>
  </div>
  <h2>Skrifttyper</h2>
  <p class="note">Italiana (Santiago Orozco) og Bricolage Grotesque (Ateliertriay) under SIL Open Font License 1.1.</p>
</div>

<style>
  .facts {
    margin-top: 16px;
  }
  .facts .end {
    white-space: normal;
  }
</style>
