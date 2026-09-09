import { describe, it, expect } from 'vitest';
import { sectionEnabled, enabledSections, SECTIONS } from './sections';

describe('sectionEnabled (default-on)', () => {
  it('is enabled when no flag is set', async () => {
    expect(await sectionEnabled('oppdrag', {})).toBe(true);
  });

  it('is disabled only when the flag is explicitly off', async () => {
    expect(await sectionEnabled('oppdrag', { FLAG_SECTION_OPPDRAG: 'off' })).toBe(false);
    expect(await sectionEnabled('oppdrag', { FLAG_SECTION_OPPDRAG: '0' })).toBe(false);
    expect(await sectionEnabled('oppdrag', { FLAG_SECTION_OPPDRAG: 'false' })).toBe(false);
    expect(await sectionEnabled('oppdrag', { FLAG_SECTION_OPPDRAG: 'no' })).toBe(false);
    expect(await sectionEnabled('oppdrag', { FLAG_SECTION_OPPDRAG: 'OFF' })).toBe(false); // case-insensitive
  });

  it('stays enabled for any non-off value (on / garbage / empty)', async () => {
    expect(await sectionEnabled('brukt', { FLAG_SECTION_BRUKT: 'on' })).toBe(true);
    expect(await sectionEnabled('brukt', { FLAG_SECTION_BRUKT: 'yes' })).toBe(true);
    expect(await sectionEnabled('brukt', { FLAG_SECTION_BRUKT: '' })).toBe(true);
    expect(await sectionEnabled('brukt', { FLAG_SECTION_BRUKT: 'wibble' })).toBe(true);
  });

  it('only its own flag affects a section', async () => {
    const src = { FLAG_SECTION_OPPDRAG: 'off' };
    expect(await sectionEnabled('oppdrag', src)).toBe(false);
    expect(await sectionEnabled('brukt', src)).toBe(true);
    expect(await sectionEnabled('profil', src)).toBe(true);
  });
});

describe('unlaunched sections (default-off)', () => {
  it('oppskrifter is off by default (not launched)', async () => {
    expect(await sectionEnabled('oppskrifter', {})).toBe(false);
  });

  it('oppskrifter turns on only with an EXPLICIT on flag', async () => {
    expect(await sectionEnabled('oppskrifter', { FLAG_SECTION_OPPSKRIFTER: 'on' })).toBe(true);
    expect(await sectionEnabled('oppskrifter', { FLAG_SECTION_OPPSKRIFTER: '1' })).toBe(true);
    expect(await sectionEnabled('oppskrifter', { FLAG_SECTION_OPPSKRIFTER: 'off' })).toBe(false);
    // Garbage is not "on" for an unlaunched section (unlike default-on sections).
    expect(await sectionEnabled('oppskrifter', { FLAG_SECTION_OPPSKRIFTER: 'wibble' })).toBe(false);
  });
});

describe('enabledSections', () => {
  it('returns a verdict for every known section', async () => {
    const map = await enabledSections({ FLAG_SECTION_BUTIKKER: 'off', FLAG_SECTION_OPPDRAG: 'off' });
    expect(Object.keys(map).sort()).toEqual([...SECTIONS].sort());
    expect(map.butikker).toBe(false);
    expect(map.oppdrag).toBe(false);
    expect(map.profil).toBe(true);
    expect(map.strikkestua).toBe(true);
  });
});
