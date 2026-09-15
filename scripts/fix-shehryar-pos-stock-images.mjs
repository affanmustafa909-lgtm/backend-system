/**
 * Fix Shehryar POS: working flyer images + opening ingredient stock.
 * Railway /uploads is ephemeral (404) — point menu photos at bundled /shehryar/*.
 *
 * Usage: node scripts/fix-shehryar-pos-stock-images.mjs
 */
const API = (process.env.API_BASE || "https://backend-system-production-28a3.up.railway.app").replace(/\/$/, "");
const EMAIL = process.env.EMAIL || "Admin@shehryar.com";
const PASSWORD = process.env.PASSWORD || "Admin123@";
const BRANCH = process.env.BRANCH_CODE || "MAIN";

/** Bundled in launcher/public/shehryar — resolved by resolveMenuImageUrl */
const FLYER = "/shehryar/menu-flyer.jpg";
const SHEET = "/shehryar/daily-sheet.jpg";

const STOCK = {
  "IC-MILK": { currentStock: 80, minStock: 10, reorderLevel: 20, maxStock: 200, unitCost: 200 },
  "IC-CREAM": { currentStock: 40, minStock: 5, reorderLevel: 10, maxStock: 100, unitCost: 400 },
  "IC-SUGAR": { currentStock: 50, minStock: 5, reorderLevel: 10, maxStock: 100, unitCost: 180 },
  "IC-ICE": { currentStock: 120, minStock: 20, reorderLevel: 40, maxStock: 300, unitCost: 20 },
  "IC-DIAMOND": { currentStock: 30, minStock: 5, reorderLevel: 10, maxStock: 80, unitCost: 500 },
  "IC-CUPS": { currentStock: 500, minStock: 50, reorderLevel: 100, maxStock: 2000, unitCost: 5 },
  "IC-PETROL": { currentStock: 20, minStock: 5, reorderLevel: 8, maxStock: 100, unitCost: 280 },
  "IC-ROTI": { currentStock: 40, minStock: 10, reorderLevel: 15, maxStock: 100, unitCost: 20 },
  "IC-SOAP": { currentStock: 15, minStock: 2, reorderLevel: 5, maxStock: 50, unitCost: 150 },
  "IC-PHENYL": { currentStock: 12, minStock: 1, reorderLevel: 3, maxStock: 30, unitCost: 200 },
};

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.message ?? text.slice(0, 240)}`);
  return json;
}

async function main() {
  const login = await api("POST", "/v1/auth/login", null, { email: EMAIL, password: PASSWORD });
  const token = login.accessToken;

  const menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
  for (const cat of menu.categories ?? []) {
    const active = cat.isActive !== false;
    await api("PATCH", `/v1/menu/categories/${cat.id}`, token, {
      imageUrl: active ? FLYER : SHEET,
      ...(active ? { isActive: true } : {}),
    });
    console.log("cat image", cat.name, active ? FLYER : "(stub)");
  }
  for (const item of menu.items ?? []) {
    if (item.isActive === false) continue;
    await api("PATCH", `/v1/menu/items/${item.id}`, token, {
      imageUrl: FLYER,
      isActive: true,
      simplePrice: true,
    });
    console.log("item image", item.name, item.price);
  }

  const inv = await api("GET", `/v1/inventory?branchCode=${encodeURIComponent(BRANCH)}`, token);
  for (const ing of inv.ingredients ?? []) {
    const patch = STOCK[ing.sku];
    if (!patch) {
      // Any leftover non-IC: bump stock so alerts clear
      if (ing.currentStock <= 0) {
        await api("PATCH", `/v1/inventory/ingredients/${ing.id}`, token, {
          currentStock: 25,
          reorderLevel: Math.max(0, Math.min(ing.reorderLevel ?? 0, 10)),
        });
        console.log("stock other", ing.sku, 25);
      }
      continue;
    }
    await api("PATCH", `/v1/inventory/ingredients/${ing.id}`, token, patch);
    console.log("stock", ing.sku, patch.currentStock);
  }

  const pub = await api("GET", `/v1/menu?branchCode=${encodeURIComponent(BRANCH)}`, token);
  const inv2 = await api("GET", `/v1/inventory?branchCode=${encodeURIComponent(BRANCH)}`, token);
  console.log("\n=== OK ===");
  console.log(
    "menu:",
    (pub.categories ?? []).map((c) => c.name).join(", "),
    "·",
    (pub.items ?? []).length,
    "items",
  );
  console.log(
    "sample imageUrl:",
    pub.items?.[0]?.imageUrl,
  );
  console.log(
    "stock:",
    (inv2.ingredients ?? []).map((i) => `${i.sku}=${i.currentStock}`).join(", "),
  );
  console.log("Reload POS (hard refresh). Images load from /shehryar/menu-flyer.jpg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
