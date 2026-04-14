import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTryGetPackageJson = vi.fn();
const mockGetPackageVersion = vi.fn();

vi.mock('../../../utils/setup-utils', () => ({
  tryGetPackageJson: mockTryGetPackageJson,
}));

vi.mock('../../../utils/package-json', () => ({
  getPackageVersion: mockGetPackageVersion,
  hasPackageInstalled: vi.fn(),
}));

vi.mock('../../../ui', () => ({
  getUI: () => ({
    setDetectedFramework: vi.fn(),
  }),
}));

const { REACT_ROUTER_AGENT_CONFIG } = await import('../react-router-wizard-agent');

const options = {
  installDir: '/tmp/does-not-matter',
  debug: false,
  forceInstall: false,
  default: false,
  signup: false,
  localMcp: false,
  ci: false,
  menu: false,
  benchmark: false,
};

describe('react-router version check info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryGetPackageJson.mockResolvedValue({ name: 'fixture' });
  });

  it('uses React Router minimum for react-router package', async () => {
    mockGetPackageVersion.mockImplementation((packageName: string) =>
      packageName === 'react-router' ? '6.30.0' : undefined,
    );

    const info = await REACT_ROUTER_AGENT_CONFIG.detection.getVersionCheckInfo?.(
      options,
    );

    expect(info).toEqual({
      version: '6.30.0',
      minimumVersion: '6.0.0',
      packageDisplayName: 'React Router',
    });
  });

  it('uses TanStack Start minimum for @tanstack/react-start package', async () => {
    mockGetPackageVersion.mockImplementation((packageName: string) =>
      packageName === '@tanstack/react-start' ? '1.168.10' : undefined,
    );

    const info = await REACT_ROUTER_AGENT_CONFIG.detection.getVersionCheckInfo?.(
      options,
    );

    expect(info).toEqual({
      version: '1.168.10',
      minimumVersion: '1.0.0',
      packageDisplayName: 'TanStack Start',
    });
  });

  it('uses TanStack Router minimum for @tanstack/react-router package', async () => {
    mockGetPackageVersion.mockImplementation((packageName: string) =>
      packageName === '@tanstack/react-router' ? '1.168.10' : undefined,
    );

    const info = await REACT_ROUTER_AGENT_CONFIG.detection.getVersionCheckInfo?.(
      options,
    );

    expect(info).toEqual({
      version: '1.168.10',
      minimumVersion: '1.0.0',
      packageDisplayName: 'TanStack Router',
    });
  });
});
