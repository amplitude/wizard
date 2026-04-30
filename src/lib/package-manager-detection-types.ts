/**
 * Shared types for package manager detection.
 *
 * Lives in its own file so the lightweight detection helpers
 * (`package-manager-detection-light.ts`) and the full detection module
 * (`package-manager-detection.ts`) can both reference these types without
 * either importing the other.
 */

/** Structured package manager info the agent can act on */
export interface DetectedPackageManager {
  name: string;
  label: string;
  installCommand: string;
  runCommand?: string;
}

/** Result returned by every detector */
export interface PackageManagerInfo {
  detected: DetectedPackageManager[];
  primary: DetectedPackageManager | null;
  recommendation: string;
}

/** Signature each framework implements */
export type PackageManagerDetector = (
  installDir: string,
) => Promise<PackageManagerInfo>;
