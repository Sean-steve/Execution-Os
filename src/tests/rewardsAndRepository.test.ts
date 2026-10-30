import { describe, it, expect } from 'vitest';
import { replenishRewardsCatalog } from '../services/rewardCatalogService';
import { InMemoryExecutionRepository, LocalStorageExecutionRepository } from '../services/repository';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { Reward } from '../types';

describe('EOS-011 & Repository Decoupling Tests', () => {
  it('should auto-replenish reward catalog when unredeemed items drop below threshold', () => {
    const depletedRewards: Reward[] = [
      { id: 'r1', title: 'Coffee', description: 'desc', category: 'DINING', pointsRequired: 15, unlocked: true, redeemed: true },
      { id: 'r2', title: 'Book', description: 'desc', category: 'EXPERIENCE', pointsRequired: 25, unlocked: true, redeemed: true },
    ];

    const replenished = replenishRewardsCatalog(depletedRewards);
    const unredeemed = replenished.filter(r => !r.redeemed);
    expect(unredeemed.length).toBeGreaterThanOrEqual(6);
  });

  it('should persist and load state via InMemoryExecutionRepository', async () => {
    const repo = new InMemoryExecutionRepository(DEFAULT_APP_STATE);
    const loaded = await repo.load();
    expect(loaded.rewardPoints).toBe(DEFAULT_APP_STATE.rewardPoints);

    const modified = { ...loaded, rewardPoints: 250 };
    await repo.save(modified);
    const reloaded = await repo.load();
    expect(reloaded.rewardPoints).toBe(250);
  });
});
