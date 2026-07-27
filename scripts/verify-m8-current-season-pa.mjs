import { activeUtcSeason } from './provider-capability-utils.mjs';
import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';

const captureRoot = process.env.M8_VERIFY_CAPTURE_DIR?.trim();
if (!captureRoot) {
  throw new Error('Missing required environment variable: M8_VERIFY_CAPTURE_DIR');
}

const result = await verifyM8CaptureDirectory({
  captureRoot,
  expectedActiveSeason: activeUtcSeason(new Date()),
  secret: process.env.BALLDONTLIE_API_KEY?.trim() || null,
});

console.log('=== M8 CAPTURE VERIFICATION ===');
console.log('Status: VERIFIED');
console.log(`Date range: ${result.startDate} through ${result.endDate}`);
console.log(`Games verified: ${result.gameCount}`);
console.log(`Plate appearances verified: ${result.plateAppearanceCount}`);
