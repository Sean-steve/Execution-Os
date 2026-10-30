import { AppState } from '../types';

export interface DayThemeConfig {
  dayIndex: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  dayName: string;
  shortName: string;
  themeTitle: string;
  motto: string;
  iconName: string;
  // Color tokens
  colorHex: string;
  primaryColorName: string; // e.g. 'blue', 'emerald', 'indigo', 'orange', 'teal', 'rose', 'amber'
  // Pre-calculated Tailwind classes for high-performance zero-glitch rendering
  classes: {
    accentText: string;
    accentBg: string;
    accentBgLight: string;
    accentBorder: string;
    accentBorderLight: string;
    accentButton: string;
    accentButtonGhost: string;
    badge: string;
    ring: string;
    activeNav: string;
    headerBanner: string;
    highlightCard: string;
  };
}

export const DAY_THEMES: Record<number, DayThemeConfig> = {
  // 0: SUNDAY — Solar Sun & Golden Horizon (Restoration, Reflection & Solar Energy)
  0: {
    dayIndex: 0,
    dayName: 'Sunday',
    shortName: 'SUN',
    themeTitle: 'Solar Sunday Horizon',
    motto: 'Restoration, Sovereignty & Solar Alignment',
    iconName: 'Sun',
    colorHex: '#d97706',
    primaryColorName: 'amber',
    classes: {
      accentText: 'text-amber-600',
      accentBg: 'bg-amber-600',
      accentBgLight: 'bg-amber-50',
      accentBorder: 'border-amber-500',
      accentBorderLight: 'border-amber-200',
      accentButton: 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm',
      accentButtonGhost: 'bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200',
      badge: 'bg-amber-100 text-amber-900 border-amber-300',
      ring: 'focus:ring-amber-500',
      activeNav: 'bg-amber-50 text-amber-800 border-amber-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-amber-50 via-amber-50/50 to-transparent border-amber-200',
      highlightCard: 'border-amber-300 ring-1 ring-amber-200 bg-amber-50/30',
    },
  },

  // 1: MONDAY — Cobalt Sapphire & Royal Blue (Unstoppable Initiation & Pure Velocity)
  1: {
    dayIndex: 1,
    dayName: 'Monday',
    shortName: 'MON',
    themeTitle: 'Cobalt Monday Ignition',
    motto: 'Unstoppable Ignition & Master Execution Velocity',
    iconName: 'Zap',
    colorHex: '#2563eb',
    primaryColorName: 'blue',
    classes: {
      accentText: 'text-blue-600',
      accentBg: 'bg-blue-600',
      accentBgLight: 'bg-blue-50',
      accentBorder: 'border-blue-500',
      accentBorderLight: 'border-blue-200',
      accentButton: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
      accentButtonGhost: 'bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200',
      badge: 'bg-blue-100 text-blue-900 border-blue-300',
      ring: 'focus:ring-blue-500',
      activeNav: 'bg-blue-50 text-blue-800 border-blue-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-blue-50 via-blue-50/50 to-transparent border-blue-200',
      highlightCard: 'border-blue-300 ring-1 ring-blue-200 bg-blue-50/30',
    },
  },

  // 2: TUESDAY — Jade Emerald & Vital Force (Momentum, High-Frequency Output & Surge)
  2: {
    dayIndex: 2,
    dayName: 'Tuesday',
    shortName: 'TUE',
    themeTitle: 'Emerald Tuesday Surge',
    motto: 'High-Frequency Output & Relentless Flow State',
    iconName: 'Flame',
    colorHex: '#059669',
    primaryColorName: 'emerald',
    classes: {
      accentText: 'text-emerald-600',
      accentBg: 'bg-emerald-600',
      accentBgLight: 'bg-emerald-50',
      accentBorder: 'border-emerald-500',
      accentBorderLight: 'border-emerald-200',
      accentButton: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
      accentButtonGhost: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200',
      badge: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      ring: 'focus:ring-emerald-500',
      activeNav: 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-emerald-50 via-emerald-50/50 to-transparent border-emerald-200',
      highlightCard: 'border-emerald-300 ring-1 ring-emerald-200 bg-emerald-50/30',
    },
  },

  // 3: WEDNESDAY — Hyper Violet & Electric Indigo (Deep Architecture & Synthesis)
  3: {
    dayIndex: 3,
    dayName: 'Wednesday',
    shortName: 'WED',
    themeTitle: 'Indigo Wednesday Focus',
    motto: 'Deep Architecture, Code Precision & System Synthesis',
    iconName: 'Cpu',
    colorHex: '#4f46e5',
    primaryColorName: 'indigo',
    classes: {
      accentText: 'text-indigo-600',
      accentBg: 'bg-indigo-600',
      accentBgLight: 'bg-indigo-50',
      accentBorder: 'border-indigo-500',
      accentBorderLight: 'border-indigo-200',
      accentButton: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm',
      accentButtonGhost: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200',
      badge: 'bg-indigo-100 text-indigo-900 border-indigo-300',
      ring: 'focus:ring-indigo-500',
      activeNav: 'bg-indigo-50 text-indigo-800 border-indigo-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-indigo-50 via-indigo-50/50 to-transparent border-indigo-200',
      highlightCard: 'border-indigo-300 ring-1 ring-indigo-200 bg-indigo-50/30',
    },
  },

  // 4: THURSDAY — Terracotta Bronze & Flame Orange (Builder Grit & Core Heavy Output)
  4: {
    dayIndex: 4,
    dayName: 'Thursday',
    shortName: 'THU',
    themeTitle: 'Terracotta Thursday Grit',
    motto: 'Relentless Builder Grit & Core Heavy Output',
    iconName: 'Sparkles',
    colorHex: '#ea580c',
    primaryColorName: 'orange',
    classes: {
      accentText: 'text-orange-600',
      accentBg: 'bg-orange-600',
      accentBgLight: 'bg-orange-50',
      accentBorder: 'border-orange-500',
      accentBorderLight: 'border-orange-200',
      accentButton: 'bg-orange-600 hover:bg-orange-700 text-white shadow-sm',
      accentButtonGhost: 'bg-orange-50 hover:bg-orange-100 text-orange-900 border border-orange-200',
      badge: 'bg-orange-100 text-orange-900 border-orange-300',
      ring: 'focus:ring-orange-500',
      activeNav: 'bg-orange-50 text-orange-800 border-orange-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-orange-50 via-orange-50/50 to-transparent border-orange-200',
      highlightCard: 'border-orange-300 ring-1 ring-orange-200 bg-orange-50/30',
    },
  },

  // 5: FRIDAY — Oceanic Teal & Deep Cyan (Precision Gatekeeping, Finish Strong & Victory)
  5: {
    dayIndex: 5,
    dayName: 'Friday',
    shortName: 'FRI',
    themeTitle: 'Oceanic Friday Victory',
    motto: 'Precision Gatekeeping, Clean Outings & Strong Finish',
    iconName: 'TrendingUp',
    colorHex: '#0d9488',
    primaryColorName: 'teal',
    classes: {
      accentText: 'text-teal-600',
      accentBg: 'bg-teal-600',
      accentBgLight: 'bg-teal-50',
      accentBorder: 'border-teal-500',
      accentBorderLight: 'border-teal-200',
      accentButton: 'bg-teal-600 hover:bg-teal-700 text-white shadow-sm',
      accentButtonGhost: 'bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200',
      badge: 'bg-teal-100 text-teal-900 border-teal-300',
      ring: 'focus:ring-teal-500',
      activeNav: 'bg-teal-50 text-teal-800 border-teal-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-teal-50 via-teal-50/50 to-transparent border-teal-200',
      highlightCard: 'border-teal-300 ring-1 ring-teal-200 bg-teal-50/30',
    },
  },

  // 6: SATURDAY — Sunset Rose & Radiant Coral (Family Presence, Adventure & Human Expansion)
  6: {
    dayIndex: 6,
    dayName: 'Saturday',
    shortName: 'SAT',
    themeTitle: 'Sunset Saturday Expansion',
    motto: 'Unhurried Family Presence, Scenic Outings & Human Joy',
    iconName: 'Heart',
    colorHex: '#e11d48',
    primaryColorName: 'rose',
    classes: {
      accentText: 'text-rose-600',
      accentBg: 'bg-rose-600',
      accentBgLight: 'bg-rose-50',
      accentBorder: 'border-rose-500',
      accentBorderLight: 'border-rose-200',
      accentButton: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm',
      accentButtonGhost: 'bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200',
      badge: 'bg-rose-100 text-rose-900 border-rose-300',
      ring: 'focus:ring-rose-500',
      activeNav: 'bg-rose-50 text-rose-800 border-rose-300 font-bold',
      headerBanner: 'bg-gradient-to-r from-rose-50 via-rose-50/50 to-transparent border-rose-200',
      highlightCard: 'border-rose-300 ring-1 ring-rose-200 bg-rose-50/30',
    },
  },
};

/**
 * Gets active day index (0..6) respecting optional override or current date
 */
export const getActiveDayIndex = (state: AppState): number => {
  if (typeof state.selectedDayOverride === 'number' && state.selectedDayOverride >= 0 && state.selectedDayOverride <= 6) {
    return state.selectedDayOverride;
  }
  return new Date().getDay();
};

/**
 * Returns full DayThemeConfig for active day
 */
export const getActiveDayTheme = (state: AppState): DayThemeConfig => {
  const dayIndex = getActiveDayIndex(state);
  return DAY_THEMES[dayIndex] || DAY_THEMES[1];
};
