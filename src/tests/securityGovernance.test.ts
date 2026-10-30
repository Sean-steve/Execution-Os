import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/createApp';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import { SecurityEngine } from '../server/security';
import { defaultRateLimiter } from '../server/rateLimiter';

describe('SPRINT 9 — EOS-007 Server-Side Security, Privacy & Governance Boundary', () => {
  let app: any;
  let repository: InMemoryExecutionRepository;

  beforeEach(async () => {
    defaultRateLimiter.clear();
    repository = new InMemoryExecutionRepository();
    await repository.reset();
    app = createApp({ repository });
  });

  describe('1. Cryptographic Authentication & Token Integrity', () => {
    it('generates and verifies a valid cryptographic session token', async () => {
      const tokenRes = await request(app)
        .post('/api/v1/hee/auth/token')
        .send({ userId: 'user-executive-1', role: 'OWNER', tenantId: 'tenant-acme' });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.success).toBe(true);
      expect(tokenRes.body.token).toBeDefined();
      expect(tokenRes.body.claims.sub).toBe('user-executive-1');
      expect(tokenRes.body.claims.tenantId).toBe('tenant-acme');
      expect(tokenRes.body.claims.role).toBe('OWNER');

      // Use the token to access protected state
      const stateRes = await request(app)
        .get('/api/v1/hee/state')
        .set('Authorization', `Bearer ${tokenRes.body.token}`);

      expect(stateRes.status).toBe(200);
      expect(stateRes.body.checksum).toBeDefined();
    });

    it('rejects invalid or tampered bearer tokens with 401 AUTHENTICATION_REQUIRED', async () => {
      const validToken = SecurityEngine.generateSessionToken('user-1', 'OWNER');
      const tamperedToken = validToken.substring(0, validToken.length - 5) + 'xxxxx';

      const res = await request(app)
        .get('/api/v1/hee/state')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('rejects cross-tenant data access attempts with 403 AUTHORIZATION_FAILED', async () => {
      // Token minted for tenant-acme
      const token = SecurityEngine.generateSessionToken('user-1', 'OWNER', 'tenant-acme');

      // Request explicitly asks for tenant-globex
      const res = await request(app)
        .get('/api/v1/hee/state')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'tenant-globex');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTHORIZATION_FAILED');
      expect(res.body.message).toContain('Cross-tenant security violation');
    });

    it('rejects cross-user impersonation attempts with 403 AUTHORIZATION_FAILED', async () => {
      // Token minted for user-alice
      const token = SecurityEngine.generateSessionToken('user-alice', 'OWNER', 'tenant-acme');

      // Header attempts to impersonate user-bob
      const res = await request(app)
        .get('/api/v1/hee/state')
        .set('Authorization', `Bearer ${token}`)
        .set('x-user-id', 'user-bob');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTHORIZATION_FAILED');
      expect(res.body.message).toContain('Cross-user access denied');
    });
  });

  describe('2. Server-Side G0-G5 Governance Enforcement (Frontend Untrusted)', () => {
    it('enforces G3 Trading Gatekeeper: rejects starting live trading without pre-market analysis', async () => {
      const state = await repository.loadState();
      // Ensure trading prerequisites are not fulfilled
      state.tradingProtocol = {
        isTradingDay: true,
        marketAnalyzed: false,
        setupDetected: false,
        setupName: '',
        strategyCriteriaMet: false,
        riskLimitsSatisfied: false,
        stopLossDefined: false,
        executed: false,
        tradeNotes: '',
        closedTerminal: false,
        noSetupJustified: false,
        preMarketAnalysisDone: false,
        rulesConfirmed: false,
        riskAgreed: false,
        stopLossMandatory: true,
        maxOpenPositions: 2,
        currentOpenPositions: 0,
      };
      await repository.saveState(state);

      const res = await request(app)
        .post('/api/v1/hee/activities/task-trading-execution/start')
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TRADING_GATE_CLOSED');
      expect(res.body.message).toContain('Trading Gatekeeper');
    });

    it('enforces G2 Protected Commitments: rejects non-family activity during Family Block (16:00-19:30)', async () => {
      const res = await request(app)
        .post('/api/v1/hee/activities/task-outside-light/adjust')
        .send({
          startMinutes: 1000, // 16:40 (inside 16:00-19:30)
          endMinutes: 1060,   // 17:40
          isEmergencyOverride: false,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('GOVERNANCE_DENIED');
      expect(res.body.message).toContain('Protected Commitment Violation');
    });

    it('enforces G5 Override Validation: rejects user override without sufficient justification reason', async () => {
      const res = await request(app)
        .post('/api/v1/hee/activities/task-outside-light/override')
        .send({
          overrideType: 'DEFER',
          reason: '  ', // Empty reason
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('verifies tamper-proof cryptographic override signatures', async () => {
      const validSig = SecurityEngine.signOverridePayload({
        userId: 'user-default-1',
        overrideType: 'DEFER',
        reason: 'Emergency client escalation requiring immediate attention',
        targetTaskId: 'task-outside-light',
        timestamp: '2026-08-24T12:00:00.000Z',
      });

      // Valid signed override
      const validRes = await request(app)
        .post('/api/v1/hee/activities/task-outside-light/override')
        .send({
          overrideType: 'DEFER',
          reason: 'Emergency client escalation requiring immediate attention',
          timestamp: '2026-08-24T12:00:00.000Z',
          signature: validSig,
        });

      expect(validRes.status).toBe(200);
      expect(validRes.body.success).toBe(true);

      // Forged / tampered signature
      const tamperedRes = await request(app)
        .post('/api/v1/hee/activities/task-outside-light/override')
        .send({
          overrideType: 'DEFER',
          reason: 'Emergency client escalation requiring immediate attention',
          timestamp: '2026-08-24T12:00:00.000Z',
          signature: 'deadbeefcafebabe1234567890abcdef',
        });

      expect(tamperedRes.status).toBe(403);
      expect(tamperedRes.body.code).toBe('SECURITY_INTEGRITY_VIOLATION');
    });

    it('enforces G4 Decision Approvals: rejects approving non-existent or stale decisions', async () => {
      const res = await request(app)
        .post('/api/v1/hee/decisions/fake-decision-id/approve')
        .send({ optionId: 'opt-1' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('GOVERNANCE_DENIED');
      expect(res.body.message).toContain('stale or does not match currently active');
    });
  });

  describe('3. Rate Limiting & Abuse Prevention', () => {
    it('throttles excessive sensitive mutations exceeding window limit (429 RATE_LIMIT_EXCEEDED)', async () => {
      const token = SecurityEngine.generateSessionToken('user-burst-tester', 'OWNER');

      // The sensitive limiter allows 20 reqs/min for overrides. Send 25 rapid requests.
      let rateLimited = false;
      for (let i = 0; i < 25; i++) {
        const res = await request(app)
          .post('/api/v1/hee/activities/task-outside-light/override')
          .set('Authorization', `Bearer ${token}`)
          .send({
            overrideType: 'DEFER',
            reason: `Legitimate business override reason number ${i}`,
          });

        if (res.status === 429) {
          rateLimited = true;
          expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
          expect(res.header['retry-after']).toBeDefined();
          break;
        }
      }

      expect(rateLimited).toBe(true);
    });
  });

  describe('4. Autonomy Pause / Manual Mode Boundaries', () => {
    it('pauses autonomy and enters manual mode when requested', async () => {
      const pauseRes = await request(app)
        .patch('/api/v1/hee/governance/policies')
        .send({ autonomyLevel: 'MANUAL' });

      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.success).toBe(true);

      const state = await repository.loadState();
      expect(state.autonomyLevel).toBe(0);
    });
  });

  describe('5. Symmetric Encryption of Sensitive Secrets', () => {
    it('encrypts and decrypts sensitive data payloads with AES-256-GCM', () => {
      const secret = 'Trading-API-Key-Secured-Production-Vault-9988';
      const encrypted = SecurityEngine.encryptSensitiveData(secret);
      expect(encrypted.ciphertext).not.toBe(secret);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();

      const decrypted = SecurityEngine.decryptSensitiveData(encrypted);
      expect(decrypted).toBe(secret);
    });
  });
});
