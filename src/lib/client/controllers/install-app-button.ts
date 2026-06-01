// Install-app prompt button. Captures the beforeinstallprompt event
// at module load time, then on user click either fires the native
// prompt or shows the platform-specific "how to install" help panel
// (iOS / Android / generic).
//
// Extracted from src/components/InstallAppButton.astro as part of
// refactor item 9.

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// Captured at module load — the browser may fire beforeinstallprompt
// before init() runs after astro:page-load.
let deferred: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
});

export function init(): void {
  const root = document.querySelector<HTMLElement>('[data-install-root]');
  const trigger = document.querySelector<HTMLButtonElement>('[data-install-trigger]');
  const help = document.querySelector<HTMLElement>('[data-install-help]');
  const helpClose = document.querySelector<HTMLButtonElement>('[data-install-help-close]');
  const helpIos = document.querySelector<HTMLElement>('[data-install-help-ios]');
  const helpAndroid = document.querySelector<HTMLElement>('[data-install-help-android]');
  const helpGeneric = document.querySelector<HTMLElement>('[data-install-help-generic]');

  if (!root || !trigger || !help || !helpClose) return;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const ua = navigator.userAgent;
  const isIOSLike =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  if (!isStandalone) {
    root.classList.remove('hidden');
  }

  window.addEventListener('appinstalled', () => {
    root.classList.add('hidden');
    deferred = null;
  });

  function openHelp() {
    [helpIos, helpAndroid, helpGeneric].forEach((el) => el?.classList.add('hidden'));
    const target = isIOSLike ? helpIos : isAndroid ? helpAndroid : helpGeneric;
    target?.classList.remove('hidden');
    help!.classList.remove('hidden');
    help!.classList.add('flex');
  }
  function closeHelp() {
    help!.classList.add('hidden');
    help!.classList.remove('flex');
  }

  trigger.addEventListener('click', async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'accepted') root.classList.add('hidden');
        deferred = null;
        return;
      } catch {
        /* fall through to help */
      }
    }
    openHelp();
  });
  helpClose.addEventListener('click', closeHelp);
  help.addEventListener('click', (e) => {
    if (e.target === help) closeHelp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHelp();
  });
}
