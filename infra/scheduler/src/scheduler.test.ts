import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scheduler, loadConfig } from './scheduler.js';

describe('loadConfig', () => {
  it('returns defaults when no env overrides', () => {
    const config = loadConfig('/repo');
    expect(config.cron).toBe('0 * * * *');
    expect(config.maxConcurrent).toBe(1);
    expect(config.fleetSize).toBe(0);
    expect(config.apiPort).toBe(8420);
    expect(config.repoDir).toBe('/repo');
  });

  it('respects env overrides', () => {
    const env = {
      CRON_SCHEDULE: '*/30 * * * *',
      MAX_CONCURRENT: '4',
      FLEET_SIZE: '3',
      API_PORT: '9000',
    };
    const config = loadConfig('/repo', env);
    expect(config.cron).toBe('*/30 * * * *');
    expect(config.maxConcurrent).toBe(4);
    expect(config.fleetSize).toBe(3);
    expect(config.apiPort).toBe(9000);
  });
});

describe('Scheduler', () => {
  it('tracks running sessions', () => {
    const scheduler = new Scheduler(loadConfig('/repo'));
    expect(scheduler.activeSessions).toBe(0);
    expect(scheduler.canStartSession()).toBe(true);
  });

  it('respects max concurrent limit', () => {
    const config = loadConfig('/repo');
    config.maxConcurrent = 1;
    const scheduler = new Scheduler(config);
    scheduler.registerSession('s1');
    expect(scheduler.canStartSession()).toBe(false);
    scheduler.unregisterSession('s1');
    expect(scheduler.canStartSession()).toBe(true);
  });

  it('generates unique session IDs', () => {
    const scheduler = new Scheduler(loadConfig('/repo'));
    const id1 = scheduler.nextSessionId();
    const id2 = scheduler.nextSessionId();
    expect(id1).not.toBe(id2);
  });
});
