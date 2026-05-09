/**
 * ChoiceCheckpointBanner tests — verify every required UX field surfaces.
 *
 * The brief calls out the typed checkpoint UX contract: why-asking,
 * recommended, safe-default, reversibility, "skipping is/isn't safe",
 * consequenceIfSkipped. This test renders a representative `Choice`
 * record through the banner and asserts each piece is present.
 *
 * We also assert the banner copy correctly disambiguates "skipping is
 * safe" from "skipping isn't safe" based on the record's reversibility
 * + requiresHuman flags.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';

import { ChoiceCheckpointBanner } from '../../components/ChoiceCheckpointBanner.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import type { Choice } from '../../../../lib/orchestration/checkpoints/choices.js';
import { ChoiceKind, ChoiceStatus } from '../../../../lib/orchestration/checkpoints/choices.js';

function makeChoice(overrides: Partial<Choice> = {}): Choice {
  const base: Choice = {
    id: 'choice_test_1' as Choice['id'],
    kind: ChoiceKind.EnvironmentSelection,
    promptId: 'env-test',
    message: 'Pick the environment to instrument',
    options: [
      {
        id: 'env-prod',
        label: 'Acme / web / prod',
        description: 'live traffic',
      },
      { id: 'env-dev', label: 'Acme / web / dev' },
    ],
    recommendedOptionId: 'env-prod',
    safeDefaultOptionId: 'env-prod',
    requiresHuman: true,
    automationAllowed: false,
    timeoutBehavior: null,
    consequenceIfSkipped: 'No env, no events.',
    reversible: true,
    whyAsking: 'Multiple environments detected.',
    status: ChoiceStatus.Pending,
    answeredOptionId: null,
    answeredBy: null,
    createdAt: new Date('2026-05-09T00:00:00.000Z').toISOString(),
    answeredAt: null,
    expiresAt: null,
    resumeCommand: ['npx', '@amplitude/wizard'],
    linkedTaskId: null,
    linkedSessionId: 'session_test_1' as Choice['linkedSessionId'],
  };
  return { ...base, ...overrides };
}

describe('ChoiceCheckpointBanner', () => {
  it('surfaces all required UX fields', () => {
    const choice = makeChoice();
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ChoiceCheckpointBanner choice={choice} />,
      store,
    );
    expect(frame).toContain('Pick the environment to instrument'); // message
    expect(frame).toContain('Multiple environments detected'); // whyAsking
    expect(frame).toContain('Acme / web / prod'); // option label
    expect(frame).toContain('recommended'); // recommended tag
    expect(frame).toContain('safe-default'); // safe-default tag
    expect(frame).toContain('No env, no events.'); // consequenceIfSkipped
    expect(frame).toContain('reversible: yes'); // reversibility
  });

  it('flags "skipping isn\'t safe" when requiresHuman + reversible=false', () => {
    const choice = makeChoice({
      reversible: false,
      requiresHuman: true,
    });
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ChoiceCheckpointBanner choice={choice} />,
      store,
    );
    expect(frame).toContain('reversible: no');
    expect(frame).toContain("skipping isn't safe");
  });

  it('flags "skipping is safe" when reversible + automationAllowed', () => {
    const choice = makeChoice({
      requiresHuman: false,
      reversible: true,
      automationAllowed: true,
    });
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ChoiceCheckpointBanner choice={choice} />,
      store,
    );
    expect(frame).toContain('skipping is safe');
  });

  it('renders the answered state when showAnswered=true', () => {
    const choice = makeChoice({
      status: ChoiceStatus.Answered,
      answeredOptionId: 'env-prod',
      answeredBy: 'human',
      answeredAt: new Date().toISOString(),
    });
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ChoiceCheckpointBanner choice={choice} showAnswered />,
      store,
    );
    expect(frame).toContain('answered: env-prod');
  });

  it("notes when recommended differs from safe-default ('pick deliberately')", () => {
    const choice = makeChoice({
      recommendedOptionId: 'env-prod',
      safeDefaultOptionId: 'env-dev',
    });
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ChoiceCheckpointBanner choice={choice} />,
      store,
    );
    expect(frame).toContain('pick deliberately');
  });
});
