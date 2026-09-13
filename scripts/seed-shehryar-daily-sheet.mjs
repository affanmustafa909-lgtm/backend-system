/**
 * Seed Shehryar Ice Cream daily-sheet expense lines into live accounting.
 *
 * Usage:
 *   node scripts/seed-shehryar-daily-sheet.mjs
 */
const API = process.env.API_BASE?.replace(/\/$/, "") || "https://backend-system-production-28a3.up.railway.app";
const EMAIL = process.env.EMAIL || "Admin@shehryar.com";
const PASSWORD = process.env.PASSWORD || "Admin123@";
const BRANCH = process.env.BRANCH_CODE || "MAIN";

const LINES = [
  ["نقد کریم کے پیسے", "Cash for cream", 2500],
  ["چینی پاؤڈر", "Sugar powder", 1200],
  ["برف", "Ice", 800],
  ["پیٹرول", "Petrol", 1500],
  ["روٹی", "Roti", 400],
  ["ڈیماٹ آئسکریم", "D-Mat ice cream", 3000],
  ["پرچون رعایت", "Retail discount", 500],
  ["صابن + صافی", "Soap + cloth", 350],
  ["کپ", "Cups", 2000],
  ["چیکنگ + ضائع", "Checking + waste", 300],
  ["فینیل + پٹی + برش", "Phenyl + strip + brush", 450],
];

async function main() {
  const loginRes = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`login ${loginRes.status}: ${await loginRes.text()}`);
  const tokens = await loginRes.json();
  const token = tokens.accessToken;
  const date = new Date().toISOString().slice(0, 10);

  console.log(`[shehryar] logged in · branch=${BRANCH} · date=${date}`);

  let ok = 0;
  for (const [ur, en, amount] of LINES) {
    const res = await fetch(`${API}/v1/accounting/expenses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        branchCode: BRANCH,
        category: "Other",
        amount,
        expenseDate: date,
        vendor: "Shehryar Ice Cream Daily Sheet",
        description: `${ur} (${en}) · daily sheet ${date}`,
        recurring: false,
      }),
    });
    if (!res.ok) {
      console.error(`[fail] ${ur}: ${res.status} ${await res.text()}`);
      continue;
    }
    ok += 1;
    console.log(`[ok] ${ur} = ${amount}`);
  }

  console.log(`\n=== DONE ${ok}/${LINES.length} expenses created ===`);
  console.log(`Open Ice Cream app → Daily Sheet (/pops/daily-sheet) for cups/milk/cream form.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
