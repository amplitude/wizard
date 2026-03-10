export default {
  paths: ['features/**/*.feature'],
  require: ['features/step-definitions/**/*.steps.ts'],
  requireModule: ['tsx/cjs'],
  tags: 'not @todo',
  format: ['progress-bar', 'html:reports/cucumber.html'],
};
