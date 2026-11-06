# Amplitude Wizard

Amplitude Wizard is deprecated. Instead, set up Amplitude with the following
instructions.

1. Install the Amplitude Developer CLI.

```bash
npm install -g @amplitude/developer-cli
```

2. Authenticate, passing in the region for your account (typically `us`).

```bash
amp auth login --region <us|eu>
```

3. Provide your coding agent of choice the following prompt.

````text
Set up Amplitude in this repository so the app sends one real event, produced by
its own code, to Amplitude. Use the app's existing toolchain and follow these
instructions.

## Step 1: Check amp CLI context

Run `amp context` to confirm the user is logged in to the `amp` CLI. If the
command does not error, proceed to Step 2. Otherwise, inform the user they must
install the Developer CLI and authenticate with the following commands before
continuing.

```bash
npm install -g @amplitude/developer-cli
amp auth login --region <us|eu>
```

## Step 2: Resolve the region for setup

Run `amp auth list --json`. Use the `region` of the profile where `is_default`
is true. You will use this region in Step 5.

## Step 3: Resolve the Project ID for setup

Run `amp projects list`.

If the user has one project, use its Project ID in Step 4.

If they have more than one project, share the set of projects with the user and
have them indicate which one they want to use. You will use that Project ID in
Step 4.

## Step 4: Retrieve the project API key

Run `amp projects api-keys get --project-id <project-id>` using the Project ID
you resolved in Step 3 to retrieve the API key. Keep the project name, Project
ID, and API key for Step 5.

## Step 5: Fetch and follow the setup skill

Run `amp skills get integrating-amplitude --region <us|eu>` using the region
value resolved in Step 2.

Follow the fetched skill exactly. Use the region, project, and API key from
Steps 2–4 as already confirmed; do not ask the user for them again. Do not
substitute docs, another SDK, or another Amplitude product. Do not assume the
app is JavaScript or that the event is client-side.
````
