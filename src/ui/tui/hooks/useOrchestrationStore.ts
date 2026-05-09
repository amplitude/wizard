/**
 * useOrchestrationStore — React hook that subscribes to the durable
 * orchestration store via the file-watch wrapper from
 * `src/lib/orchestration/watcher.ts`.
 *
 * Part of v2 PR 4. The `/status` overlay (PR 3) read the store once at
 * mount; PR 4 makes it live-update so a sibling shell running
 * `wizard choice answer …` is reflected in the open overlay without a
 * manual close + re-open.
 *
 * Usage:
 *
 *   ```tsx
 *   const version = useOrchestrationStore(installDir);
 *   const data = useMemo(() => buildStatusEnvelope({ installDir }), [installDir, version]);
 *   ```
 *
 * The hook returns a monotonically increasing `version` number that
 * changes every time the watcher fires. Consumers feed `version` into
 * any `useMemo` whose computation reads the store, forcing a recompute.
 *
 * The watcher is debounced (200ms) inside `watchOrchestrationStore`, so
 * a flurry of rename/close/rewrite events from a single
 * `atomicWriteJSON` call coalesces into ONE re-render. Cleanup on
 * unmount is automatic.
 */
import { useEffect, useState } from 'react';
import { watchOrchestrationStore } from '../../../lib/orchestration/watcher.js';

export function useOrchestrationStore(installDir: string): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const watcher = watchOrchestrationStore({
      installDir,
      onChange: () => {
        setVersion((v) => v + 1);
      },
    });
    return () => {
      watcher.dispose();
    };
  }, [installDir]);

  return version;
}
