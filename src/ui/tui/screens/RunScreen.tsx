/**
 * RunScreen — Tabbed observational view of the agent run.
 *
 * Two tabs:
 *   - Status: SplitView with TipsCard (left) + ProgressList (right)
 *   - Logs: LogViewer tailing the wizard log file
 *
 * No prompts — the agent runs headlessly.
 * TipsCard reactively shows tips based on discovered features.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  KagiSmallWebViewer,
  SnakeGame,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { AnimatedAmplitudeLogo } from '../components/AmplitudeLogo.js';
import {
  DiscoveredFeature,
  AdditionalFeature,
  ADDITIONAL_FEATURE_LABELS,
} from '../../../lib/wizard-session.js';

const LOG_FILE = '/tmp/amplitude-wizard.log';

/** A discrete tip shown in the TipsCard during the agent run. */
interface Tip {
  /** Unique identifier */
  id: string;
  /** Title line */
  title: string;
  /** Description shown below the title */
  description: string;
  /** Optional URL shown after the description */
  url?: string;
  /** When provided, the tip is only shown if this returns true */
  visible?: (store: WizardStore) => boolean;
  /** Optional key binding that toggles an AdditionalFeature */
  toggle?: {
    /** The key the user presses (lowercase) */
    key: string;
    /** The additional feature to enqueue */
    feature: AdditionalFeature;
    /** Label shown when toggled on */
    enabledLabel: string;
    /** Prompt shown when not yet toggled */
    prompt: string;
    /** Returns true if already toggled */
    isEnabled: (store: WizardStore) => boolean;
  };
}

/** Tips that rotate on a timer — each inner array is one "page". */
const TIP_PAGES: Tip[][] = [
  [
    {
      id: 'events',
      title: 'Events are the bedrock of your Amplitude data',
      description:
        'As people use your product, events build a picture of their behavior and satisfaction. Good events make great data.',
    },
    {
      id: 'persons',
      title: 'You can also track people and groups with Amplitude',
      description:
        'Events can be associated with the humans who generate them, letting you understand a specific customer problem if they email about it.',
    },
    {
      id: 'properties',
      title: 'Get way more detail using properties',
      description:
        'Events and person records can have any properties you want. Track things like how they found your website, what subscription tier they choose, and much more.',
    },
  ],
  [
    {
      id: 'session-replay',
      title: 'Watch real user sessions with Session Replay',
      description:
        'See exactly what users see — clicks, scrolls, rage clicks, and dead ends. Debug issues faster and build empathy for your users without scheduling a single call.',
    },
    {
      id: 'experimentation',
      title: 'Run experiments with confidence',
      description:
        'Amplitude supports both feature experiments and web experiments. Test hypotheses, roll out changes safely, and let data decide what ships.',
    },
    {
      id: 'feature-flags',
      title: 'Ship fearlessly with feature flags',
      description:
        'Control who sees what, when. Roll out features gradually, kill switches instantly, and decouple deployment from release.',
    },
  ],
  [
    {
      id: 'guides-surveys',
      title: 'Reach users in-product with Guides & Surveys',
      description:
        'Onboard new users, announce features, and collect feedback — all without a code deploy. Target the right audience using your Amplitude data.',
    },
    {
      id: 'activation',
      title: 'Unify your data with Amplitude Activation',
      description:
        'Collect, clean, and route data to every tool in your stack. One SDK, one source of truth, zero data silos.',
    },
    {
      id: 'ai',
      title: 'Ask questions in plain English',
      description:
        'Amplitude AI lets anyone on your team ask data questions in natural language and get instant charts and insights — no SQL required.',
    },
  ],
  [
    {
      id: 'mcp',
      title: 'Give your AI agents analytics superpowers with Amplitude MCP',
      description:
        'Connect any AI agent to your Amplitude data via MCP. Your agents can query metrics, build charts, and act on insights — no dashboard required.',
    },
    {
      id: 'skills-marketplace',
      title: 'Extend your agents with the Skills Marketplace',
      description:
        'Browse and install pre-built skills that teach your agents new tricks — from anomaly detection to automated reporting. Build once, share across your org.',
    },
    {
      id: 'global-agent',
      title: 'Meet your always-on analytics agent',
      description:
        'Ask questions in Amplitude or in Slack and get instant answers backed by your data. One agent that works wherever your team already lives.',
    },
  ],
];

/** How often (ms) to rotate to the next tip page. */
const TIP_ROTATION_INTERVAL = 30_000;

/** Conditional tips shown regardless of the current page. */
const CONDITIONAL_TIPS: Tip[] = [
  {
    id: 'stripe',
    title: 'You can track Stripe revenue with Amplitude',
    description: 'Add Stripe as a data source while you wait:',
    url: 'https://app.amplitude.com/project/data-warehouse/new-source?kind=Stripe',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.Stripe),
  },
  {
    id: 'llm',
    title: 'Amplitude can also help you track your LLM costs',
    description: '',
    visible: (store) =>
      store.session.discoveredFeatures.includes(DiscoveredFeature.LLM),
    toggle: {
      key: 'l',
      feature: AdditionalFeature.LLM,
      enabledLabel: 'LLM analytics setup queued next',
      prompt: 'We detected LLM dependencies in your project.',
      isEnabled: (store) => store.session.llmOptIn,
    },
  },
];

