import { registerServiceWorker } from './pwa/register';

// Foundation placeholder UI. Feature agents replace this with the real app.
function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  const heading = document.createElement('h1');
  heading.textContent = 'Google Tasks Swipe';
  app.appendChild(heading);
}

render();
registerServiceWorker();
