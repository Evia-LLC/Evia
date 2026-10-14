import { mount } from 'svelte';
import App from './App.svelte';
import './styles/app.css';
// Experimental studio presentation layer; loaded after legacy functional rules.
import './styles/studio.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

// Optional analytics remains disabled pending a consent-aware lifecycle.

export default mount(App, { target });
