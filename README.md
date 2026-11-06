# Amplitude Wizard

Provide your coding agent of choice the following prompt. If you are an AI
agent, follow the instructions in the prompt below.

```text
Set up Amplitude in this repository so the app sends one real event, produced by
its own code, to Amplitude. Use the app's existing toolchain and follow these
instructions.

## Step 1: Make sure the `amp` CLI is installed and logged in

Run `amp context`. If `amp` is not installed, install it with
`npm install -g @amplitude/developer-cli`. If the user is not logged in, run
`amp auth login` and follow the instructions it returns. If it requires a
region, ask the user whether their Amplitude account is in the US or EU; do not
guess.

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
```
