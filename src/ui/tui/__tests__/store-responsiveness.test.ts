import { describe, expect, it, vi } from 'vitest';
import { WizardStore } from '../store.js';
import { atom } from 'nanostores';

vi.mock('../../../utils/analytics.js');

describe('store notification resilience', () => {
  it('does not notify or advance the snapshot when streaming repeatedly clears an already idle activity', () => {
    const store = new WizardStore();
    const changed = vi.fn();
    store.subscribe(changed);
    const initial = store.getSnapshot();
    for (let i = 0; i < 10000; i++) store.setCurrentActivity(null);
    expect(changed).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(initial);
    store.setCurrentActivity({
      kind: 'cold-start',
      message: 'Loading',
      startedAt: 1,
    });
    store.setCurrentActivity(null);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('keeps other listeners and unrelated atoms working after a subscriber throws', () => {
    const store = new WizardStore();
    const broken = vi.fn().mockImplementationOnce(() => {
      throw new Error('render subscriber failed');
    });
    const healthy = vi.fn();
    const unsubBroken = store.subscribe(broken);
    const unsubHealthy = store.subscribe(healthy);
    const unrelated = atom(0);
    const otherListener = vi.fn();
    const unsubOther = unrelated.listen(otherListener);
    try {
      expect(() => store.emitChange()).not.toThrow();
      expect(healthy).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 1000; i++) store.emitChange();
      unrelated.set(1);
      expect(healthy).toHaveBeenCalledTimes(1001);
      expect(broken).toHaveBeenCalledTimes(1001);
      expect(otherListener).toHaveBeenCalledTimes(1);
    } finally {
      unsubBroken();
      unsubHealthy();
      unsubOther();
    }
  });
});
