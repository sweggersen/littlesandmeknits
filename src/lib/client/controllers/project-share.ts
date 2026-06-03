// Project share-panel controller: copy-link button, Instagram
// caption-copy, and feed/story card rendering via html-to-image.
//
// Reads its data from a [data-share-root] element whose data-*
// attributes carry the slug, title, summary, URL and IG handle. The
// card scaffolds live elsewhere in the DOM under
// [data-share-scaffold="feed"] / "story".
//
// Extracted from src/pages/studio/projects/[id].astro inline script
// as part of refactor item 9.

import { bindOnce } from '../dom';

export function init(): void {
  // registerController re-runs init() (incl. on the initial hard load); bind
  // once per share panel so copy-link / caption-copy don't fire twice.
  const guardRoot = document.querySelector<HTMLElement>('[data-share-root]');
  if (!guardRoot || !bindOnce('project-share', guardRoot)) return;

  document.querySelector<HTMLElement>('[data-copy-share]')?.addEventListener('click', () => {
    const input = document.querySelector<HTMLInputElement>('[data-share-url]');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-copy-share]');
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = 'Kopiert ✓';
      setTimeout(() => { btn.textContent = original; }, 1600);
    });
  });

  const shareRoot = document.querySelector<HTMLElement>('[data-share-root]');
  const slug = shareRoot?.dataset.shareSlug ?? null;
  const shareTitle = shareRoot?.dataset.shareTitle ?? '';
  const shareSummary = shareRoot?.dataset.shareSummary ?? '';
  const shareUrlValue = shareRoot?.dataset.shareUrl ?? '';
  const shareHandle = shareRoot?.dataset.shareHandle ?? '';

  function buildCaption(): string {
    const lines: string[] = [];
    if (shareTitle) lines.push(shareTitle);
    if (shareSummary) lines.push('', shareSummary);
    lines.push('');
    if (shareHandle) {
      lines.push(`Strikket av @${shareHandle}`);
    }
    if (shareUrlValue) lines.push(`Hele prosjektet: ${shareUrlValue}`);
    lines.push('', '#strikking #strikkemamma #littlesandme');
    return lines.join('\n');
  }

  const captionBtn = document.querySelector<HTMLButtonElement>('[data-share-caption]');
  captionBtn?.addEventListener('click', async () => {
    const caption = buildCaption();
    const status = document.querySelector<HTMLElement>('[data-share-status]');
    const setStatus = (msg: string) => { if (status) status.textContent = msg; };
    try {
      await navigator.clipboard.writeText(caption);
      const original = captionBtn.textContent;
      captionBtn.textContent = 'Kopiert ✓';
      setStatus('Caption kopiert til utklippstavla. Lim inn på Instagram.');
      setTimeout(() => { if (captionBtn) captionBtn.textContent = original; }, 2000);
    } catch {
      setStatus('Klarte ikke å kopiere — marker tekst manuelt og prøv igjen.');
    }
  });

  if (slug) {
    const status = document.querySelector<HTMLElement>('[data-share-status]');
    const setStatus = (msg: string) => { if (status) status.textContent = msg; };

    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-share-card]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const format = btn.getAttribute('data-share-card');
        if (!format) return;
        const scaffold = document.querySelector<HTMLElement>(`[data-share-scaffold="${format}"]`);
        if (!scaffold) return;

        buttons.forEach((b) => { b.disabled = true; });
        const originalLabel = btn.textContent;
        btn.textContent = 'Genererer…';

        try {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          const { toPng } = await import('html-to-image');
          const dataUrl = await toPng(scaffold, {
            pixelRatio: 1,
            cacheBust: true,
            // Avoid CORS taint on Supabase-hosted hero photos.
            fetchRequestInit: { mode: 'cors', credentials: 'omit' },
          });
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${slug}-${format}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setStatus('Lastet ned. Last opp på Instagram, og lim inn lenken i caption.');
        } catch (err) {
          console.error('share card render failed', err);
          setStatus('Kunne ikke lage delingskort. Prøv igjen, eller bruk hovedbildet manuelt.');
        } finally {
          buttons.forEach((b) => { b.disabled = false; });
          btn.textContent = originalLabel;
        }
      });
    });
  }
}
