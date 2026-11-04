# Amplitude Wizard

Amplitude Wizard is deprecated. To set up Amplitude with your coding agent, use
the
[Amplitude Developer CLI](https://www.npmjs.com/package/@amplitude/developer-cli).

1. Install the Developer CLI:

```bash
npm install -g @amplitude/developer-cli
```

2. Authenticate in your account's region (typically `us`):

```bash
amp auth login --region <us|eu>
```

3. Copy this prompt into your coding agent:

````text
Work in the app's repository with its existing toolchain.

1. Check the Developer CLI context. Run `amp context` to confirm the user is
   authenticated. If it fails, ask the user to install the CLI and authenticate
   before continuing:

```bash
npm install -g @amplitude/developer-cli
amp auth login --region <us|eu>
```

2. Find the account region. Run `amp auth list --json` and use the `region` of
   the profile whose `is_default` value is `true`. In this example, use `us`:

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

3. Find the project ID. Run `amp projects list`. If there is one project, use
   its ID. If there are multiple projects, show the user the list and ask which
   project to set up.

4. Get the API key. Run `amp projects api-keys get --project-id <project-id>`
   with the selected project ID. Use the key for the integration; do not put it
   in your response.

5. Fetch the setup skill for the account region:

```bash
amp skills get integrating-amplitude --region <us|eu>
```

6. Follow the fetched skill exactly. Do not substitute docs, another SDK, or
   another Amplitude product. Do not assume the app uses JavaScript or that
   events are client-side.
````
