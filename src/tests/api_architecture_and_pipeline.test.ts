import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/createApp';
import { createExecutionRepository } from '../repositories';
import { TestClock } from '../clock';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from './fixtures/legacyStandaloneScheduleConstants';

describe('EOS-004 — Backend Service & API Architecture', () => {
  let app: any;
  let testClock: TestClock;
  let repo: any;

  beforeEach(() => {
    testClock = new TestClock('05:30');
    repo = createExecutionRepository('memory', JSON.parse(JSON.stringify(DEFAULT_APP_STATE)));
    app = createApp({ repository: repo, clock: testClock });
  });

  // =========================================================================
  // 1. HEALTHCHECK & QUERY APIS
  // =========================================================================

  it('GET /api/health returns operational status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('Execution OS Backend');
  });

  it('GET /api/v1/hee/execution/now returns real-time snapshot and next decision', async () => {
    const res = await request(app).get('/api/v1/hee/execution/now');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.currentTimeMinutes).toBe(330);
    expect(res.body.data.currentTime).toBe('05:30');
    expect(res.body.data.currentMode).toBe('GREEN');
    expect(res.body.data.routineState).toBe('STANDARD');
    expect(res.body.data.nextDecision).toBeDefined();
  });

  it('GET /api/v1/hee/execution/today returns comprehensive ledger and pillars', async () => {
    const res = await request(app).get('/api/v1/hee/execution/today');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tasks.length).toBeGreaterThan(0);
    expect(res.body.data.sevenPillars).toBeDefined();
    expect(res.body.data.sevenPillars.total).toBe(7);
    expect(res.body.data.sevenPillars.pillars.length).toBe(7);
  });

  // =========================================================================
  // 2. NIGHT-BEFORE PLANNING & DAY ACTIVATION
  // =========================================================================

  it('POST /api/v1/hee/plan/tomorrow updates tomorrow execution blueprint authoritatively', async () => {
    const planPayload = {
      plan: {
        top3: ['Build Execution OS Core API', 'Company Outreach Sprint', 'Family Evening Walk'],
        scheduleFocus: 'Heavy API Builder Day',
        workoutType: 'Zone 2 Cardio',
        plannedMeal: 'Clean Whole Foods',
      },
    };

    const res = await request(app)
      .post('/api/v1/hee/plan/tomorrow')
      .send(planPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.state.tomorrowPlan.scheduleFocus).toBe('Heavy API Builder Day');
    expect(res.body.state.tomorrowPlan.top3).toContain('Build Execution OS Core API');
    expect(res.body.events.some((e: any) => e.event_type === 'ActivityScheduled')).toBe(true);
  });

  // =========================================================================
  // 3. ACTIVITY COMMANDS & MUTATIONS
  // =========================================================================

  it('POST /api/v1/hee/activities/:id/start, pause, resume, complete lifecycle', async () => {
    // 1. Start activity
    const startRes = await request(app)
      .post('/api/v1/hee/activities/task-awaken/start');
    expect(startRes.status).toBe(200);
    expect(startRes.body.success).toBe(true);
    expect(startRes.body.events.some((e: any) => e.event_type === 'ActivityStarted')).toBe(true);

    // 2. Pause activity
    const pauseRes = await request(app)
      .post('/api/v1/hee/activities/task-awaken/pause')
      .send({ reason: 'Short hydration pause' });
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.success).toBe(true);
    expect(pauseRes.body.events.some((e: any) => e.event_type === 'ExecutionInterrupted')).toBe(true);

    // 3. Resume activity
    const resumeRes = await request(app)
      .post('/api/v1/hee/activities/task-awaken/resume');
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.success).toBe(true);

    // 4. Complete activity
    const completeRes = await request(app)
      .post('/api/v1/hee/activities/task-awaken/complete')
      .send({ executionStatus: 'ON_TIME' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.success).toBe(true);
    const completedTask = completeRes.body.state.tasks.find((t: any) => t.id === 'task-awaken');
    expect(completedTask.completed).toBe(true);
  });

  // =========================================================================
  // 4. COMMAND PROCESSING PIPELINE: AUTH, VALIDATION, IDEMPOTENCY & VERSIONING
  // =========================================================================

  it('rejects unauthenticated or invalid bearer token with AUTHENTICATION_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/v1/hee/plan/tomorrow')
      .set('Authorization', 'Bearer invalid_token')
      .send({ plan: { scheduleFocus: 'Focus' } });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects read-only user on mutation endpoints with AUTHORIZATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/v1/hee/activities/task-meditation/start')
      .set('x-user-role', 'READONLY');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_FAILED');
  });

  it('rejects malformed payloads with VALIDATION_FAILED (400)', async () => {
    const res = await request(app)
      .post('/api/v1/hee/plan/tomorrow')
      .send({}); // missing plan

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('enforces Idempotency via Idempotency-Key header', async () => {
    const idempotencyKey = 'idemp_key_123456789';

    // First call
    const res1 = await request(app)
      .post('/api/v1/hee/activities/task-meditation/start')
      .set('Idempotency-Key', idempotencyKey);

    expect(res1.status).toBe(200);
    expect(res1.body.version).toBe(2);

    // Second call with same idempotency key
    const res2 = await request(app)
      .post('/api/v1/hee/activities/task-meditation/start')
      .set('Idempotency-Key', idempotencyKey);

    expect(res2.status).toBe(200);
    expect(res2.headers['x-idempotent-replay']).toBe('true');
    expect(res2.body.metadata.idempotentReplay).toBe(true);
    expect(res2.body.version).toBe(2);
  });

  it('enforces Optimistic Concurrency Control / Aggregate Versioning (STALE_VERSION)', async () => {
    // Current version is 1. If-Match: 999 should fail
    const res = await request(app)
      .post('/api/v1/hee/activities/task-meditation/start')
      .set('If-Match', '999');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_VERSION');
    expect(res.body.error.details.expectedVersion).toBe(999);
    expect(res.body.error.details.currentVersion).toBe(1);
  });

  // =========================================================================
  // 5. GOVERNANCE ENFORCEMENT & POLICY CHECKS
  // =========================================================================

  it('enforces Protected Family Block (16:00 - 19:30): rejects non-family work adjustments (GOVERNANCE_DENIED)', async () => {
    // Attempting to schedule deep work into 17:00 (1020 mins)
    const res = await request(app)
      .post('/api/v1/hee/activities/task-deep-work-build/adjust')
      .send({
        startMinutes: 1020,
        endMinutes: 1110,
        reason: 'Attempted evening coding sprint over family dinner',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOVERNANCE_DENIED');
    expect(res.body.error.message).toContain('Protected Family block');
  });

  it('enforces Trading Gatekeeper (TRADING_GATE_CLOSED / DEPENDENCY_BLOCKED)', async () => {
    // Trading day requires market analysis before trading execution
    const res = await request(app)
      .post('/api/v1/hee/activities/task-trading-execution/start');

    expect(res.status).toBe(422);
    expect(['TRADING_GATE_CLOSED', 'DEPENDENCY_BLOCKED']).toContain(res.body.error.code);
  });

  // =========================================================================
  // 6. ALLOCATION RECALCULATION & SIMULATION
  // =========================================================================

  it('POST /api/v1/hee/allocations/recalculate re-computes dynamic allocations', async () => {
    const res = await request(app)
      .post('/api/v1/hee/allocations/recalculate')
      .send({ force: true, reason: 'Test recalculate' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.state.dynamicAllocations.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/hee/simulation/run runs dry-run simulation without corrupting active state', async () => {
    const res = await request(app)
      .post('/api/v1/hee/simulation/run')
      .send({
        simulatedTime: '06:35',
        dryRun: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.data.routineState).toBe('COMPRESSED');
    expect(res.body.data.isCompressed).toBe(true);

    // Active state in repo remains at 05:30
    const stateRes = await request(app).get('/api/v1/hee/execution/now');
    expect(stateRes.body.data.currentTime).toBe('05:30');
  });

  // =========================================================================
  // 7. DECISIONS & GOVERNANCE APIS
  // =========================================================================

  it('GET /api/v1/hee/decisions/pending & POST approve/reject decisions', async () => {
    const getRes = await request(app).get('/api/v1/hee/decisions/pending');
    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data.autonomousDecision).toBeDefined();

    const rejectRes = await request(app)
      .post('/api/v1/hee/decisions/dec-123/reject')
      .send({ reason: 'User choice' });
    expect(rejectRes.status).toBe(200);
  });

  it('GET/PATCH /api/v1/hee/governance/policies and protected commitments', async () => {
    const govRes = await request(app).get('/api/v1/hee/governance/policies');
    expect(govRes.status).toBe(200);
    expect(govRes.body.data.autonomyLevel).toBeDefined();

    const commRes = await request(app).get('/api/v1/hee/governance/protected-commitments');
    expect(commRes.status).toBe(200);
    expect(commRes.body.data.commitments.some((c: any) => c.name.includes('Family'))).toBe(true);
  });

  // =========================================================================
  // 8. GOLDEN SCENARIO EOS-013 EXECUTED ENTIRELY THROUGH REST APIS
  // =========================================================================

  it('EOS-013 Golden Acceptance Scenario: Executes end-to-end simulation exclusively via REST APIs', async () => {
    // 1. Plan Tomorrow via POST /api/v1/hee/plan/tomorrow
    const planRes = await request(app)
      .post('/api/v1/hee/plan/tomorrow')
      .send({
        plan: {
          top3: ['Deep Work Build Execution OS', 'Company Outreach Sprint', 'Family Evening Presence'],
          scheduleFocus: 'Heavy Builder Day',
          plannedMeal: 'Clean Whole Foods & Protein',
          workoutType: 'Zone 2 / Kettlebell',
          companyPriority: 'Execution OS core testing and stability',
          familyActivity: 'Dinner & Outdoor Park Walk (Protected)',
          tradingConditions: 'Only verified A+ setups',
        },
      });
    expect(planRes.status).toBe(200);
    expect(planRes.body.state.tomorrowPlan.scheduleFocus).toBe('Heavy Builder Day');

    // 2. Simulate 06:35 late wake by advancing simulated time via POST /api/v1/hee/time
    const timeRes = await request(app)
      .post('/api/v1/hee/time')
      .send({ isSimulatedTime: true, simulatedTime: '06:35' });
    expect(timeRes.status).toBe(200);

    // 3. Trigger recalculation & scan via POST /api/v1/hee/allocations/recalculate
    const recalcRes = await request(app)
      .post('/api/v1/hee/allocations/recalculate')
      .send({ force: true, reason: 'Late wake drift recovery at 06:35' });
    expect(recalcRes.status).toBe(200);
    expect(recalcRes.body.state.routineState).toBe('COMPRESSED');

    // 4. Verify live status via GET /api/v1/hee/execution/now
    const nowRes = await request(app).get('/api/v1/hee/execution/now');
    expect(nowRes.status).toBe(200);
    expect(nowRes.body.data.isCompressed).toBe(true);
    expect(nowRes.body.data.nextDecision).toBeDefined();

    // 5. Verify family protection in dynamic allocations
    const todayRes = await request(app).get('/api/v1/hee/execution/today');
    expect(todayRes.status).toBe(200);
    const allocations = todayRes.body.data.dynamicAllocations;
    expect(allocations.length).toBeGreaterThan(0);

    const workAllocations = allocations.filter((a: any) =>
      a.activityId === 'task-deep-work-build' ||
      a.activityId === 'task-trading-protocol' ||
      a.activityId === 'task-operational-buffer'
    );

    workAllocations.forEach((alloc: any) => {
      const overlapsFamily =
        alloc.allocatedStartMinutes < PROTECTED_FAMILY_END &&
        alloc.allocatedEndMinutes > PROTECTED_FAMILY_START;
      expect(overlapsFamily).toBe(false);
    });

    // 6. Complete morning task via POST /api/v1/hee/activities/:id/complete
    const completeRes = await request(app)
      .post('/api/v1/hee/activities/task-awaken/complete')
      .send({ executionStatus: 'COMPRESSED' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.state.tasks.find((t: any) => t.id === 'task-awaken').completed).toBe(true);
  });
});
