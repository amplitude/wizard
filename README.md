# Amplitude Wizard

This Amplitude Wizard package is deprecated in favor of a set up process driven
by the
[Amplitude Developer CLI](https://www.npmjs.com/package/@amplitude/developer-cli).
Follow these instructions to set up with your coding agent of choice.

1. Install the CLI

```bash
npm install -g @amplitude/developer-cli
```

2. Authenticate, passing in the region of your account (typically `us`).

```bash
amp auth login --region <us|eu>
```

3. Provide your agent the following prompt:

````
Work in the app's repository with its existing toolchain.

1. Check amp cli context.
Run `amp context` to confirm the user has an authorized amp cli instance. If you receive an error, inform the user they must install the Developer CLI and authenticate with the following commands before continuing.

```bash
npm install -g @amplitude/developer-cli
amp auth login --region <us|eu>
````

2. Resolve the region for set up You will need the account region (us or eu) for
   set up. Run `amp auth list --json`. The region listed under the profile with
   `is_default` true is the region value for set up. For example, based on the
   following sample output the region would be `us`.

```json
{
  "profiles": [
    {
      "name": "default",
      "type": "oauth",
      "base_url": "https://developer-api.amplitude.com",
      "region": "us",
      "expires_at": "2026-11-05T19:16:55.834Z",
      "is_default": true
    },
    {
      "name": "eu",
      "type": "oauth",
      "base_url": "https://developer-api.eu.amplitude.com",
      "region": "eu",
      "expires_at": "2026-11-05T20:58:00.812Z",
      "is_default": false
    }
  ],
  "default": "default"
}
```

3. Resolve the Project Id for set up Run `amp projects list`.

If the user has one project, use that project's id for set up and continue from
here directly to Step 3.

If they have more than one project, share the set of projects with the user and
have them indicate which one they would like to implement. That project's id
should be used for step 3.

4. Retrieve api-key Run `amp projects api-keys get --project-id <project-id>`
   using the project id from step 3 to retrieve the API key which you will need
   for implementation.

5. Fetch the setup skill

Run `amp skills get integrating-amplitude --region <us|eu>`

3. Follow the fetched skill exactly. Do not substitute docs, another SDK, or
   another Amplitude product. Do not assume the app is JavaScript or that the
   event is client-side.
