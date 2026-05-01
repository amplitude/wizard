import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveDataIngestionMaxWaitMs,
  nextDataIngestionPollWaitMs,
  DATA_INGESTION_POLL_BACKOFF_CAP_MS,
  DATA_INGESTION_POLL_BACKOFF_START_MS,
} from '../data-ingestion-agent-poll.js';
import type { WizardSession } from '../wizard-session.js';

function baseSession(overrides: Partial<WizardSession> = {}): WizardSession {
  return {
    ci: false,
    agent: true,
    ...overrides,
  } as WizardSession;
}

describe('data-ingestion-agent-poll', () => {
  const prevEnv = process.env.DATA_INGESTION_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.DATA_INGESTION_TIMEOUT_MS;
  });

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.DATA_INGESTION_TIMEOUT_MS;
    } else {
      process.env.DATA_INGESTION_TIMEOUT_MS = prevEnv;
    }
  });

  describe('resolveDataIngestionMaxWaitMs', () => {
    it('honors DATA_INGESTION_TIMEOUT_MS when set to a positive number', () => {
      process.env.DATA_INGESTION_TIMEOUT_MS = '12345';
      expect(resolveDataIngestionMaxWaitMs(baseSession())).toBe(12345);
    });

    it('uses CI ceiling when env unset and session.ci', () => {
      expect(resolveDataIngestionMaxWaitMs(baseSession({ ci: true }))).toBe(
        10 * 60 * 1000,
      );
    });

    it('uses interactive agent ceiling when env unset and not CI', () => {
      expect(resolveDataIngestionMaxWaitMs(baseSession({ ci: false }))).toBe(
        20 * 60 * 1000,
      );
    });

    it('ignores non-positive env values', () => {
      process.env.DATA_INGESTION_TIMEOUT_MS = '0';
      expect(resolveDataIngestionMaxWaitMs(baseSession({ ci: true }))).toBe(
        10 * 60 * 1000,
      );
    });
  });

  describe('nextDataIngestionPollWaitMs', () => {
    it('steps up from the starting delay until the cap', () => {
      let d = DATA_INGESTION_POLL_BACKOFF_START_MS;
      d = nextDataIngestionPollWaitMs(d);
      expect(d).toBe(10_000);
      d = nextDataIngestionPollWaitMs(d);
      expect(d).toBe(15_000);
      d = nextDataIngestionPollWaitMs(d);
      expect(d).toBe(20_000);
      d = nextDataIngestionPollWaitMs(d);
      expect(d).toBe(25_000);
      d = nextDataIngestionPollWaitMs(d);
      expect(d).toBe(DATA_INGESTION_POLL_BACKOFF_CAP_MS);
      d = nextDataIngestionPollWaitMs(d);
      expect(d).toBe(DATA_INGESTION_POLL_BACKOFF_CAP_MS);
    });
  });
});
