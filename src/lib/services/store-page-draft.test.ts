import { describe, it, expect } from 'vitest';
import { createFakeDb, type FakeDb } from './__test_helpers__/fake-db';
import type { ServiceContext } from './types';
import {
  saveStoreDraft,
  publishStoreDraft,
  applyPresetToDraft,
  resetStoreDraft,
} from './store-page';
import { getPreset } from '../store-presets';
import { sanitizeStoreTheme } from '../store-theme';
import { sanitizePageConfig } from '../store-blocks';

const STORE_ID = 'store-1';
const EDITOR = 'editor-1';
const OUTSIDER = 'outsider-1';

// Seed a store owned/managed by EDITOR; OUTSIDER is not a member.
function seed(): FakeDb {
  return createFakeDb({
    stores: [{ id: STORE_ID, theme: null, page_config: null, theme_draft: null, page_config_draft: null }],
    store_members: [{ store_id: STORE_ID, user_id: EDITOR, role: 'manager' }],
  });
}

function ctxFor(db: FakeDb, userId: string): ServiceContext {
  return {
    supabase: db.client as any,
    admin: db.client as any,
    user: { id: userId, email: `${userId}@x.io` },
    env: {} as any,
  };
}

describe('store-page draft services', () => {
  it('saveStoreDraft writes sanitised theme + page_config to the *_draft columns', async () => {
    const db = seed();
    const r = await saveStoreDraft(ctxFor(db, EDITOR), STORE_ID, {
      theme: { colors: { primary: '#123456' }, fontDisplay: 'fraunces', fontBody: 'inter' },
      pageConfig: { blocks: [{ id: 'x', type: 'hero', layout: { x: 0, y: 0, w: 12, h: 3 }, props: {} }] },
    });
    expect(r.ok).toBe(true);
    const row = db.find('stores', { id: STORE_ID })!;
    // draft columns written, LIVE columns untouched.
    expect((row.theme_draft as any).colors.primary).toBe('#123456');
    expect((row.page_config_draft as any).blocks).toHaveLength(1);
    expect(row.theme).toBeNull();
    expect(row.page_config).toBeNull();
  });

  it('saveStoreDraft only writes the keys provided (page_config only leaves theme_draft alone)', async () => {
    const db = seed();
    await saveStoreDraft(ctxFor(db, EDITOR), STORE_ID, {
      pageConfig: { blocks: [] },
    });
    const row = db.find('stores', { id: STORE_ID })!;
    expect(row.page_config_draft).toEqual({ blocks: [] });
    expect(row.theme_draft).toBeNull(); // not touched
  });

  it('saveStoreDraft drops unknown block types (server re-sanitises)', async () => {
    const db = seed();
    await saveStoreDraft(ctxFor(db, EDITOR), STORE_ID, {
      pageConfig: { blocks: [{ id: 'evil', type: 'script', layout: {}, props: {} }] },
    });
    const row = db.find('stores', { id: STORE_ID })!;
    expect((row.page_config_draft as any).blocks).toHaveLength(0);
  });

  it('saveStoreDraft is forbidden for a non-member', async () => {
    const db = seed();
    const r = await saveStoreDraft(ctxFor(db, OUTSIDER), STORE_ID, { theme: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
    expect(db.find('stores', { id: STORE_ID })!.theme_draft).toBeNull();
  });

  it('applyPresetToDraft writes the preset to the draft, not live', async () => {
    const db = seed();
    const r = await applyPresetToDraft(ctxFor(db, EDITOR), STORE_ID, 'varm-klassisk');
    expect(r.ok).toBe(true);
    const preset = getPreset('varm-klassisk')!;
    const row = db.find('stores', { id: STORE_ID })!;
    expect(row.theme_draft).toEqual(sanitizeStoreTheme(preset.theme));
    expect(row.page_config_draft).toEqual(sanitizePageConfig(preset.page_config));
    expect(row.theme).toBeNull(); // live untouched until publish
  });

  it('applyPresetToDraft rejects an unknown preset', async () => {
    const db = seed();
    const r = await applyPresetToDraft(ctxFor(db, EDITOR), STORE_ID, 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('publishStoreDraft copies the (re-sanitised) draft to live and mirrors it back', async () => {
    const db = seed();
    await applyPresetToDraft(ctxFor(db, EDITOR), STORE_ID, 'dristig');
    const r = await publishStoreDraft(ctxFor(db, EDITOR), STORE_ID);
    expect(r.ok).toBe(true);
    const preset = getPreset('dristig')!;
    const row = db.find('stores', { id: STORE_ID })!;
    expect(row.theme).toEqual(sanitizeStoreTheme(preset.theme));
    expect(row.page_config).toEqual(sanitizePageConfig(preset.page_config));
    // draft stays mirrored to what went live
    expect(row.theme_draft).toEqual(row.theme);
    expect(row.page_config_draft).toEqual(row.page_config);
  });

  it('publishStoreDraft with no draft falls back to live (safe no-op)', async () => {
    const db = createFakeDb({
      stores: [{
        id: STORE_ID,
        theme: sanitizeStoreTheme({ colors: { primary: '#ABCDEF' } }),
        page_config: { blocks: [] },
        theme_draft: null,
        page_config_draft: null,
      }],
      store_members: [{ store_id: STORE_ID, user_id: EDITOR, role: 'owner' }],
    });
    const r = await publishStoreDraft(ctxFor(db, EDITOR), STORE_ID);
    expect(r.ok).toBe(true);
    const row = db.find('stores', { id: STORE_ID })!;
    expect((row.theme as any).colors.primary).toBe('#ABCDEF');
  });

  it('publishStoreDraft is forbidden for a non-member', async () => {
    const db = seed();
    const r = await publishStoreDraft(ctxFor(db, OUTSIDER), STORE_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('resetStoreDraft clears both draft columns', async () => {
    const db = seed();
    await applyPresetToDraft(ctxFor(db, EDITOR), STORE_ID, 'ren-minimal');
    const r = await resetStoreDraft(ctxFor(db, EDITOR), STORE_ID);
    expect(r.ok).toBe(true);
    const row = db.find('stores', { id: STORE_ID })!;
    expect(row.theme_draft).toBeNull();
    expect(row.page_config_draft).toBeNull();
  });
});
