import { mount } from 'svelte';
import App from './App.svelte';
import './styles/app.css';
import { injectSpeedInsights } from '@vercel/speed-insights';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

// Initialize Vercel Speed Insights
injectSpeedInsights();

export default mount(App, { target });
