import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert';
import type { StoredUser } from '../../src/utils/ampli-settings';

// State shared across steps within a scenario
let storedUser: StoredUser | undefined;
let whoamiResult: StoredUser | undefined;

Before(function () {
  storedUser = undefined;
  whoamiResult = undefined;
});

Given('I have valid credentials stored in {string}', function (_path: string) {
  storedUser = {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    zone: 'us',
  };
});

Given('I have no credentials stored in {string}', function (_path: string) {
  storedUser = undefined;
});

When('I run {string}', function (command: string) {
  if (command === 'amplitude-wizard whoami') {
    whoamiResult = storedUser;
  }
});

Then('I should see my name, email, and zone', function () {
  assert.ok(whoamiResult, 'Expected a logged-in user but got none');
  assert.strictEqual(whoamiResult.email, 'ada@example.com');
  assert.strictEqual(whoamiResult.firstName, 'Ada');
  assert.strictEqual(whoamiResult.zone, 'us');
});

Then('I should see {string}', function (message: string) {
  if (message === 'Not logged in') {
    assert.strictEqual(whoamiResult, undefined);
  }
});
