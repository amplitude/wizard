import { fixtureTracker } from './mocks/fixture-tracker';

export default function globalTeardown() {
  if (process.env.CLEANUP_UNUSED_FIXTURES !== 'false') {
    fixtureTracker.cleanupUnusedFixtures();

    const stats = fixtureTracker.getStats();

    console.log(
      `Fixture usage stats: ${stats.usedFixtures}/${stats.existingFixtures} fixtures used, ${stats.unusedFixtures} deleted`,
    );
  }
}
