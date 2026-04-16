import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REACT_ROUTER_AGENT_CONFIG } from '../react-router-wizard-agent.js';

describe('react-router detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-detect-react-router-'),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects when "react-router" is in dependencies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { react: '18.0.0', 'react-router': '7.0.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_ROUTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects TanStack Router', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { '@tanstack/react-router': '1.0.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_ROUTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('detects TanStack Start', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { '@tanstack/react-start': '1.0.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_ROUTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(true);
  });

  it('returns false when none of the router packages are present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        dependencies: { react: '18.0.0' },
      }),
      'utf-8',
    );
    expect(
      await REACT_ROUTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });

  it('returns false when package.json is missing', async () => {
    expect(
      await REACT_ROUTER_AGENT_CONFIG.detection.detect({ installDir: tmpDir }),
    ).toBe(false);
  });
});
