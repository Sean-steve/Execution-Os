# Execution OS — Production Reliability & Operations Runbooks (EOS-014)

This document provides official standard operating procedures (SOPs), incident response workflows, and operational runbooks for Execution OS.

---

## Subsystem Observability & Reliability Architecture

```
                                 [ Incoming Requests / Timers / Events ]
                                                    │
                                                    ▼
                       ┌─────────────────────────────────────────────────────────┐
                       │  Distributed Tracing & Structured Logging Engine        │
                       │  (TraceId, SpanId, CausationId, Correlation Context)   │
                       └────────────────────────────┬────────────────────────────┘
                                                    │
                      ┌─────────────────────────────┼────────────────────────────┐
                      ▼                             ▼                            ▼
         ┌─────────────────────────┐   ┌─────────────────────────┐  ┌─────────────────────────┐
         │     Circuit Breakers    │   │  Operational Metrics    │  │   Durable Event Store   │
         │ (DB, Auth, Worker, Bus) │   │ (p50/p95/p99 Latencies) │  │  (Append-Only Ledger)   │
         └────────────┬────────────┘   └─────────────────────────┘  └────────────┬────────────┘
                      │                                                          │
                      ▼                                                          ▼
         ┌─────────────────────────┐                                ┌─────────────────────────┐
         │     Storage Engine      │                                │    Dead-Letter Queue    │
         │ (Snapshots & Checksums) │                                │  (Backoff Retry Engine) │
         └─────────────────────────┘                                └─────────────────────────┘
```

---

## Index of Operational Runbooks

