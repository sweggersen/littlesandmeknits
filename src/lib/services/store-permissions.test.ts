import { describe, it, expect } from 'vitest';
import { atLeast, can, canAssignRole, ROLE_LABEL_NB } from './store-permissions';

describe('atLeast', () => {
  it('respects role rank order', () => {
    expect(atLeast('owner', 'contributor')).toBe(true);
    expect(atLeast('owner', 'admin')).toBe(true);
    expect(atLeast('owner', 'owner')).toBe(true);
    expect(atLeast('admin', 'owner')).toBe(false);
    expect(atLeast('contributor', 'manager')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(atLeast(null, 'contributor')).toBe(false);
    expect(atLeast(undefined, 'owner')).toBe(false);
  });
});

describe('can.X (permission predicates)', () => {
  it('only owner can delete the store', () => {
    expect(can.deleteStore('owner')).toBe(true);
    expect(can.deleteStore('admin')).toBe(false);
    expect(can.deleteStore('manager')).toBe(false);
    expect(can.deleteStore('contributor')).toBe(false);
    expect(can.deleteStore(null)).toBe(false);
  });

  it('admin+ can manage members', () => {
    expect(can.manageMembers('owner')).toBe(true);
    expect(can.manageMembers('admin')).toBe(true);
    expect(can.manageMembers('manager')).toBe(false);
    expect(can.manageMembers('contributor')).toBe(false);
  });

  it('manager+ can edit store settings', () => {
    expect(can.editStoreSettings('owner')).toBe(true);
    expect(can.editStoreSettings('admin')).toBe(true);
    expect(can.editStoreSettings('manager')).toBe(true);
    expect(can.editStoreSettings('contributor')).toBe(false);
  });

  it('manager+ can edit any listing; contributor only edits own', () => {
    expect(can.editAnyListing('manager')).toBe(true);
    expect(can.editAnyListing('contributor')).toBe(false);
    expect(can.editOwnListing('contributor')).toBe(true);
    expect(can.editOwnListing(null)).toBe(false);
  });

  it('only owner can edit Stripe + withdraw', () => {
    expect(can.editStripeSettings('owner')).toBe(true);
    expect(can.editStripeSettings('admin')).toBe(false);
    expect(can.withdrawFunds('owner')).toBe(true);
    expect(can.withdrawFunds('admin')).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('owner can assign any role', () => {
    expect(canAssignRole('owner', 'owner')).toBe(true);
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'contributor')).toBe(true);
  });

  it('admin can assign any role except owner', () => {
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'manager')).toBe(true);
    expect(canAssignRole('admin', 'contributor')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
  });

  it('manager and contributor cannot assign roles', () => {
    expect(canAssignRole('manager', 'contributor')).toBe(false);
    expect(canAssignRole('contributor', 'contributor')).toBe(false);
    expect(canAssignRole(null, 'contributor')).toBe(false);
  });
});

describe('role labels', () => {
  it('has Norwegian label for every role', () => {
    expect(ROLE_LABEL_NB.owner).toBeTruthy();
    expect(ROLE_LABEL_NB.admin).toBeTruthy();
    expect(ROLE_LABEL_NB.manager).toBeTruthy();
    expect(ROLE_LABEL_NB.contributor).toBeTruthy();
  });
});
