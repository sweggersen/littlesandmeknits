// Square-crop modal for profile avatar uploads. Picks up the file
// chosen via [data-avatar-input], shows the crop modal, lets the
// user zoom + drag inside a 288px round mask, then writes a 512px
// JPEG back into the same input.
//
// Extracted from src/components/profile/AvatarCropper.astro as
// part of refactor item 9.

import { bindOnce } from '../dom';

export function init(): void {
  const fileInput = document.querySelector<HTMLInputElement>('[data-avatar-input]');
  const modal = document.querySelector<HTMLElement>('[data-crop-modal]');
  if (!fileInput || !modal) return;
  if (!bindOnce('avatar-cropper', fileInput)) return;

  const container = modal.querySelector<HTMLElement>('[data-crop-container]')!;
  const img = modal.querySelector<HTMLImageElement>('[data-crop-image]')!;
  const zoom = modal.querySelector<HTMLInputElement>('[data-crop-zoom]')!;
  const cancel = modal.querySelector<HTMLButtonElement>('[data-crop-cancel]')!;
  const confirm = modal.querySelector<HTMLButtonElement>('[data-crop-confirm]')!;

  const CROP = 288; // visible square in CSS px
  const OUT = 512;  // output image px (uploaded to storage)
  let baseScale = 1;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  function applyBounds() {
    const totalScale = baseScale * scale;
    const w = img.naturalWidth * totalScale;
    const h = img.naturalHeight * totalScale;
    tx = clamp(tx, CROP - w, 0);
    ty = clamp(ty, CROP - h, 0);
  }

  function render() {
    applyBounds();
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${baseScale * scale})`;
  }

  function openModal(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        baseScale = CROP / Math.min(img.naturalWidth, img.naturalHeight);
        scale = 1;
        zoom.value = '1';
        tx = (CROP - img.naturalWidth * baseScale) / 2;
        ty = (CROP - img.naturalHeight * baseScale) / 2;
        render();
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    openModal(f);
  });

  zoom.addEventListener('input', () => { scale = parseFloat(zoom.value); render(); });

  function startDrag(x: number, y: number) { dragging = true; lastX = x; lastY = y; container.style.cursor = 'grabbing'; }
  function moveDrag(x: number, y: number) {
    if (!dragging) return;
    tx += (x - lastX); ty += (y - lastY); lastX = x; lastY = y; render();
  }
  function endDrag() { dragging = false; container.style.cursor = 'grab'; }

  container.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup', endDrag);
  container.addEventListener('touchstart', (e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchmove', (e) => { const t = e.touches[0]; moveDrag(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchend', endDrag);

  cancel.addEventListener('click', () => {
    fileInput.value = '';
    closeModal();
  });

  confirm.addEventListener('click', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d')!;
    const totalScale = baseScale * scale;
    const srcX = -tx / totalScale;
    const srcY = -ty / totalScale;
    const srcSize = CROP / totalScale;
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUT, OUT);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) { closeModal(); return; }
    const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(cropped);
    fileInput.files = dt.files;
    document.querySelector<HTMLButtonElement>('[data-sticky-save]')?.classList.remove('hidden');
    const previewUrl = URL.createObjectURL(cropped);
    document.querySelectorAll<HTMLImageElement>('[data-avatar-preview]').forEach((el) => {
      el.src = previewUrl;
    });
    closeModal();
  });

  modal.addEventListener('click', (e) => { if (e.target === modal) { fileInput.value = ''; closeModal(); } });
}
