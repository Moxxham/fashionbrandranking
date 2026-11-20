/**
 * Roster expansion batches — same row format as scripts/roster.mjs, one file per theme.
 * Check a batch for duplicates and bad fields with `node scripts/check-roster.mjs <file>`.
 */
import b01 from './01-tailoring-cloth.mjs';

export const MORE = [...b01];
