# Wizard dashboard RPC context (`.amplitude/wizard-context.json`)

After Amplitude SDK **init** is in place (autocapture options decided), write **`.amplitude/wizard-context.json`** at the project root metadata dir so the wizard’s **`POST /dashboards`** request matches reality.

**Shape** (all keys optional — omit keys you don’t know):

```json
{
  "autocaptureEnabled": true,
  "productDisplayName": "My SaaS App",
  "sdkVersion": "2.36.2"
}
```

| Field | Use |
| ----- | --- |
| `autocaptureEnabled` | **Ground truth** for browser/unified SDK autocapture (or `false` when disabled / N/A). If omitted, the wizard guesses from framework — can mismatch custom init. |
| `productDisplayName` | Human label for the dashboard title when the Amplitude **project name** isn’t set or is generic; overrides folder-name fallback. |
| `sdkVersion` | Installed Amplitude SDK version string (e.g. from `package.json`) — forwarded as `product.sdkVersion` for server telemetry / debugging. |

Do **not** put secrets here. This file may be committed like other `.amplitude/` artifacts.

## Relationship to the event plan

Event **`category`** (optional, per row in `.amplitude/events.json`) is separate — see `confirm-event-plan-contract.md`. Valid values: `SIGNUP`, `ACTIVATION`, `ENGAGEMENT`, `CONVERSION`, `OTHER` (wizard-proxy enum). Invalid values are ignored client-side.
