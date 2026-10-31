/**
 * Standalone compatibility fixture only.
 *
 * These values preserve the legacy standalone Execution OS demo/test routine.
 * HOS-bound kernel logic MUST NOT consume them. HumanKernelOS provides
 * protected commitments and schedule boundaries through HOSScheduleAuthority.
 */
export const STANDALONE_FAMILY_START = 960;
export const STANDALONE_FAMILY_END = 1170;
export const STANDALONE_EVENING_REVIEW_START = 1200;
export const STANDALONE_NIGHT_SHUTDOWN_START = 1320;
