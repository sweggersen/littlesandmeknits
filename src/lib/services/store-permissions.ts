// Centralised permission predicates for stores. Single source of truth — used
// by service layer, API routes, page guards, and (later) mobile app.

import type { StoreRole } from '../types/stores';

/** Role -> ordinal rank for inheritance checks. Higher rank inherits lower-rank powers. */
const RANK: Record<StoreRole, number> = {
  contributor: 0,
  manager: 1,
  admin: 2,
  owner: 3,
};

export function atLeast(role: StoreRole | null | undefined, min: StoreRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/** ---------------- Granular permissions ---------------- */

export const can = {
  // Store-level
  deleteStore: (role: StoreRole | null) => role === 'owner',
  transferOwnership: (role: StoreRole | null) => role === 'owner',
  editStripeSettings: (role: StoreRole | null) => role === 'owner',
  withdrawFunds: (role: StoreRole | null) => role === 'owner',

  manageMembers: (role: StoreRole | null) => atLeast(role, 'admin'),
  inviteMembers: (role: StoreRole | null) => atLeast(role, 'admin'),
  removeMembers: (role: StoreRole | null) => atLeast(role, 'admin'),
  changeMemberRole: (role: StoreRole | null) => atLeast(role, 'admin'),

  editStoreSettings: (role: StoreRole | null) => atLeast(role, 'manager'),
  editBranding: (role: StoreRole | null) => atLeast(role, 'manager'),

  viewFinances: (role: StoreRole | null) => atLeast(role, 'manager'),

  // Listings
  createListing: (role: StoreRole | null) => atLeast(role, 'contributor'),
  editAnyListing: (role: StoreRole | null) => atLeast(role, 'manager'),
  editOwnListing: (role: StoreRole | null) => atLeast(role, 'contributor'),

  // Messaging
  respondToAnyMessage: (role: StoreRole | null) => atLeast(role, 'manager'),
  respondToOwnListingMessage: (role: StoreRole | null) => atLeast(role, 'contributor'),
};

/** Role assignment rules: who can be assigned to whom. */
export function canAssignRole(actor: StoreRole | null, target: StoreRole): boolean {
  if (!actor) return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner'; // admins can't promote to owner
  return false;
}

/** Display label for a role (Norwegian Bokmål). */
export const ROLE_LABEL_NB: Record<StoreRole, string> = {
  owner: 'Eier',
  admin: 'Administrator',
  manager: 'Forvalter',
  contributor: 'Bidragsyter',
};

export const ROLE_DESCRIPTION_NB: Record<StoreRole, string> = {
  owner: 'Full kontroll. Kan slette og overdra butikken.',
  admin: 'Kan administrere medlemmer og alle innstillinger.',
  manager: 'Kan redigere butikkdetaljer og alle annonser.',
  contributor: 'Kan opprette og redigere egne annonser.',
};
