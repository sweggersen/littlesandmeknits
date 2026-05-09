-- Add new notification types. MUST run alone and commit before migrations that reference them.

alter type public.notification_type add value 'commission_delivered';
alter type public.notification_type add value 'request_expired';
