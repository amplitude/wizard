import { track } from './amplitude.js';

document.getElementById('signup')?.addEventListener('click', () => {
  track('Page Viewed', { 'page name': 'signup' });
});
