# Execution OS — Phase 6.1 Live Activation

Status: **BLOCKED until live infrastructure evidence exists**

## Purpose

Execution OS is an external HumanKernelOS operating engine. Code certification is not sufficient for production activation because the current production repository is file-backed.

A production host must prove that execution state survives process restart and host/container replacement.

## Required production storage layout

Production HOS mode requires:

```bash
EXECUTION_OS_DURABLE_STORAGE_ROOT=/var/lib/execution-os
HEE_DATABASE_PATH=/var/lib/execution-os/canonical/canonical_execution_db.json
HOS_BOUNDARY_STORE_PATH=/var/lib/execution-os/hos/boundary.json
EXECUTION_OS_SUBJECT_DATA_DIR=/var/lib/execution-os/subjects
HEE_DLQ_PATH=/var/lib/execution-os/dlq/dead_letter_queue.json
```

The durable root must be an absolute path backed by persistent storage.

All state paths must be inside the declared durable root and remain logically distinct.

## Recovery evidence

Production HOS readiness also requires:

```bash
EXECUTION_OS_BACKUP_VERIFIED_AT=<ISO-8601 timestamp>
EXECUTION_OS_RESTORE_DRILL_VERIFIED_AT=<ISO-8601 timestamp>
```

Rules:

- backup verification evidence expires after 30 days;
- restore-drill evidence expires after 90 days;
- timestamps represent completed evidence, not intent;
- never set either timestamp simply to make readiness return HTTP 200.

## Backup verification

A valid backup must include, as applicable:

- canonical execution database;
- HOS boundary store;
- subject-scoped execution state;
- dead-letter queue;
- configuration required to reconstruct the same storage layout.

Secrets must be recovered from the deployment secret store, not copied into backup archives.

## Restore drill

Restore into an isolated environment and verify:

1. restored files have restrictive ownership/permissions;
2. HOS boundary lifecycle/idempotency state loads;
3. at least one subject state loads with the correct subject/tenant boundary;
4. canonical state checksum and schema version validate;
5. DLQ state loads without cross-subject exposure;
6. production startup validation succeeds;
7. `GET /api/health` returns 200;
8. `GET /api/v1/hos/readiness` returns 200;
9. identity authority remains `HumanKernelOS`;
10. schedule authority remains `HumanKernelOS`.

## Restart/redeploy proof

Before live certification, perform a state mutation using a designated test subject, restart/redeploy the service without altering the persistent volume, and verify the state remains intact.

A container-local filesystem that disappears when the service is replaced does not satisfy this gate.

## HumanKernelOS integration deployment

Production HOS mode additionally requires:

- `EXECUTION_OS_IDENTITY_MODE=HOS`
- `HOS_EXECUTION_SHARED_SECRET` configured securely
- `HOS_EVENT_MESH_URL` pointing to the production HumanKernelOS HTTPS ingress
- production liveness and HOS readiness passing

The service must remain unavailable for HOS activation when any critical readiness check fails.
