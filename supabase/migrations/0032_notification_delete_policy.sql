create policy "Users delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);
