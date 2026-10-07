/**
 * Seed / reset Pharmacy demo login (mail + password).
 *
 * Usage:
 *   node scripts/reset-pharmacy-login.mjs
 *   node scripts/seed-pharmacy-demo.mjs
 *
 * Login:
 *   admin.pharmacy@pops.demo
 *   password from SEED_USER_PASSWORD (.env) or Owner@12345
 *   branch: PHAR-HQ
 */
await import("./reset-pharmacy-login.mjs");
