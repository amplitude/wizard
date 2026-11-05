# Amplitude Wizard

Amplitude Wizard is deprecated. Instead, set up Amplitude with the following
instructions.

1. Install the Amplitude Developer CLI:

```bash
npm install -g @amplitude/developer-cli
```

2. Authenticate, passing in the region of your account (typically `us`).

```bash
amp auth login --region <us|eu>
```

3. Provide your coding agent of choice the following prompt.

````text
Set up Amplitude in the selected app: one real, app-produced first event. Work
in the app's repository with its existing toolchain folliwing these
instructions.

1. Check amp CLI context.

Run `amp context` to confirm the user has an authorized amp CLI instance. If the
command does not error, proceed directly from here to Step 2. Otherwise, inform
the user they must install the Developer CLI and authenticate with the following
commands before continuing.

```bash
npm install -g @amplitude/developer-cli
amp auth login --region <us|eu>
```

2. Resolve the region for set up

Run `amp auth list --json`. The region listed under the profile with
`is_default` true is the region you will use in Step 5. For example, based on
the following sample output the region would be `us`.

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

3. Resolve the Project ID for set up

Run `amp projects list`.

If the user has one project, that is the Project ID you will use in Step 5. Now
continute from here directly to Step 3.

If they have more than one project, share the set of projects with the user and
have them indicate which one they would like to implement. You will use that
Project ID in Step 5.

4. Retrieve Project API Key

Run `amp projects api-keys get --project-id <project-id>` using the Project ID
you resolved in Step 3 to retrieve the API key which you will need for
implementation. This is critical information you must remember later as part of
full completing this work.

5. Fetch and follow the set up skill

Run `amp skills get integrating-amplitude --region <us|eu>` using the region
value resolved in Step 2.

Follow the fetched skill exactly. Do not substitute docs, another SDK, or
another Amplitude product. Do not assume the app is JavaScript or that the event
is client-side.
````
