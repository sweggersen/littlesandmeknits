import { describe, it, expect } from 'vitest';
import { evaluateCronHealth, CRON_STALE_AFTER_MS } from './cron-health';

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('evaluateCronHealth', () => {
  it('a recent successful run is fresh', () => {
    const h = evaluateCronHealth({ last_run_at: ago(10 * 60_000), ok: true }, NOW);
    expect(h.stale).toBe(false);
    expect(h.ok).toBe(true);
    expect(h.ageMs).toBe(10 * 60_000);
  });

  it('flags stale once past the threshold (the halted-cron case)', () => {
    const justOver = evaluateCronHealth({ last_run_at: ago(CRON_STALE_AFTER_MS + 1), ok: true }, NOW);
    expect(justOver.stale).toBe(true);
    const justUnder = evaluateCronHealth({ last_run_at: ago(CRON_STALE_AFTER_MS - 1), ok: true }, NOW);
    expect(justUnder.stale).toBe(false);
  });

  it('a never-run cron (no heartbeat) is stale, not fresh', () => {
    expect(evaluateCronHealth(null, NOW).stale).toBe(true);
    expect(evaluateCronHealth({ last_run_at: null }, NOW).stale).toBe(true);
    expect(evaluateCronHealth(null, NOW).lastRunAt).toBeNull();
  });

  it('surfaces a degraded last run (ok=false) even when fresh', () => {
    const h = evaluateCronHealth({ last_run_at: ago(60_000), ok: false }, NOW);
    expect(h.stale).toBe(false);
    expect(h.ok).toBe(false);
  });

  it('respects a custom staleness window', () => {
    expect(evaluateCronHealth({ last_run_at: ago(90_000), ok: true }, NOW, 60_000).stale).toBe(true);
  });
});
