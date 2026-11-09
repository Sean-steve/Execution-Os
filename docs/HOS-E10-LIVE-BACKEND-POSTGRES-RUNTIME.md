# Phase E10 — Live Backend, PostgreSQL Persistence & HOS Runtime Activation

## Outcome

E10 replaces the production per-subject JSON state path with PostgreSQL, adds a production database startup gate, and binds HOS lifecycle activation to subject-aware background workers.

GitHub Pages remains the static Execution OS UI. The Express backend must run on an always-on Node/Bun host because GitHub Pages cannot execute the API or background workers.

## Production activation

Set:

```env
NODE_ENV=production
EXECUTION_OS_IDENTITY_MODE=HOS
EXECUTION_OS_PERSISTENCE=postgres
EXECUTION_OS_REQUIRE_POSTGRES=true
DATABASE_URL=postgresql://...
DATABASE_SSL=require
HEE_SECURITY_SECRET=<32+ chars>
HOS_EXECUTION_SHARED_SECRET=<32+ chars>
HOS_EVENT_MESH_URL=https://<human-kernel-host>/...
EXECUTION_OS_WORKER_TICK_MS=30000
EXECUTION_OS_TIMEZONE=Africa/Nairobi
```

Apply the schema:

```bash
bun install
bun run db:migrate
```

Then certify:

```bash
bun run certify:hos
NODE_ENV=production bun run build
bun run start
```

Health endpoints:

- `GET /api/health` — process liveness
- `GET /api/v1/hos/readiness` — HOS/E10 readiness
- `GET /api/v1/hos/runtime` — authenticated subject worker state

## PostgreSQL ownership

`execution_os_subject_state` stores the canonical execution state keyed by `tenant_id + subject_id`.

`execution_os_runtime_subjects` stores durable lifecycle activation so ACTIVE subject workers are restored after backend restart.

HOS remains identity and schedule authority. Execution OS only executes inside the delegated HOS boundary.

## Remaining live-infrastructure evidence

Code-level E10 is complete when CI passes. Full live activation additionally requires a real HTTPS backend host, a reachable PostgreSQL database, and the real HumanKernelOS Event Mesh URL/secrets. Those credentials are infrastructure inputs and are not committed to Git.
