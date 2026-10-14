import { mount } from 'svelte';
import App from './App.svelte';
import './styles/app.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

// Optional analytics stays disabled until a consent-aware lifecycle is approved.

export default mount(App, { target });
