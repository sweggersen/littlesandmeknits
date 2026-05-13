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
  | 'role_changed'
  | 'review_received';

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
  role_changed: 'email_item_approved',
  review_received: 'email_review_received',
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
