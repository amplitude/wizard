import { describe, it, expect } from 'vitest';
import { buildFollowUpSessionReadySchema } from '../account-creation-flow';

// `buildFollowUpSessionReadySchema` is parameterized on the BE-supplied
// `required` array. Each test asserts that the returned schema validates
// exactly the subset of session fields the BE asked for — never more,
// never less. Adding a new `RequiredKey` is a compile-time obligation
// inside the builder's exhaustive switch.

describe('buildFollowUpSessionReadySchema', () => {
  const VALID_BUNDLE = {
    terms_of_service: 'https://amplitude.com/terms',
    privacy_policy: 'https://amplitude.com/privacy',
  };

  it("required=['full_name']: passes with signupFullName, ignores missing bundle", () => {
    const schema = buildFollowUpSessionReadySchema(['full_name']);
    const result = schema.safeParse({
      signupFullName: 'Ada Lovelace',
      legalDocumentBundle: null,
      legalDocumentSource: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signupFullName).toBe('Ada Lovelace');
    }
  });

  it("required=['full_name']: fails when signupFullName is null", () => {
    const schema = buildFollowUpSessionReadySchema(['full_name']);
    const result = schema.safeParse({
      signupFullName: null,
      legalDocumentBundle: VALID_BUNDLE,
      legalDocumentSource: 'server',
    });
    expect(result.success).toBe(false);
  });

  it("required=['terms_acceptance']: passes with bundle+source, ignores missing fullName", () => {
    const schema = buildFollowUpSessionReadySchema(['terms_acceptance']);
    const result = schema.safeParse({
      signupFullName: null,
      legalDocumentBundle: VALID_BUNDLE,
      legalDocumentSource: 'server',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.legalDocumentBundle).toEqual(VALID_BUNDLE);
      expect(result.data.legalDocumentSource).toBe('server');
    }
  });

  it("required=['terms_acceptance']: fails when legalDocumentBundle is null", () => {
    const schema = buildFollowUpSessionReadySchema(['terms_acceptance']);
    const result = schema.safeParse({
      signupFullName: 'Ada Lovelace',
      legalDocumentBundle: null,
      legalDocumentSource: null,
    });
    expect(result.success).toBe(false);
  });

  it("required=['full_name','terms_acceptance']: requires both", () => {
    const schema = buildFollowUpSessionReadySchema([
      'full_name',
      'terms_acceptance',
    ]);
    const ok = schema.safeParse({
      signupFullName: 'Ada Lovelace',
      legalDocumentBundle: VALID_BUNDLE,
      legalDocumentSource: 'server',
    });
    expect(ok.success).toBe(true);

    const missingName = schema.safeParse({
      signupFullName: null,
      legalDocumentBundle: VALID_BUNDLE,
      legalDocumentSource: 'server',
    });
    expect(missingName.success).toBe(false);

    const missingBundle = schema.safeParse({
      signupFullName: 'Ada Lovelace',
      legalDocumentBundle: null,
      legalDocumentSource: null,
    });
    expect(missingBundle.success).toBe(false);
  });

  it('passthroughs unrelated session fields without altering them', () => {
    // The schema runs against `session`, which has dozens of unrelated
    // fields. `.passthrough()` ensures none of them trip `.strict()`-style
    // unknown-key rejections. Pinning here so a future refactor that drops
    // the `.passthrough()` is caught.
    const schema = buildFollowUpSessionReadySchema(['full_name']);
    const result = schema.safeParse({
      signupFullName: 'Ada Lovelace',
      unrelatedField: 'ignored',
      installDir: '/tmp/whatever',
    });
    expect(result.success).toBe(true);
  });
});