| Code | Title | Subsystem | Severity | Auto-Remediation |
| :--- | :--- | :--- | :--- | :--- |
| **RB-001** | [Database Outage & Storage Fallback](#rb-001-database-outage--storage-fallback) | Storage / Repository | `CRITICAL` | ✅ Yes |
| **RB-002** | [Event Backlog & Dispatch Storm](#rb-002-event-backlog--dispatch-storm) | Event Dispatcher & DLQ | `HIGH` | ✅ Yes |
| **RB-003** | [Failed Migration & Version Incompatibility](#rb-003-failed-migration--version-incompatibility) | Schema & Upcasters | `HIGH` | ✅ Yes |
| **RB-004** | [Corrupted Schedule & Timeline Collision](#rb-004-corrupted-schedule--timeline-collision) | Timeline & Routine Engine | `CRITICAL` | ✅ Yes |
| **RB-005** | [Background Worker Outage & Watchdog Stall](#rb-005-background-worker-outage--watchdog-stall) | Background Worker | `HIGH` | ✅ Yes |
| **RB-006** | [Authentication Provider Outage](#rb-006-authentication-provider-outage) | Authentication | `MEDIUM` | ✅ Yes |
| **RB-007** | [Unexpected Allocation Storm](#rb-007-unexpected-allocation-storm) | Allocation Engine | `HIGH` | ✅ Yes |

---

## RB-001: Database Outage & Storage Fallback

### 1. Symptoms & Diagnostic Indicators
- `saveState` or `loadState` throwing persistent I/O timeout exceptions.
- `DatabaseCircuitBreaker` status is `OPEN`.
- Client UI displays amber `Local Memory Fallback Active` banner.
- Write latency metrics exceed `5,000ms`.

### 2. Root Cause Analysis
- Ephemeral container filesystem unmounted or storage partition full.
- Corrupted `localStorage` or `IndexedDB` key partition.
- Concurrent file lock contention on SQLite / repository storage layer.

### 3. Step-by-Step Recovery Procedure
1. Check browser/host storage quota and disk space availability.
2. In the Operations Center HUD, verify the state of `circuitBreakers.database`.
3. Capture an emergency in-memory JSON state snapshot.
4. Reset the database circuit breaker to `CLOSED` or re-initialize the repository partition.
5. If persistent storage was cleared, restore state using the emergency snapshot.

### 4. Post-Incident Verification Checklist
- [ ] Database circuit breaker is `CLOSED`.
- [ ] State persistence roundtrip succeeds without errors.
- [ ] Authoritative task completion ledger and reward points are intact.
- [ ] Cryptographic checksum verification on new snapshot passes.

---

## RB-002: Event Backlog & Dispatch Storm

### 1. Symptoms & Diagnostic Indicators
- Event dispatch latency spikes above `200ms`.
- Dead-Letter Queue (DLQ) depth increases rapidly.
- Event throughput exceeds normal baseline by > 10x.
- Consumer handler exceptions logged in structured telemetry.

### 2. Root Cause Analysis
- Recursive event chains (e.g., event handler issuing command that emits same event).
- Malformed "poison pill" event causing consumer crashes and endless retries.
- Multi-device sync burst firing simultaneous command streams on reconnect.

### 3. Step-by-Step Recovery Procedure
1. Inspect DLQ in Operations Center to isolate repeated failing event types.
2. Pause active event consumer processing if a recursive cascade is detected.
3. Mark unrecoverable poison pill entries as `DISMISSED`.
4. Trigger exponential backoff retry for transient network/concurrency failures.
5. Purge drained queue and resume standard event bus operations.

### 4. Post-Incident Verification Checklist
- [ ] DLQ pending count is `0`.
- [ ] Event dispatch latency is `< 15ms`.
- [ ] No recursive event loops in structured log stream.

---

## RB-003: Failed Migration & Version Incompatibility

### 1. Symptoms & Diagnostic Indicators
- Schema validation error during application bootstrap.
- Unrecognized entity fields or missing required columns in repository.
- `MigrationFailure` event logged in durable event store.

### 2. Root Cause Analysis
- Incomplete field upcasting from older schema versions (v0 -> v1 -> v2).
- Incompatible version stamp in state metadata.
- Missing downgrade transformation function during partial migration.

### 3. Step-by-Step Recovery Procedure
1. Inspect migration logs to pinpoint failing schema property.
2. Halt automatic upcasters to prevent further corrupt writes.
3. Revert to pre-migration baseline snapshot (`schemaVersion: 1`).
4. Re-verify structural invariants across all tasks, events, and activities.
5. Apply patched migration upcaster with defensive field guards.

### 4. Post-Incident Verification Checklist
- [ ] Schema version matches supported release.
- [ ] Historical day records and event store deserialize cleanly.
- [ ] Upcasting latency returns to baseline (`< 5ms`).

---

## RB-004: Corrupted Schedule & Timeline Collision

### 1. Symptoms & Diagnostic Indicators
- Timeline UI displays overlapping task intervals.
- Missing mandatory anchors (e.g. 5:30 AM Awaken or 10:00 PM Shutdown).
- Negative duration minutes or `NaN` timestamps on task cards.
- Reconciliation engine reporting schedule integrity failures.

### 2. Root Cause Analysis
- Conflicting simultaneous manual overrides from multiple disconnected devices.
- Unchecked task creation with `endMinutes <= startMinutes`.
- Corrupted calendar import payload.

### 3. Step-by-Step Recovery Procedure
1. Run **Schedule Corruption Analysis** in the Operations Center.
2. Review detected collisions, missing mandatory anchors, and invalid boundaries.
3. Click **Execute Self-Healing Repair** (`defaultReliabilityService.healCorruptedSchedule`).
4. Ensure 5-minute structural buffers are placed between adjacent blocks.
5. Confirm that all completed task records retain their original execution times.

### 4. Post-Incident Verification Checklist
- [ ] All tasks have strictly valid bounds: `0 <= start < end <= 1440`.
- [ ] Zero overlapping intervals for non-parallel tasks.
- [ ] Mandatory anchors (Awaken, Sleep) present and ordered.
- [ ] 100% of completed task records preserved without loss.

---

## RB-005: Background Worker Outage & Watchdog Stall

### 1. Symptoms & Diagnostic Indicators
- Background Worker status reports `STOPPED` or `DEGRADED`.
- Last tick timestamp is older than `60s` (2x tick interval).
- Overdue expired allocations remain stuck in unexpired state.
- Time-critical anchor notifications fail to trigger.

### 2. Root Cause Analysis
- Unhandled exception in reconciliation callback terminating timer loop.
- Browser tab execution throttled or suspended in background.
- Deadlock during asynchronous repository save.

### 3. Step-by-Step Recovery Procedure
1. Check worker heartbeat and recent error logs in Operations Center.
2. Trigger on-demand manual reconciliation tick (`BackgroundWorker.tick()`).
3. Reset worker circuit breaker and restart background worker daemon.
4. Verify heartbeat updates every `30s`.

### 4. Post-Incident Verification Checklist
- [ ] Worker status is `ACTIVE` and running.
- [ ] Last tick timestamp is within `< 30s`.
- [ ] Scheduler throughput metrics actively incrementing.

---

## RB-006: Authentication Provider Outage

### 1. Symptoms & Diagnostic Indicators
- External OAuth provider returning HTTP 503/504 errors.
- Token refresh calls failing with network timeouts.
- `AuthCircuitBreaker` status is `OPEN`.

### 2. Root Cause Analysis
- External identity provider downtime.
- Client token expiration during offline usage.
- Rate-limiting on authentication API gateway.

### 3. Step-by-Step Recovery Procedure
1. Automatically activate **Local Authoritative Mode** to prevent user lockout.
2. Queue state write operations locally for post-recovery synchronization.
3. Monitor auth circuit breaker for provider recovery.
4. Once auth is restored, re-validate session and flush queued sync operations.

### 4. Post-Incident Verification Checklist
- [ ] User can view and complete routine anchors in offline mode without crashing.
- [ ] Auth circuit breaker resets to `CLOSED` upon provider restoration.
- [ ] Queued events synchronize cleanly upon reconnect.

---

## RB-007: Unexpected Allocation Storm

### 1. Symptoms & Diagnostic Indicators
- Dynamic allocation rate exceeds `50 recalcs/minute`.
- Allocation latency spikes above `100ms`.
- High CPU utilization during schedule evaluation.
- Timeline UI repeatedly re-rendering and flickering.

### 2. Root Cause Analysis
- Rapid successive task adjustments triggering cascading recalculations.
- Oscillating energy score adjustments between adjacent activities.
- Multi-device sync echo loops.

### 3. Step-by-Step Recovery Procedure
1. Engage **Allocation Governor Throttle** (enforce 5-second recalculation cooldown).
2. Lock active timeline allocations for the upcoming 60-minute window.
3. Consolidate pending dynamic allocation requests into a single batch pass.
4. Release governor throttle once timeline stabilizes.

### 4. Post-Incident Verification Checklist
- [ ] Allocation recalculation rate stabilizes under `5 per minute`.
- [ ] Allocation latency returns to `< 10ms`.
- [ ] Schedule allocations remain stable.
