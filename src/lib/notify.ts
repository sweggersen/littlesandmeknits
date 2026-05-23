import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './email';
import { renderEmail } from './email-templates';
import { sendPushNotification } from './web-push';

export type NotificationType =
  | 'new_offer'
  | 'offer_accepted'
  | 'offer_declined'
  | 'payment_received'
  | 'project_update'
  | 'new_message'
  | 'yarn_shipped'
  | 'yarn_received'
  | 'commission_completed'
  | 'commission_delivered'
  | 'request_expired'
  | 'item_approved'
  | 'item_rejected'
  | 'item_reported'
  | 'moderation_assigned'
  | 'moderation_new_item'
  | 'moderation_shadow_pending'
  | 'role_changed'
  | 'review_received'
  | 'listing_purchased'
  | 'listing_shipped'
  | 'listing_delivered'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'achievement_unlocked'
  | 'moderation_message';

const EMAIL_PREF_COL: Record<NotificationType, string> = {
  new_offer: 'email_new_offer',
  offer_accepted: 'email_offer_accepted',
  offer_declined: 'email_offer_declined',
  payment_received: 'email_payment_received',
  project_update: 'email_project_update',
  new_message: 'email_new_message',
  yarn_shipped: 'email_yarn_shipped',
  yarn_received: 'email_yarn_received',
  commission_completed: 'email_commission_completed',
  commission_delivered: 'email_commission_delivered',
  request_expired: 'email_request_expired',
  item_approved: 'email_item_approved',
  item_rejected: 'email_item_rejected',
  item_reported: 'email_item_approved',
  moderation_assigned: 'email_item_approved',
  moderation_new_item: 'email_item_approved',
  moderation_shadow_pending: 'email_item_approved',
  role_changed: 'email_item_approved',
  review_received: 'email_review_received',
  listing_purchased: 'email_listing_purchased',
  listing_shipped: 'email_listing_shipped',
  listing_delivered: 'email_listing_delivered',
  dispute_opened: 'email_item_approved',
  dispute_resolved: 'email_item_approved',
  achievement_unlocked: 'email_item_approved',
  moderation_message: 'email_item_approved',
};

interface NotifyEnv {
  RESEND_API_KEY?: string;
  PUBLIC_SITE_URL?: string;
  PUBLIC_VAPID_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export async function createNotification(
  admin: SupabaseClient,
  opts: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    url?: string;
    actorId?: string;
    referenceId?: string;
  },
  env?: NotifyEnv,
): Promise<void> {
  await admin.from('notifications').insert({
    user_id: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? null,
    url: opts.url ?? null,
    actor_id: opts.actorId ?? null,
    reference_id: opts.referenceId ?? null,
  });

  const apiKey = env?.RESEND_API_KEY;
  const siteUrl = env?.PUBLIC_SITE_URL;
  if (!apiKey || !siteUrl) return;

  try {
    const { data: prefs } = await admin
      .from('notification_preferences')
      .select(EMAIL_PREF_COL[opts.type])
      .eq('user_id', opts.userId)
      .maybeSingle();

    const col = EMAIL_PREF_COL[opts.type];
    const emailEnabled = prefs ? (prefs as Record<string, boolean>)[col] !== false : true;
    if (!emailEnabled) return;

    const { data: authUser } = await admin.auth.admin.getUserById(opts.userId);
    const email = authUser?.user?.email;
    if (!email) return;

    const { subject, html } = renderEmail(opts.type, {
      title: opts.title,
      body: opts.body,
      url: opts.url,
      siteUrl,
    });

    await sendEmail(apiKey, { to: email, subject, html });
  } catch {
    // Email is best-effort
  }

  const vapidPublic = env?.PUBLIC_VAPID_KEY;
  const vapidPrivate = env?.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) return;

  try {
    const { data: prefs } = await admin
      .from('notification_preferences')
      .select('push_enabled')
      .eq('user_id', opts.userId)
      .maybeSingle();
    if (prefs && !prefs.push_enabled) return;

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', opts.userId);

    if (!subs?.length) return;

    const vapid = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: `mailto:noreply@littlesandme.no` };
    const payload = JSON.stringify({ title: opts.title, body: opts.body, url: opts.url });

    await Promise.all(
      subs.map(async (sub) => {
        const result = await sendPushNotification(sub, vapid, payload);
        if (result.status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }),
    );
  } catch {
    // Push is best-effort
  }
}

/** Notify all eligible moderators about a new item in the queue.
 *  Excludes the submitter (who can't review their own item anyway).
 *  Used when a listing/store/commission is enqueued for moderation. */
export async function notifyModeratorsNewItem(
  admin: SupabaseClient,
  opts: {
    itemType: 'listing' | 'commission_request' | 'store' | 'store_image';
    itemId: string;
    queueId: string;
    submitterId: string;
    title?: string;
  },
  env?: NotifyEnv,
): Promise<void> {
  const { data: mods } = await admin
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'moderator']);
  if (!mods?.length) return;

  const TYPE_LABEL: Record<string, string> = {
    listing: 'Annonse', commission_request: 'Oppdrag',
    store: 'Butikk', store_image: 'Butikkbilde',
  };
  const label = TYPE_LABEL[opts.itemType] ?? 'Element';

  const title = `Ny i moderatorkø: ${label}`;
  const body = opts.title ? `«${opts.title}» venter på vurdering.` : 'Et nytt element venter på vurdering.';
  const url = `/admin/moderation/${opts.queueId}`;

  for (const m of mods) {
    if (m.id === opts.submitterId) continue; // submitter can't review own item
    await createNotification(admin, {
      userId: m.id,
      type: 'moderation_new_item',
      title, body, url,
      referenceId: opts.itemId,
    }, env);
  }
}

/** Notify shadow-eligible moderators + admins about a pending shadow
 *  confirmation. Excludes the original decision-maker. */
export async function notifyShadowConfirmPending(
  admin: SupabaseClient,
  opts: {
    queueId: string;
    decisionById: string | null;
    itemType: string;
    itemId: string;
  },
  env?: NotifyEnv,
): Promise<void> {
  const { data: candidates } = await admin
    .from('profiles')
    .select('id, role')
    .in('role', ['admin', 'moderator']);
  if (!candidates?.length) return;

  // Pre-fetch stats for moderators so we can filter for eligibility
  const modIds = candidates.filter((c: any) => c.role === 'moderator').map((c: any) => c.id);
  let statsByUser: Map<string, { total_reviews: number; shadow_overrides: number }> = new Map();
  if (modIds.length > 0) {
    const { data: stats } = await admin
      .from('moderator_stats')
      .select('user_id, total_reviews, shadow_overrides')
      .in('user_id', modIds);
    for (const s of stats ?? []) {
      statsByUser.set(s.user_id, { total_reviews: s.total_reviews ?? 0, shadow_overrides: s.shadow_overrides ?? 0 });
    }
  }

  const { isShadowEligible } = await import('./admin-auth');

  const title = 'Skyggevurdering venter på bekreftelse';
  const body = 'En moderator har gjort en avgjørelse i skyggemodus — bekreft eller overstyr.';
  const url = `/admin/moderation/${opts.queueId}`;

  for (const c of candidates as Array<{ id: string; role: 'admin' | 'moderator' }>) {
    if (c.id === opts.decisionById) continue;
    const eligible = c.role === 'admin' || isShadowEligible('moderator', statsByUser.get(c.id));
    if (!eligible) continue;
    await createNotification(admin, {
      userId: c.id,
      type: 'moderation_shadow_pending',
      title, body, url,
      referenceId: opts.itemId,
    }, env);
  }
}
