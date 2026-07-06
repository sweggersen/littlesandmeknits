// The platform owner emails. These accounts are granted the `admin` role on
// login so the owner always has admin access (bootstraps the very first admin,
// and keeps localhost working where magic-link signups start role-less).
export const OWNER_EMAILS = [
  'ammon.weggersen@gmail.com',
  'sam.mathias.weggersen@gmail.com',
];

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && OWNER_EMAILS.includes(email.toLowerCase());
}
