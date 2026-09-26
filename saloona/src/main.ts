import { mount } from 'svelte';
// Global styles first, so component (scoped) styles win over them at equal specificity.
import './styles/app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Mangler #app');
mount(App, { target });
