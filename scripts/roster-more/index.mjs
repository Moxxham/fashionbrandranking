/**
 * Roster expansion batches — same row format as scripts/roster.mjs, one file per theme.
 * Check a batch for duplicates and bad fields with `node scripts/check-roster.mjs <file>`.
 */
import b01 from './01-tailoring-cloth.mjs';
import b02 from './02-footwear.mjs';
import b03 from './03-outdoor-sport-work.mjs';

export const MORE = [...b01, ...b02, ...b03];
