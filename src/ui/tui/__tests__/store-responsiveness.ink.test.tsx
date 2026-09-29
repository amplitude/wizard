import React, { useEffect, useState } from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { expect, it, vi } from 'vitest';
import { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { setRerender, triggerRerender } from '../rerender-bridge.js';
import { waitForFrame } from './ink-stdin.js';

vi.mock('../../../utils/analytics.js');

it('keeps Ink input and a live timer working during streaming updates and forced redraws', async () => {
  const store = new WizardStore();
  let clockTicks = 0;
  let keys = 0;
  let redraws = 0;
  const Probe = () => {
    useWizardStore(store);
    const [ticks, setTicks] = useState(0);
    const [key, setKey] = useState('');
    useEffect(() => {
      const timer = setInterval(() => {
        clockTicks++;
        setTicks(clockTicks);
      }, 10);
      return () => clearInterval(timer);
    }, []);
    useInput((input) => {
      keys++;
      setKey(input);
    });
    return (
      <Text>{`ticks:${ticks} key:${key} status:${
        store.statusMessages.at(-1) ?? ''
      }`}</Text>
    );
  };
  const view = render(<Probe />);
  await waitForFrame();
  const unsub = store.subscribe(
    vi.fn().mockImplementationOnce(() => {
      throw new Error('transient subscriber failure');
    }),
  );
  setRerender(() => {
    redraws++;
    view.rerender(<Probe />);
    // Keep requesting frames so this also exercises a reentrant redraw.
    if (redraws < 100) triggerRerender();
  });
  const stream = setInterval(() => {
    for (let i = 0; i < 1000; i++) store.setCurrentActivity(null);
  }, 5);
  try {
    store.pushStatus('streaming');
    const before = clockTicks;
    view.stdin.write('x');
    await vi.waitFor(
      () => {
        expect(keys).toBe(1);
        expect(clockTicks).toBeGreaterThan(before);
        expect(view.lastFrame()).toContain('key:x');
        expect(view.lastFrame()).toContain('status:streaming');
      },
      { timeout: 500, interval: 10 },
    );
    expect(redraws).toBeLessThan(100);
    store.pushStatus('complete');
    await vi.waitFor(
      () => expect(view.lastFrame()).toContain('status:complete'),
      { timeout: 500 },
    );
  } finally {
    clearInterval(stream);
    unsub();
    setRerender(null);
    view.unmount();
    view.cleanup();
  }
});
