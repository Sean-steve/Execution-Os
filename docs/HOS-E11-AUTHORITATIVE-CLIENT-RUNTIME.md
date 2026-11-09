# HOS E11 — Authoritative Client Runtime & Workflow Unification

## Outcome

E11 removes the browser as a competing execution authority.

Production HOS flow:

```
HumanKernelOS
  -> signed HOS assertion
  -> POST /api/v1/hos/client-session
  -> short-lived delegated HOS client token
  -> /api/v1/client/*
  -> subject-scoped ExecutionApplicationService
  -> canonical repository / PostgreSQL
  -> HOS Event Mesh
```

The HOS shared signing secret is never exposed to the browser.

## Client authority rules

- `VITE_EXECUTION_RUNTIME_MODE=AUTHORITATIVE` makes server authority mandatory.
- `VITE_EXECUTION_API_URL` points the Pages/client build at the HTTPS Execution OS backend.
- `VITE_HOS_ORIGIN` is the exact trusted HOS origin allowed to deliver a delegated client session via `postMessage`.
- Browser localStorage is cache only in authoritative mode.
- Import, reset, local time simulation, legacy cross-device HEE sync and local mutation fallbacks are disabled in authoritative mode.
- Offline queued commands preserve idempotency keys and replay through the subject-scoped client command endpoint.

## Delegated client session

A verified HOS caller requests:

`POST /api/v1/hos/client-session`

The backend returns a short-lived `HOS_CLIENT` Bearer token containing the HOS subject, tenant, permissions and consent scopes. The client token is accepted only by the E11 `/api/v1/client/*` boundary.

## Authoritative client API

Core endpoints:

- `GET /api/v1/client/state`
- `GET /api/v1/client/runtime`
- `POST /api/v1/client/commands`
- `GET /api/v1/client/scheduler/status`
- `POST /api/v1/client/scheduler/tick`
- `POST /api/v1/client/scheduler/run-job`
- `POST /api/v1/client/scheduler/toggle`
- `POST /api/v1/client/notifications/:id/read`
- `POST /api/v1/client/performance/sessions/:id/ai`

Every mutation is subject/tenant scoped and governed by HOS permission + consent checks. Command mutations require an `Idempotency-Key`.

## Workflows unified in E11

- Human decision approval
- Tomorrow planning and day activation
- Late-wake recovery
- Evening review and daily history
- Adaptation discovery, approval, measurement, retention and rollback
- Command Center victory/top-three intent
- Company-of-the-Day progress
- Morning identity, dream journal and workout progress
- Afternoon workout progress
- Reward creation, redemption and replenishment
- Autonomy and strict-time governance settings
- Cross-device pull and offline command replay
- Background scheduler controls and notification read state
- Scoped Performance AI requests

## Local compatibility

`VITE_EXECUTION_RUNTIME_MODE=LOCAL` retains standalone development/demo behavior.

Legacy standalone family/trading/personal policy stays behind the existing `legacyStandaloneCompatibility` flag and is not used as HOS policy authority.

## Production activation

E11 code is deployment-ready, but a GitHub Pages frontend cannot host the backend. Live production still requires:

1. Always-on HTTPS Execution OS backend.
2. PostgreSQL with E10 migrations applied.
3. Real HOS assertion/event-mesh configuration.
4. Pages build configured with the live API URL and trusted HOS origin.
5. End-to-end HOS -> delegated client -> PostgreSQL -> worker -> Event Mesh certification.
