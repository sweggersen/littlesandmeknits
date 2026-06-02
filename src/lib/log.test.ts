import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from './log';

describe('log', () => {
  let logSpy: any;
  let warnSpy: any;
  let errSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  function parse(spy: any): any {
    expect(spy).toHaveBeenCalledTimes(1);
    return JSON.parse(spy.mock.calls[0][0]);
  }

  it('emits info as a single-line JSON to console.log', () => {
    log.info('checkout.session_created', { listingId: 'l1', userId: 'u1' });
    const out = parse(logSpy);
    expect(out).toMatchObject({
      lvl: 'info',
      ev: 'checkout.session_created',
      listingId: 'l1',
      userId: 'u1',
    });
    expect(out.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('routes warn to console.warn', () => {
    log.warn('quota.exceeded', { userId: 'u1' });
    const out = parse(warnSpy);
    expect(out.lvl).toBe('warn');
    expect(out.ev).toBe('quota.exceeded');
  });

  it('routes error to console.error and serializes Error instances', () => {
    const e = new Error('boom');
    log.error('webhook.db_failure', { eventId: 'evt_1', error: e });
    const out = parse(errSpy);
    expect(out.lvl).toBe('error');
    expect(out.error).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof out.error.stack).toBe('string');
  });

  it('handles non-Error error values gracefully', () => {
    log.error('webhook.parse_failure', { error: { code: 'EBADJSON', detail: 'x' } });
    const out = parse(errSpy);
    expect(out.error).toEqual({ code: 'EBADJSON', detail: 'x' });
  });

  it('handles missing fields', () => {
    log.info('startup.boot');
    const out = parse(logSpy);
    expect(out.ev).toBe('startup.boot');
  });
});
