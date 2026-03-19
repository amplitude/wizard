/* Java (JRE) wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { detectJavaPackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectJavaProject, detectJavaBuildTool } from './utils';
import type { JavaBuildTool } from './utils';

type JavaContext = {
  buildTool?: JavaBuildTool;
};

export const JAVA_AGENT_CONFIG: FrameworkConfig<JavaContext> = {
  metadata: {
    name: 'Java',
    integration: Integration.java,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/java/jre-java-sdk',
    gatherContext: (options) => {
      const buildTool = detectJavaBuildTool(options);
      return Promise.resolve({ buildTool });
    },
  },

  detection: {
    packageName: 'com.amplitude:java-sdk',
    packageDisplayName: 'Java',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectJavaProject,
    detectPackageManager: detectJavaPackageManagers,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey, host) => ({
      AMPLITUDE_API_KEY: apiKey,
      AMPLITUDE_SERVER_URL: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      buildTool: context.buildTool ?? 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Java JRE project. Look for pom.xml (Maven), build.gradle / build.gradle.kts (Gradle), or src/main/java to confirm.',
    getAdditionalContextLines: (context) => {
      const buildTool = context.buildTool ?? 'maven';
      const depSnippet =
        buildTool === 'maven'
          ? `<dependency><groupId>com.amplitude</groupId><artifactId>java-sdk</artifactId><version>1.13.0</version></dependency>`
          : `implementation 'com.amplitude:java-sdk:1.13.0'`;
      return [
        `Build tool: ${buildTool === 'maven' ? 'Maven' : 'Gradle'}`,
        `Framework docs ID: java (use amplitude://docs/frameworks/java for documentation)`,
        `SDK: com.amplitude:java-sdk — add to ${
          buildTool === 'maven' ? 'pom.xml' : 'build.gradle'
        }: ${depSnippet}`,
        `Also add org.json:json:20231013 as a runtime dependency`,
        `Initialization: Amplitude client = Amplitude.getInstance(); client.init(System.getenv("AMPLITUDE_API_KEY"));`,
        `Always call client.shutdown() on application exit to flush queued events`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const tool = context.buildTool === 'gradle' ? 'Gradle' : 'Maven';
      return [
        `Analyzed your Java project structure`,
        `Added com.amplitude:java-sdk to ${tool} build file`,
        `Configured Amplitude client initialization`,
      ];
    },
    getOutroNextSteps: () => [
      'Build and run your application to verify the integration',
      'Visit your Amplitude dashboard to see incoming events',
      'Use client.logEvent(new Event("Event Name", userId)) for custom events',
      'Ensure client.shutdown() is called on exit to flush queued events',
    ],
  },
};
