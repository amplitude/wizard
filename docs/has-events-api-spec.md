# Wizard Event Ingestion Check API — Spec

## Background

The Amplitude Wizard is a CLI tool (`npx @amplitude/wizard`) that authenticates users via
Amplitude OAuth and then checks whether their project has started receiving events. After the
agent installs the SDK and instruments the user's code, the wizard polls to detect event
ingestion and auto-advance to the next step.

## The problem

There is no Amplitude API endpoint that:

1. Accepts an **OAuth Bearer token** (id_token or access_token from Amplitude's OAuth server)
2. Returns whether a given project has received any events recently

All existing event ingestion APIs require browser session cookies:

- `app.amplitude.com/graphql/org/:orgId` (Thunder) — session cookie auth only
- `app.amplitude.com/d/data/:appId/realtime/timeline` — session cookie auth only

The data-api GraphQL endpoint (`data-api.amplitude.com/graphql`) accepts Bearer tokens but does
not expose any event ingestion query — only taxonomy/schema data. The query
`hasAnyDefaultEventTrackingSourceAndEvents` only exists on Thunder, not on data-api.

## What the wizard has available at check time

From the wizard's session after a successful OAuth + org/project selection:

```
Authorization header value: credentials.idToken  (JWT id_token from OAuth)
selectedOrgId:              "421426"              (numeric string)
selectedWorkspaceId:        "e451e91a-3e7d-47b7-a100-a3100f6abb50"  (UUID)
zone:                       "us" | "eu"
```

The wizard does **not** have the numeric analytics app ID (e.g. `804053`) — it only has the
Data workspace UUID. It also does not have HTTP API key/secret pairs.

## What the endpoint should do

Return whether a given Amplitude project (identified by org + workspace) has received **any**
ingested events recently. "Recently" can be a rolling 24h or 7d window — the wizard just needs
a boolean signal. Custom `track()` events and autocapture events both count.

## Proposed endpoint spec

```
GET /wizard/v1/has-events
Host: data-api.amplitude.com  (or data-api.eu.amplitude.com for EU zone)

Headers:
  Authorization: <id_token>        # OAuth JWT from Amplitude's OAuth server
  x-org: <orgId>                   # numeric org ID string, e.g. "421426"
  Content-Type: application/json

Query params:
  workspaceId=<UUID>               # Data workspace UUID
  zone=us|eu                       # optional, defaults to us

Response 200:
{
  "hasEvents": true | false,
  "eventCount": 42,                # optional, useful for debugging
  "windowHours": 24                # what window was checked
}

Response 401: OAuth token invalid or expired
Response 403: Token does not have access to this org/workspace
Response 404: Workspace not found
```

## How the wizard will call it

```typescript
// src/lib/api.ts
export async function fetchHasAnyEvents(
  idToken: string,
  zone: AmplitudeZone,
  orgId: string,
  workspaceId: string,
): Promise<boolean> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  const baseUrl = dataApiUrl.replace('/graphql', ''); // strip GraphQL path
  const response = await axios.get(`${baseUrl}/wizard/v1/has-events`, {
    params: { workspaceId },
    headers: {
      Authorization: idToken,
      'x-org': orgId,
      'Content-Type': 'application/json',
      'User-Agent': WIZARD_USER_AGENT,
    },
  });
  return response.data.hasEvents === true;
}
```

This gets called from `DataIngestionCheckScreen` on a 30-second poll. When it returns `true`,
the wizard auto-advances without requiring user input.

## Auth implementation note

The `Authorization` header value is the **id_token** JWT (not access_token). This is the same
token used by the Amplitude Data CLI (`ampli`) for all its data-api calls. The existing
`data-api.amplitude.com/graphql` endpoint already validates this token, so the same auth
middleware can be reused.

## Alternative: MCP tool approach

The Amplitude MCP server (`mcp.amplitude.com/mcp`) already uses HTTP + Bearer token auth and
is called by the wizard agent during SDK installation. It has a `query_dataset` tool that can
query `[Amplitude] Any Active Event` and return non-zero counts when events are flowing — this
was proven in testing.

The blocker is that `query_dataset` requires a `projectId` (numeric analytics project ID, e.g.
`769610`) that the wizard does not have at the `DataIngestionCheckScreen` stage. The wizard
only has the Data workspace UUID (`e451e91a-...`). The agent knew the project ID because it was
seeded with the project API key, which the MCP server resolves server-side.

A dedicated MCP tool would be the cleanest implementation:

```
Tool name: check_event_ingestion
Input:  { workspaceId: string }   ← Data workspace UUID the wizard already has
Output: { hasEvents: boolean }

Implementation (server-side):
  1. Resolve workspaceId → numeric analytics projectId
  2. Query [Amplitude] Any Active Event for the last 7 days
  3. Return hasEvents: true if any count > 0
```

The wizard would call it via a direct HTTP POST to the MCP server (no agent SDK needed):

```typescript
// src/lib/api.ts
export async function fetchHasAnyEventsMcp(
  accessToken: string,
  mcpUrl: string,
  workspaceId: string,
): Promise<boolean> {
  const response = await axios.post(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'check_event_ingestion',
        arguments: { workspaceId },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': WIZARD_USER_AGENT,
      },
    },
  );
  return response.data?.result?.content?.[0]?.text
    ? JSON.parse(response.data.result.content[0].text).hasEvents === true
    : false;
}
```

This is preferred over a new REST endpoint because the MCP server already has the right auth
middleware, project context, and Amplitude API access — no new service needed.

## Current workaround

Until this endpoint exists, the wizard falls back to a manual confirmation screen:

```
┌──────────────────────────────────────────────────────────────┐
│  ✔  Enter  I can see events in my Amplitude dashboard        │
└──────────────────────────────────────────────────────────────┘
```

The user is prompted to confirm manually once they see events in their Amplitude dashboard.
This is tracked in `DataIngestionCheckScreen.tsx` — search for `apiUnavailable` to find the
fallback path.
