// Cron liveness evaluation (pure — unit-tested). The cron writes a heartbeat
// each run (cron_heartbeats); this derives whether that heartbeat is stale so
// the admin dashboard can flag a halted cron.

// The cron is expected to run at least hourly (escrow auto-release / ship-by
// sweeps key off it). Allow generous slack so a single missed tick or a slow
// run doesn't false-alarm, but still catch a real halt within a few hours —
// far faster than the day+ it took cron-job.org to disable the job last time.
export const CRON_STALE_AFTER_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface CronHealth {
  /** The recorded last-run timestamp, or null if the cron has never run. */
  lastRunAt: string | null;
  /** Milliseconds since the last run (null when never run). */
  ageMs: number | null;
  /** True when the cron hasn't checked in within CRON_STALE_AFTER_MS (or never). */
  stale: boolean;
  /** Whether the last recorded run completed without section errors. */
  ok: boolean;
}

/** Derive cron health from the heartbeat row. `nowMs` is injected so callers
 *  (and tests) control "now". A missing/never-run heartbeat is treated as
 *  stale — a brand-new deploy with a working cron clears it within the hour. */
export function evaluateCronHealth(
  heartbeat: { last_run_at: string | null; ok?: boolean | null } | null,
  nowMs: number,
  staleAfterMs: number = CRON_STALE_AFTER_MS,
): CronHealth {
  const lastRunAt = heartbeat?.last_run_at ?? null;
  if (!lastRunAt) {
    return { lastRunAt: null, ageMs: null, stale: true, ok: false };
  }
  const ageMs = nowMs - new Date(lastRunAt).getTime();
  return {
    lastRunAt,
    ageMs,
    stale: ageMs > staleAfterMs,
    ok: heartbeat?.ok !== false,
  };
}
