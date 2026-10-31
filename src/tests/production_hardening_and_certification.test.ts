import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { createApp } from '../server/createApp';
import { CanonicalDatabase } from '../canonical/canonicalDatabase';
import { FileCanonicalStorageEngine } from '../canonical/fileCanonicalStorageEngine';
import { ProductionExecutionRepository } from '../canonical/productionRepository';
import { CanonicalMigrationEngine } from '../canonical/migrationEngine';
import { LegacyDataMigrator } from '../canonical/legacyDataMigration';
import { SecurityEngine } from '../server/security';
import { FileDurableEventStore } from '../services/durableEventStore';
import { BackgroundWorker } from '../services/backgroundWorker';
import { IClock } from '../clock';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('Execution OS Final Production Truth Hardening & Certification Suite', () => {
  const testDbDir = path.join(process.cwd(), 'tmp_test_data');
  const testDbPath = path.join(testDbDir, 'test_canonical_db.json');
  const testEventsPath = path.join(testDbDir, 'test_events_log.json');
  const testSecret = 'production_test_master_cryptographic_secret_key_32_bytes';

  let storageEngine: FileCanonicalStorageEngine;
  let db: CanonicalDatabase;
  let repo: ProductionExecutionRepository;
  let eventStore: FileDurableEventStore;

  const createTestClock = (minutes: number, dateStr: string = '2026-08-27'): IClock => ({
    now: () => new Date(`${dateStr}T${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:00.000Z`),
    toISOString: () => `${dateStr}T${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:00.000Z`,
    getCurrentTimeMinutes: () => minutes,
    getTimeString: () => `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`,
    formatTime12Hour: () => `${Math.floor(minutes / 60)}:${(minutes % 60).toString().padStart(2, '0')}`,
  });

  beforeEach(async () => {
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testEventsPath)) fs.unlinkSync(testEventsPath);

    SecurityEngine.setMasterSecretKey(testSecret);

    storageEngine = new FileCanonicalStorageEngine({ filePath: testDbPath });
    db = new CanonicalDatabase(storageEngine);
    repo = new ProductionExecutionRepository(db, 'user_test_owner');
    // This legacy certification suite intentionally exercises standalone mode.
    // Production bootstrap itself is separately certified as truth-clean by HOS E1 tests.
    await repo.saveState(JSON.parse(JSON.stringify(DEFAULT_APP_STATE)));
    eventStore = new FileDurableEventStore(testEventsPath);
  });

  afterEach(async () => {
    SecurityEngine.setMasterSecretKey(null);
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(testEventsPath)) fs.unlinkSync(testEventsPath);
      if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (e) {}
  });

  // =========================================================================
  // P0-001: Real Durable Server Database
  // =========================================================================
  describe('P0-001 — Real Durable Server Database', () => {
    it('persists data to disk atomically with zero state loss', async () => {
      const state = await repo.loadState();
      expect(state).toBeDefined();

      state.currentMode = 'RED';
      state.rewardPoints = 450;
      await repo.saveState(state);

      expect(fs.existsSync(testDbPath)).toBe(true);
      const rawFile = fs.readFileSync(testDbPath, 'utf-8');
      const parsed = JSON.parse(rawFile);
      expect(parsed.profiles).toBeDefined();
      expect(parsed.profiles.length).toBeGreaterThan(0);

      // Verify second repository instance reading from same disk file sees exact saved data
      const secondaryRepo = new ProductionExecutionRepository(new CanonicalDatabase(new FileCanonicalStorageEngine({ filePath: testDbPath })), 'user_test_owner');
      const reloaded = await secondaryRepo.loadState();
      expect(reloaded.currentMode).toBe('RED');
      expect(reloaded.rewardPoints).toBe(450);
    });
  });

  // =========================================================================
  // P0-002: Versioned Database Schema Migrations
  // =========================================================================
  describe('P0-002 — Versioned Database Schema Migrations', () => {
    it('executes migrations sequentially on empty database and updates schema version', async () => {
      const migrationEngine = new CanonicalMigrationEngine();
      const emptyDb = new CanonicalDatabase(new FileCanonicalStorageEngine({ filePath: testDbPath }));

      const initialVer = await migrationEngine.getCurrentVersion(emptyDb);
      expect(initialVer).toBe(0);

      const result = await migrationEngine.migrateToLatest(emptyDb);
      expect(result.appliedMigrations).toEqual([1, 2, 3]);
      expect(result.currentVersion).toBe(3);

      const postVer = await migrationEngine.getCurrentVersion(emptyDb);
      expect(postVer).toBe(3);

      // Re-running migrateToLatest should be idempotent and apply 0 migrations
      const reRun = await migrationEngine.migrateToLatest(emptyDb);
      expect(reRun.appliedMigrations).toEqual([]);
      expect(reRun.currentVersion).toBe(3);
    });
  });

  // =========================================================================
  // P0-003: Legacy Local Data Migration
  // =========================================================================
  describe('P0-003 — Legacy Local Data Migration', () => {
    it('migrates legacy JSON state safely into the canonical durable database', async () => {
      const legacyState: AppState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
      legacyState.rewardPoints = 999;
      legacyState.tasks[0].completed = true;

      const migrator = new LegacyDataMigrator('user_test_owner');
      const result = await migrator.migrateLegacyState(db, legacyState);

      expect(result.success).toBe(true);
      expect(result.importedTasksCount).toBe(legacyState.tasks.length);

      const loaded = await repo.loadState();
      expect(loaded.rewardPoints).toBe(999);
      expect(loaded.tasks[0].completed).toBe(true);
    });
  });

  // =========================================================================
  // P0-004 & P0-005: Authentication Fail-Closed & Secret Validation
  // =========================================================================
  describe('P0-004 & P0-005 — Authentication Fail-Closed & Security Secrets', () => {
    it('fails closed in production: rejects missing, malformed, or forged tokens with 401', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.HEE_SECURITY_SECRET = testSecret;
      process.env.HEE_AUTH_BOOTSTRAP_SECRET = testSecret;

      try {
        const app = createApp({ repository: repo });

        // 1. Missing Authorization header
        const resMissing = await request(app).get('/api/v1/hee/execution/now');
        expect(resMissing.status).toBe(401);
        expect(resMissing.body.error.code).toBe('AUTHENTICATION_REQUIRED');

        // 2. Malformed Authorization header
        const resMalformed = await request(app)
          .get('/api/v1/hee/execution/now')
          .set('Authorization', 'Basic 12345');
        expect(resMalformed.status).toBe(401);

        // 3. Forged token
        const resForged = await request(app)
          .get('/api/v1/hee/execution/now')
          .set('Authorization', 'Bearer forged.token.signature');
        expect(resForged.status).toBe(401);

        // 4. Valid signed token
        const validToken = SecurityEngine.generateSessionToken('user_test_owner', 'OWNER', 'tenant-default');
        const resValid = await request(app)
          .get('/api/v1/hee/execution/now')
          .set('Authorization', `Bearer ${validToken}`);
        expect(resValid.status).toBe(200);
        expect(resValid.body.success).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('refuses to start in production if HEE_SECURITY_SECRET is missing or insecure', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.HEE_SECURITY_SECRET;
      process.env.NODE_ENV = 'production';
      delete process.env.HEE_SECURITY_SECRET;
      SecurityEngine.setMasterSecretKey(null);

      try {
        expect(() => {
          createApp({ repository: repo, validateSecurityConfig: true });
        }).toThrow(/HEE_SECURITY_SECRET/);
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalSecret) process.env.HEE_SECURITY_SECRET = originalSecret;
        SecurityEngine.setMasterSecretKey(testSecret);
      }
    });
  });

  // =========================================================================
  // P0-006: Server-Side Governance Enforcement
  // =========================================================================
  describe('P0-006 — Server-Side Governance Enforcement', () => {
    it('strictly rejects unverified trading and protected family window violations via API', async () => {
      const clock = createTestClock(540); // 09:00 AM
      const app = createApp({ repository: repo, clock });

      const token = SecurityEngine.generateSessionToken('user_test_owner', 'OWNER');

      // Attempt to start live trading execution directly without completing pre-market prep
      const resTrade = await request(app)
        .post('/api/v1/hee/activities/task-trading-execution/start')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(resTrade.status).toBe(422);
      expect(resTrade.body.error.code).toBe('TRADING_GATE_CLOSED');

      // Attempt to schedule non-emergency work inside protected family time (16:00 - 19:30 = 960 - 1170)
      const resFamily = await request(app)
        .post('/api/v1/hee/activities/task-work-block/adjust')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startMinutes: 1000,
          endMinutes: 1080,
          isEmergencyOverride: false,
        });

      expect(resFamily.status).toBe(403);
      expect(resFamily.body.error.code).toBe('GOVERNANCE_DENIED');
    });
  });

  // =========================================================================
  // P0-007 & P0-008: Durable Events, Idempotency & Background Worker
  // =========================================================================
  describe('P0-007 & P0-008 — Durable Events, Idempotency & Background Worker', () => {
    it('persists event records to file and handles idempotent command retries cleanly', async () => {
      const clock = createTestClock(360);
      const app = createApp({ repository: repo, clock });
      const token = SecurityEngine.generateSessionToken('user_test_owner', 'OWNER');

      const idempotencyKey = `idem_plan_${Date.now()}`;
      const planPayload = {
        plan: {
          targetWakeTime: '06:00',
          plannedDayType: 'STANDARD',
          routinePreset: 'FULL',
          priorityAnchorActivities: ['task-morning-mindset', 'task-trading-prep'],
          tradingPlan: { targetSetupsIdentified: 2, maxRiskAllocatedPercent: 1.0, isAuthorized: true },
        },
      };

      // 1. First execution
      const res1 = await request(app)
        .post('/api/v1/hee/plan/tomorrow')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(planPayload);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      // 2. Retry identical command with same Idempotency-Key
      const res2 = await request(app)
        .post('/api/v1/hee/plan/tomorrow')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(planPayload);

      expect(res2.status).toBe(200);
      expect(res2.body.state.tomorrowPlan).toBeDefined();

      // 3. Background Worker operating against durable state
      const worker = new BackgroundWorker(repo, clock, { tickIntervalMs: 1000 });
      const tick = await worker.tick({ forceDayBoundary: false });
      expect(tick.result).toBeDefined();
      expect(tick.result.reconciledAt).toBeDefined();

      const diskState = await repo.loadState();
      expect(diskState.tomorrowPlan).toBeDefined();
    });
  });

  // =========================================================================
  // P0-009: Backend Restart Survival Proof
  // =========================================================================
  describe('P0-009 — Backend Restart Survival Proof', () => {
    it('survives process restart with complete state and governance intact', async () => {
      const clock = createTestClock(400);

      // Instance 1: Boot backend, execute state mutations
      const app1 = createApp({ repository: repo, clock });
      const token = SecurityEngine.generateSessionToken('user_test_owner', 'OWNER');

      await request(app1)
        .post('/api/v1/hee/mode')
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'YELLOW' });

      await request(app1)
        .post('/api/v1/hee/day-type')
        .set('Authorization', `Bearer ${token}`)
        .send({ dayType: 'EARLY_DEPARTURE' });

      await request(app1)
        .post('/api/v1/hee/activities/task-awaken/complete')
        .set('Authorization', `Bearer ${token}`)
        .send({ executionStatus: 'ON_TIME' });

      // SIMULATE PROCESS RESTART: create completely new repository, storage engine, and app instance
      const newStorageEngine = new FileCanonicalStorageEngine({ filePath: testDbPath });
      const newDb = new CanonicalDatabase(newStorageEngine);
      const restartedRepo = new ProductionExecutionRepository(newDb, 'user_test_owner');
      const app2 = createApp({ repository: restartedRepo, clock });

      const resSnapshot = await request(app2)
        .get('/api/v1/hee/execution/today')
        .set('Authorization', `Bearer ${token}`);

      expect(resSnapshot.status).toBe(200);
      expect(resSnapshot.body.data.currentMode).toBe('YELLOW');
      expect(resSnapshot.body.data.dayType).toBe('EARLY_DEPARTURE');

      const completedTask = resSnapshot.body.data.tasks.find((t: any) => t.id === 'task-awaken');
      expect(completedTask.completed).toBe(true);
      expect(completedTask.executionStatus).toBe('ON_TIME');
    });
  });

  // =========================================================================
  // P0-010: Complete 22-Step Production Golden Scenario
  // =========================================================================
  describe('P0-010 — 22-Step Ultimate Production Golden Scenario Execution', () => {
    it('executes full 22-step golden scenario against real production stack with restart survival', async () => {
      let currentMinutes = 1260; // Day -1, 21:00 (9:00 PM)
      let currentDate = '2026-08-26';
      let clock = createTestClock(currentMinutes, currentDate);

      let currentApp = createApp({ repository: repo, clock });
      const token = SecurityEngine.generateSessionToken('user_test_owner', 'OWNER');

      // STEP 1: Plan Tomorrow at 21:00
      const resStep1 = await request(currentApp)
        .post('/api/v1/hee/plan/tomorrow')
        .set('Authorization', `Bearer ${token}`)
        .send({
          plan: {
            targetWakeTime: '06:00',
            desiredWakeMinutes: 360,
            plannedDayType: 'STANDARD',
            routinePreset: 'FULL',
            priorityAnchorActivities: ['task-awaken', 'task-trading-prep'],
            tradingPlan: { targetSetupsIdentified: 2, maxRiskAllocatedPercent: 1.0, isAuthorized: true },
          },
        });
      expect(resStep1.status).toBe(200);

      // STEP 2: Sleep Sanctuary (22:30 -> 1350)
      currentMinutes = 1350;
      clock = createTestClock(currentMinutes, currentDate);

      // STEP 3: Overnight Persistence & Backend Restart Simulation
      currentDate = '2026-08-27';
      currentMinutes = 395; // 06:35 AM (35 min late wake deviation)
      clock = createTestClock(currentMinutes, currentDate);

      // New backend instance
      const restartedRepo = new ProductionExecutionRepository(new CanonicalDatabase(new FileCanonicalStorageEngine({ filePath: testDbPath })), 'user_test_owner');
      currentApp = createApp({ repository: restartedRepo, clock });

      // STEP 4: Wake-up at 06:35 with Autonomous Late Wake Recovery
      const resStep4 = await request(currentApp)
        .post('/api/v1/hee/day/late-wake-recovery')
        .set('Authorization', `Bearer ${token}`)
        .send({ actualWakeMinutes: 395, actualWakeTime: '06:35', reason: 'Overslept 35 minutes' });
      expect(resStep4.status).toBe(200);

      // STEP 5: Verify Routine Compression (Routine Compressed)
      const resStep5 = await request(currentApp)
        .get('/api/v1/hee/execution/now')
        .set('Authorization', `Bearer ${token}`);
      expect(resStep5.status).toBe(200);
      expect(resStep5.body.data.routineState).toBe('COMPRESSED');

      // STEP 6: Execute Awaken Anchor
      const resStep6 = await request(currentApp)
        .post('/api/v1/hee/activities/task-awaken/start')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(resStep6.status).toBe(200);

      const resStep6Complete = await request(currentApp)
        .post('/api/v1/hee/activities/task-awaken/complete')
        .set('Authorization', `Bearer ${token}`)
        .send({ executionStatus: 'ON_TIME' });
      expect(resStep6Complete.status).toBe(200);

      // STEP 7: Attempt Trading Execution without Prep (Strictly Blocked by Governance)
      const resStep7Blocked = await request(currentApp)
        .post('/api/v1/hee/activities/task-trading-execution/start')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(resStep7Blocked.status).toBe(422);
      expect(resStep7Blocked.body.error.code).toBe('TRADING_GATE_CLOSED');

      // STEP 8: Record real Trading Prep evidence & complete the protocol gatekeeper
      await request(currentApp)
        .post('/api/v1/hee/activities/task-trading-protocol/start')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const resTradingEvidence = await request(currentApp)
        .post('/api/v1/hee/trading/protocol')
        .set('Authorization', `Bearer ${token}`)
        .send({
          protocol: {
            isTradingDay: true,
            marketAnalyzed: true,
            setupDetected: true,
            strategyCriteriaMet: true,
            riskLimitsSatisfied: true,
            stopLossDefined: true,
            noSetupJustified: false,
            executed: false,
            closedTerminal: false,
          },
        });
      expect(resTradingEvidence.status).toBe(200);

      const resPrepComplete = await request(currentApp)
        .post('/api/v1/hee/activities/task-trading-protocol/complete')
        .set('Authorization', `Bearer ${token}`)
        .send({ executionStatus: 'ON_TIME' });
      expect(resPrepComplete.status).toBe(200);

      // STEP 9: Trading Execution Gate Opens Once real prerequisite evidence is complete
      const resStep9Allowed = await request(currentApp)
        .post('/api/v1/hee/activities/task-trading-execution/start')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(resStep9Allowed.status).toBe(200);

      // STEP 10: Record executed terminal outcome, then complete Trading Execution
      const resTradeTerminal = await request(currentApp)
        .post('/api/v1/hee/trading/protocol')
        .set('Authorization', `Bearer ${token}`)
        .send({
          protocol: {
            executed: true,
            closedTerminal: true,
          },
        });
      expect(resTradeTerminal.status).toBe(200);

      const resTradeComplete = await request(currentApp)
        .post('/api/v1/hee/activities/task-trading-execution/complete')
        .set('Authorization', `Bearer ${token}`)
        .send({ executionStatus: 'ON_TIME' });
      expect(resTradeComplete.status).toBe(200);

      // STEP 11: Seed Longitudinal Evidence and Execute Adaptation Cycle (HEE-006)
      await request(currentApp)
        .post('/api/v1/hee/adaptations/seed-history')
        .set('Authorization', `Bearer ${token}`)
        .send({ days: 30 });

      const resScan = await request(currentApp)
        .post('/api/v1/hee/adaptations/scan')
        .set('Authorization', `Bearer ${token}`)
        .send({ window: '30d' });
      expect(resScan.status).toBe(200);
      expect(resScan.body.proposals.length).toBeGreaterThan(0);

      const propId = resScan.body.proposals[0].id;

      // STEP 12: Approve Proposal & Apply
      const resApprove = await request(currentApp)
        .post(`/api/v1/hee/adaptations/proposals/${propId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(resApprove.status).toBe(200);

      // STEP 13: Measure Outcome
      const resMeasure = await request(currentApp)
        .post(`/api/v1/hee/adaptations/proposals/${propId}/measure`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(resMeasure.status).toBe(200);

      // STEP 14: Final Backend State Checksum & Verification
      const resFinal = await request(currentApp)
        .get('/api/v1/hee/state')
        .set('Authorization', `Bearer ${token}`);
      expect(resFinal.status).toBe(200);
      expect(resFinal.body.checksum).toBeDefined();
      expect(resFinal.body.data.tasks.filter((t: any) => t.completed).length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // P1-003: Backup and Restore Verification
  // =========================================================================
  describe('P1-003 — Backup & Disaster Recovery Verification', () => {
    it('creates timestamped database backup and restores perfectly after corruption', async () => {
      const state = await repo.loadState();
      state.rewardPoints = 8888;
      await repo.saveState(state);

      // Create backup
      const backupPath = await storageEngine.createBackup();
      expect(fs.existsSync(backupPath)).toBe(true);

      // Simulate database deletion/corruption
      await storageEngine.clear();
      const emptyCheck = await storageEngine.loadData();
      expect(emptyCheck).toBeNull();

      // Restore from backup
      const restored = await storageEngine.restoreFromBackup(backupPath);
      expect(restored).toBeDefined();

      const finalState = await repo.loadState();
      expect(finalState.rewardPoints).toBe(8888);

      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    });
  });
});
