# HumanKernelOS Integration — E8 Production Hardening & E9 Certification

Execution OS is integrated as a subordinate execution engine under HumanKernelOS (HOS). HumanKernelOS remains the identity authority, schedule authority, Human State owner, and Personal Policy owner.

## E8 — Production Hardening

Production HOS mode now enforces:

- fail-closed startup validation for Execution OS and HOS shared secrets;
- mandatory HTTPS HOS Event Mesh transport;
- bounded Event Mesh delivery timeouts with the existing retry/DLQ path;
- separate liveness and HOS integration readiness;
- API security headers, no-store API responses, bounded request IDs, request metrics, and HOS boundary rate limiting;
- owner-only filesystem permissions for durable HOS boundary state, subject state, backups, and DLQ data;
- source-control exclusion for HOS runtime state;
- no global standalone background worker when HOS is the identity/execution boundary, preventing execution without subject/tenant delegation;
- graceful SIGTERM/SIGINT shutdown;
- production unhandled errors are logged internally but returned to clients without stack traces or raw exception details.

## E9 — HOS Integration Certification

The E9 certification suite validates the complete boundary established by E1–E8:

1. HOS-signed subject identity is required.
2. Tenant/subject state remains isolated.
3. Permission and consent scopes are enforced server-side.
4. Direct legacy HEE API access remains blocked unless explicitly granted.
5. HOS Daily Operating Plan remains the final schedule authority.
6. Human State input remains a minimum-necessary execution projection.
7. PDIE input remains advisory/bounded and cannot mutate Human State or Personal Policy.
8. Lifecycle PAUSED/DEGRADED states stop capability execution.
9. HOS Event Mesh delivery is bounded and recoverable.
10. Production readiness becomes negative when the integration transport/configuration is unsafe.
11. Runtime state is durable, private, and excluded from source control.
12. The engine manifest publishes E9 / contract 1.1.0 while preserving the canonical six HOS capabilities and E7 Human State/Event Mesh contracts.

## Certification command

```bash
bun run certify:hos
```

This runs TypeScript validation, the dedicated HOS E8/E9 certification suite, the complete regression suite, and the production build.

## Production configuration

Required in HOS production mode:

- `NODE_ENV=production`
- `EXECUTION_OS_IDENTITY_MODE=HOS` (HOS is also the default)
- `HEE_SECURITY_SECRET` — 32+ characters
- `HOS_EXECUTION_SHARED_SECRET` — 32+ characters
- `HOS_EVENT_MESH_URL` — absolute HTTPS URL

Recommended explicit durable paths:

- `HOS_BOUNDARY_STORE_PATH`
- `EXECUTION_OS_SUBJECT_DATA_DIR`
- `HEE_DLQ_PATH`

Operational tuning:

- `HOS_EVENT_MESH_TIMEOUT_MS`
- `HOS_RATE_LIMIT_WINDOW_MS`
- `HOS_RATE_LIMIT_MAX_REQUESTS`
- `EXECUTION_OS_MAX_JSON_BODY`

No production secret belongs in the repository.
