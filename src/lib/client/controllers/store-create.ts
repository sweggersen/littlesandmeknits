// Controller for /profile/stores/new — store type choice (personal vs
// business), Brønnøysund lookup for the business path, slug auto-fill from the
// name, and form submit with redirect handling.
// Extracted from inline script as part of refactor item 9.

import { bindOnce } from '../dom';

interface BrregData {
  legalName: string;
  address: string;
  businessType: string;
  businessTypeDescription: string;
  foundedDate: string | null;
  status: string;
}

type Mode = 'personal' | 'business';

interface WizardCopy {
  businessConsent: string;
  personalConsent: string;
  submitPersonal: string;
  submitBusiness: string;
}

export function init(): void {
  const orgnrInput = document.getElementById('orgnr-input') as HTMLInputElement | null;
  const lookupBtn = document.getElementById('lookup-btn') as HTMLButtonElement | null;
  const lookupResult = document.getElementById('lookup-result');
  const businessBlock = document.getElementById('business-block');
  const detailsSection = document.getElementById('details-section');
  const nameInput = document.getElementById('name-input') as HTMLInputElement | null;
  const slugInput = document.getElementById('slug-input') as HTMLInputElement | null;
  const submitBtn = document.getElementById('submit-btn');
  const consentText = document.querySelector('[data-consent-text]');
  const errorEl = document.getElementById('error-message');
  const form = document.getElementById('store-form') as HTMLFormElement | null;
  const typeRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-store-type]'),
  );
  if (!form) return;
  // registerController re-runs init() (incl. on the initial hard load); bind
  // once or store creation + the orgnr lookup fire twice.
  if (!bindOnce('store-create', form)) return;

  const copy: WizardCopy = (window as any).__storeWizardCopy ?? {
    businessConsent: '', personalConsent: '', submitPersonal: 'Opprett butikk', submitBusiness: 'Opprett butikk',
  };

  let mode: Mode | null = null;

  function slugify(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function applyMode(next: Mode) {
    mode = next;
    showError(null);
    if (next === 'business') {
      businessBlock?.classList.remove('hidden');
      // Details stay hidden until a successful Brønnøysund lookup.
      detailsSection!.classList.add('hidden');
      lookupResult?.classList.add('hidden');
      if (consentText) consentText.textContent = copy.businessConsent;
      if (submitBtn) submitBtn.textContent = copy.submitBusiness;
    } else {
      // Personal store: no org number. Clear it so it isn't submitted, and go
      // straight to the storefront details.
      businessBlock?.classList.add('hidden');
      lookupResult?.classList.add('hidden');
      if (orgnrInput) orgnrInput.value = '';
      detailsSection!.classList.remove('hidden');
      if (consentText) consentText.textContent = copy.personalConsent;
      if (submitBtn) submitBtn.textContent = copy.submitPersonal;
    }
    // Re-append the "Les mer" link that lives inside the consent span (we blew
    // it away by setting textContent).
    if (consentText) {
      const link = document.createElement('a');
      link.href = '/privacy#butikker';
      link.target = '_blank';
      link.className = 'text-terracotta-500 hover:underline whitespace-nowrap';
      link.textContent = 'Les mer';
      consentText.append(' ', link);
    }
  }

  async function doLookup() {
    const orgnr = (orgnrInput?.value ?? '').replace(/\D/g, '');
    if (orgnr.length !== 9) {
      showError('Organisasjonsnummer må være 9 sifre');
      return;
    }
    showError(null);
    lookupBtn!.disabled = true;
    lookupBtn!.textContent = 'Slår opp …';
    try {
      const res = await fetch(`/api/stores/orgnr-lookup?orgnr=${orgnr}`);
      const data = await res.json();
      if (!data.ok) {
        const errMap: Record<string, string> = {
          invalid_format: 'Ugyldig organisasjonsnummer',
          invalid_checksum: 'Ugyldig sjekksum — sjekk at nummeret er riktig',
          not_found: 'Fant ikke organisasjonen i Brønnøysund',
          network_error: 'Kunne ikke nå Brønnøysund. Prøv igjen.',
          brreg_error: 'Brønnøysund-feil. Prøv igjen.',
        };
        showError(errMap[data.error] ?? 'Ukjent feil');
        return;
      }
      if (data.data.status !== 'normal') {
        const statusLabels: Record<string, string> = {
          deleted: 'slettet', bankrupt: 'konkurs', liquidation: 'under avvikling',
        };
        showError(`Organisasjonen er ${statusLabels[data.data.status]} og kan ikke registreres`);
        return;
      }
      renderResult(data.data);
    } finally {
      lookupBtn!.disabled = false;
      lookupBtn!.textContent = 'Slå opp';
    }
  }

  function renderResult(d: BrregData) {
    document.querySelector('[data-legal-name]')!.textContent = d.legalName;
    document.querySelector('[data-legal-address]')!.textContent = d.address || '';
    document.querySelector('[data-business-type]')!.textContent = d.businessTypeDescription || d.businessType;
    document.querySelector('[data-founded-date]')!.textContent = d.foundedDate || 'ukjent';
    lookupResult!.classList.remove('hidden');
    detailsSection!.classList.remove('hidden');
    if (nameInput && !nameInput.value) nameInput.value = d.legalName;
    if (slugInput && !slugInput.value) slugInput.value = slugify(d.legalName);
  }

  function showError(msg: string | null) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
  }

  typeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) applyMode(radio.value as Mode);
    });
  });

  lookupBtn?.addEventListener('click', doLookup);
  orgnrInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
  });
  nameInput?.addEventListener('input', () => {
    if (slugInput && !slugInput.dataset.manual) {
      slugInput.value = slugify(nameInput.value);
    }
  });
  slugInput?.addEventListener('input', () => { slugInput.dataset.manual = '1'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!mode) { showError('Velg om butikken er personlig eller en bedrift'); return; }
    showError(null);
    const formData = new FormData(form);
    const res = await fetch('/api/stores', { method: 'POST', body: formData });
    if (res.redirected) { window.location.href = res.url; return; }
    if (!res.ok) {
      const text = await res.text();
      showError(text || 'Kunne ikke opprette butikk');
      return;
    }
    const data = await res.json();
    if (data?.redirect) window.location.href = data.redirect;
    else window.location.href = '/profile/stores';
  });
}
