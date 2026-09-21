import { mount } from 'svelte';
import App from './App.svelte';
import './styles/app.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

// Art review is isolated from accounts, camera capture and health records, and
// removed from production builds by Vite's DEV constant.
if (import.meta.env.DEV && location.pathname === '/studio') {
  void import('./dev/StudioPreview.svelte').then(({ default: StudioPreview }) => mount(StudioPreview, { target }));
} else {
  mount(App, { target });
}
