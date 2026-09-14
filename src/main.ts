import './styles/theme.css';
import { registerServiceWorker } from './pwa/register';
import { AppController } from './app/controller';
import { AppRoot } from './ui/app-root';

/**
 * App bootstrap: mount the shell, hand it a controller, and start the boot
 * flow (theme → auth check → connect-or-load). Then register the service worker.
 */
function main(): void {
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (!mount) return;

  const controller = new AppController();
  const root = new AppRoot();
  root.controller = controller;
  mount.replaceChildren(root);

  void controller.boot();
  registerServiceWorker();
}

main();
