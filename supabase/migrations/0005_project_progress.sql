-- Project progress tracking: rows knit out of target.
-- target_rows is the goal (e.g. 220 rows for the body), current_rows is
-- where the project sits today. Both are nullable so the feature is
-- opt-in and old projects keep working.

alter table public.projects
  add column if not exists target_rows int,
  add column if not exists current_rows int;

-- Each log can optionally record the row count the project advanced to,
-- so the timeline doubles as a progress chart later.
alter table public.project_logs
  add column if not exists rows_at int;
