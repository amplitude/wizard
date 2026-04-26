import type { CommandModule } from 'yargs';
import { getUI, setUI, LoggingUI } from './helpers';
import { CLI_INVOCATION } from './context';

export const feedbackCommand: CommandModule = {
  command: 'feedback [words..]',
  describe: 'Send product feedback to the Amplitude team',
  builder: (yargs) =>
    yargs
      .positional('words', {
        describe: 'Feedback message (positional, space-separated)',
        type: 'string',
        array: true,
      })
      .options({
        message: {
          alias: 'm',
          describe: 'Feedback message',
          type: 'string',
        },
      }),
  handler: (argv) => {
    void (async () => {
      setUI(new LoggingUI());
      const fromFlag =
        typeof argv.message === 'string' ? argv.message.trim() : '';
      const positional = Array.isArray(argv.words)
        ? argv.words.join(' ').trim()
        : '';
      const message = (fromFlag || positional).trim();
      if (!message) {
        getUI().log.error(
          `Usage: ${CLI_INVOCATION} feedback <message>  or  feedback --message <message>`,
        );
        process.exit(1);
        return;
      }
      try {
        const { trackWizardFeedback } = await import(
          '../utils/track-wizard-feedback.js'
        );
        await trackWizardFeedback(message);
        getUI().log.success('Thanks — your feedback was sent.');
        process.exit(0);
      } catch (e) {
        getUI().log.error(
          `Feedback failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        process.exit(1);
      }
    })();
  },
};
