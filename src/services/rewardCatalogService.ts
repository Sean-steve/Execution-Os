import { Reward } from '../types';

export interface RewardTemplate {
  title: string;
  description: string;
  category: Reward['category'];
  pointsRequired: number;
  isRepeatable?: boolean;
}

export const PROCEDURAL_REWARD_TEMPLATES: RewardTemplate[] = [
  // Tier 1 (15-30 pts): Micro-Indulgences & High-Frequency Experiences
  {
    title: 'Artisanal Single-Origin Pour-Over Coffee',
    description: 'Visit a boutique specialty roastery mid-morning with an unhurried mind.',
    category: 'DINING',
    pointsRequired: 15,
    isRepeatable: true,
  },
  {
    title: 'Guilt-Free High-Tier Audible / Physical Book',
    description: 'Instantly acquire any high-leverage philosophy, technical, or biography book.',
    category: 'EXPERIENCE',
    pointsRequired: 25,
    isRepeatable: true,
  },
  {
    title: 'Sunset Espresso & Journaling Session',
    description: 'Sit at an outdoor cafe terrace at 6:30 PM with pure creative zero-inbox headspace.',
    category: 'EXPERIENCE',
    pointsRequired: 20,
    isRepeatable: true,
  },
  {
    title: 'Premium Dark Chocolate & Cold Brew Treat',
    description: 'Savor single-origin 85% dark chocolate post-deep work victory.',
    category: 'TREAT',
    pointsRequired: 15,
    isRepeatable: true,
  },

  // Tier 2 (35-60 pts): Rejuvenation, Dining & Family Adventures
  {
    title: 'Prime Steakhouse / Chef’s Table Dinner',
    description: 'Unhurried celebratory dinner with partner/family honoring high-cadence weekly execution.',
    category: 'DINING',
    pointsRequired: 50,
    isRepeatable: true,
  },
  {
    title: 'Panoramic Hilltop Sunset Drive with Family',
    description: 'Golden hour 45-minute country road drive with favorite acoustic music & baby.',
    category: 'ADVENTURE',
    pointsRequired: 40,
    isRepeatable: true,
  },
  {
    title: 'Deep Tissue Recovery Massage & Infrared Sauna',
    description: '60-minute sports massage + contrast recovery bath for physiological reset.',
    category: 'EXPERIENCE',
    pointsRequired: 55,
    isRepeatable: true,
  },
  {
    title: 'Cinema VIP Recliner Screening & Fresh Treat',
    description: 'Catch an evening masterpiece film with zero guilt or thought of work backlog.',
    category: 'EXPERIENCE',
    pointsRequired: 35,
    isRepeatable: true,
  },

  // Tier 3 (75-150 pts): High-Tier Milestones & Tech Equipment
  {
    title: 'Premium High-Fidelity Noise-Canceling Upgrade',
    description: 'Upgrade workstation audio gear or custom ergonomic battlefield equipment.',
    category: 'TECH',
    pointsRequired: 120,
    isRepeatable: false,
  },
  {
    title: 'Weekend Cabin Escapade & Pine Forest Hike',
    description: '48-hour mountain retreat with family, zero laptops, and full presence.',
    category: 'ADVENTURE',
    pointsRequired: 140,
    isRepeatable: true,
  },
  {
    title: 'Boutique Seaside Resort Day Pass & Spa Access',
    description: 'Full day oceanfront infinity pool pass with cabana lunch and family swim.',
    category: 'ADVENTURE',
    pointsRequired: 90,
    isRepeatable: true,
  },
  {
    title: 'Mechanical Keyboard / Bespoke Desk Asset',
    description: 'Tactile custom mechanical keyboard or handmade leather desk pad for deep work.',
    category: 'TECH',
    pointsRequired: 80,
    isRepeatable: false,
  },
];

/**
 * Ensures the reward catalog always has at least 6 unredeemed items available.
 * If depleted, it dynamically generates fresh experiential rewards.
 */
export const replenishRewardsCatalog = (existingRewards: Reward[]): Reward[] => {
  const activeUnredeemed = existingRewards.filter(r => !r.redeemed);
  
  if (activeUnredeemed.length >= 6) {
    return existingRewards;
  }

  const neededCount = 8 - activeUnredeemed.length;
  const newGenerated: Reward[] = [];
  
  // Pick from templates not currently unredeemed
  const unredeemedTitles = new Set(activeUnredeemed.map(r => r.title));
  const availableTemplates = PROCEDURAL_REWARD_TEMPLATES.filter(
    t => !unredeemedTitles.has(t.title)
  );

  const pool = availableTemplates.length > 0 ? availableTemplates : PROCEDURAL_REWARD_TEMPLATES;

  for (let i = 0; i < neededCount; i++) {
    const template = pool[i % pool.length];
    const salt = Math.floor(1000 + Math.random() * 9000);
    newGenerated.push({
      id: `gen-rew-${Date.now()}-${salt}-${i}`,
      title: template.title,
      description: template.description,
      category: template.category,
      pointsRequired: template.pointsRequired,
      unlocked: false,
      redeemed: false,
    });
  }

  return [...existingRewards, ...newGenerated];
};
