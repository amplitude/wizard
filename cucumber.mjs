export default {
  paths: ['features/**/*.feature'],
  // setup.ts must load FIRST so it can redirect HOME before any
  // src/ module reads os.homedir() at import time (notably
  // src/utils/ampli-settings.ts, which computes AMPLI_CONFIG_PATH at
  // module load).
  require: ['features/setup.ts', 'features/step-definitions/**/*.steps.ts'],
  requireModule: ['tsx/cjs'],
  tags: 'not @todo',
  format: ['progress-bar', 'html:reports/cucumber.html'],
};