interface RunScreenProps {
  store: WizardStore;
}

/** Min terminal width to show the logo in the TipsCard. */
const LOGO_MIN_COLS = 100;

/** Delay (ms) between each tip appearing during a page transition. */
const TIP_REVEAL_DELAY = 400;

const TipsCard = ({ store }: { store: WizardStore }) => {
  const [columns] = useStdoutDimensions();
  const [pageIndex, setPageIndex] = useState(0);
  /** Number of page tips currently visible (for staggered reveal). */
  const [visibleCount, setVisibleCount] = useState(TIP_PAGES[0].length);

  useEffect(() => {
    const timer = setInterval(() => {
      setPageIndex((prev) => (prev + 1) % TIP_PAGES.length);
      setVisibleCount(0);
    }, TIP_ROTATION_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Stagger reveal: increment visibleCount one at a time after each page change
  useEffect(() => {
    const pageLen = TIP_PAGES[pageIndex].length;
    if (visibleCount >= pageLen) return;
    const timer = setTimeout(
      () => setVisibleCount((c) => c + 1),
      visibleCount === 0 ? 100 : TIP_REVEAL_DELAY,
    );
    return () => clearTimeout(timer);
  }, [pageIndex, visibleCount]);

  useScreenInput((input) => {
    for (const tip of CONDITIONAL_TIPS) {
      if (
        tip.toggle &&
        input.toLowerCase() === tip.toggle.key &&
        (!tip.visible || tip.visible(store)) &&
        !tip.toggle.isEnabled(store)
      ) {
        store.enableFeature(tip.toggle.feature);
      }
    }
  });

  const pageTips = TIP_PAGES[pageIndex].slice(0, visibleCount);
  const visibleConditional = CONDITIONAL_TIPS.filter(
    (tip) => !tip.visible || tip.visible(store),
  );
  const allTips = [...pageTips, ...visibleConditional];

  return (
    <Box flexDirection="column" paddingX={1}>
      {columns >= LOGO_MIN_COLS && <AnimatedAmplitudeLogo />}
      <Text bold color={Colors.accent}>
        Learn about Amplitude
      </Text>
      <Text color={Colors.muted}>
        {Icons.diamond} {pageIndex + 1}/{TIP_PAGES.length}
      </Text>
      <Box height={1} />

      {allTips.map((tip) => (
        <Box key={tip.id} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={Colors.accent}>{Icons.diamond} </Text>
            <Text bold>{tip.title}</Text>
          </Text>

          {tip.toggle ? (
            tip.toggle.isEnabled(store) ? (
              <Text color={Colors.success}>
                {Icons.check} {tip.toggle.enabledLabel}
              </Text>
            ) : (
              <Text color={Colors.muted}>
                {tip.toggle.prompt} Press{' '}
                <Text bold color={Colors.accent}>
                  {tip.toggle.key.toUpperCase()}
                </Text>{' '}
                to enable.
              </Text>
            )
          ) : (
            <Text color={Colors.muted}>
              {tip.description}
              {tip.url && (
                <>
                  {' '}
                  <Text color="cyan">{tip.url}</Text>
                </>
              )}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  // When all tasks are done but the queue has features, show a transitional item
  const queue = store.session.additionalFeatureQueue;
  const allDone =
    progressItems.length > 0 &&
    progressItems.every((t) => t.status === 'completed');
  if (allDone && queue.length > 0) {
    const nextLabel = ADDITIONAL_FEATURE_LABELS[queue[0]];
    progressItems.push({
      label: `Set up ${nextLabel}`,
      activeForm: `Setting up ${nextLabel}...`,
      status: 'in_progress',
    });
  }

  const lastStatus =
    store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : undefined;

  const tabs = [
    {
      id: 'status',
      label: 'Status',
      component: (
        <SplitView
          left={<TipsCard store={store} />}
          right={<ProgressList items={progressItems} title="Tasks" />}
        />
      ),
    },
    ...(store.eventPlan.length > 0
      ? [
          {
            id: 'events',
            label: 'Event plan',
            component: <EventPlanViewer events={store.eventPlan} />,
          },
        ]
      : []),
    {
      id: 'logs',
      label: 'All logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
    {
      id: 'smallweb',
      label: 'Small Web',
      component: <KagiSmallWebViewer />,
    },
    {
      id: 'snake',
      label: 'Snake',
      component: <SnakeGame />,
    },
  ];

  return (
    <TabContainer
      tabs={tabs}
      statusMessage={lastStatus}
      requestedTab={store.requestedTab}
      onTabConsumed={() => store.clearRequestedTab()}
    />
  );
};
