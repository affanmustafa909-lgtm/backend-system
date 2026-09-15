/**
 * Clean Shehryar menu/inventory after flyer seed.
 * Blocks production auto-reseed of the OLD ice-cream demo menu by keeping
 * inactive stub categories/items that match the still-deployed ICE_CREAM_MENU.
 *
 * Usage: node scripts/cleanup-shehryar-after-reseed.mjs
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const API = (process.env.API_BASE || "https://backend-system-production-28a3.up.railway.app").replace(/\/$/, "");
const EMAIL = process.env.EMAIL || "Admin@shehryar.com";
const PASSWORD = process.env.PASSWORD || "Admin123@";
const BRANCH = process.env.BRANCH_CODE || "MAIN";

const ASSETS = join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "d-My-POS-SYSTEMS-REPOS",
  "assets",
);
const MENU_IMG = join(
  ASSETS,
  "c__Users_mabdu_AppData_Roaming_Cursor_User_workspaceStorage_6f94cd44a2f814410fe8aea1adbdb36c_images_ddddddddd_copy.jpg-d38da85f-5f54-4f40-9856-f9c5090a69ea.jpg",
);

const REAL_CATS = new Set(["flavors", "cones", "cups", "family packs"]);
const REAL_ITEMS = new Set(
  [
    "Kulfa", "Pista", "Chocolate", "Chaska", "Mango", "Tutti Frutti", "Orange", "Vanilla",
    "Single Cone Scoop", "Double Cone Scoop",
    "One Scoop", "Two Scoops", "Three Scoops", "Four Scoops",
    "Six Scoops", "Eight Scoops", "Ten Scoops", "Twelve Scoops",
  ].map((s) => s.toLowerCase()),
);

/** Names still hard-coded in production seedIceCreamMenuIfMissing */
const STUB_MENU = [
  {
    category: "Scoops",
    sortOrder: 90,
    items: ["Chocolate Scoop", "Vanilla Scoop", "Strawberry Scoop", "Pistachio Scoop"],
  },
  {
    category: "Sundaes",
    sortOrder: 91,
    items: ["Hot Fudge Sundae", "Banana Split", "Brownie Sundae"],
  },
  {
    category: "Shakes",
    sortOrder: 92,
    items: ["Chocolate Shake", "Strawberry Shake", "Mango Shake"],
  },
  {
    category: "Cones",
    sortOrder: 20,
    items: ["Vanilla Cone", "Chocolate Dip Cone", "Waffle Cone Duo"],
  },
  {
    category: "Cakes",
    sortOrder: 93,
    items: ["Ice Cream Cake Slice", "Cheesecake Cup"],
  },
];

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

async function uploadImage(token, filePath) {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("image", new Blob([buf], { type: "image/jpeg" }), basename(filePath));
  const res = await fetch(`${API}/v1/menu/upload-image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`upload → ${res.status} ${text.slice(0, 200)}`);
  const path = json.imageUrl;
  return path.startsWith("http") ? path : `${API}${path}`;
}

async function main() {
  const login = await api("POST", "/v1/auth/login", null, { email: EMAIL, password: PASSWORD });
  const token = login.accessToken;
  const menuImageUrl = await uploadImage(token, MENU_IMG);
  console.log("menuImageUrl", menuImageUrl);

  let menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);

  // Soft-disable anything that is not the real Shahryar flyer menu
  for (const item of menu.items ?? []) {
    const keep = REAL_ITEMS.has(String(item.name).toLowerCase());
    if (keep) {
      if (!item.imageUrl?.includes("/uploads/menu/") || item.isActive === false) {
        await api("PATCH", `/v1/menu/items/${item.id}`, token, {
          imageUrl: menuImageUrl,
          isActive: true,
          simplePrice: true,
          featured: true,
        });
        console.log("refresh", item.name);
      }
      continue;
    }
    if (item.isActive !== false) {
      await api("PATCH", `/v1/menu/items/${item.id}`, token, { isActive: false });
      console.log("hide item", item.name);
    }
  }

  menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
  const cats = new Map((menu.categories ?? []).map((c) => [String(c.name).toLowerCase(), c]));

  for (const cat of menu.categories ?? []) {
    const real = REAL_CATS.has(String(cat.name).toLowerCase());
    if (real) {
      await api("PATCH", `/v1/menu/categories/${cat.id}`, token, {
        imageUrl: menuImageUrl,
        isActive: true,
      });
      console.log("refresh cat", cat.name);
      continue;
    }
    // Keep stub categories present but hidden so production seed won't recreate them
    await api("PATCH", `/v1/menu/categories/${cat.id}`, token, { isActive: false });
    console.log("hide cat", cat.name);
  }

  // Ensure stub categories + inactive stub items exist (block reseed)
  menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
  const cats2 = new Map((menu.categories ?? []).map((c) => [String(c.name).toLowerCase(), c]));
  const itemsByName = new Map((menu.items ?? []).map((i) => [String(i.name).toLowerCase(), i]));

  for (const block of STUB_MENU) {
    let cat = cats2.get(block.category.toLowerCase());
    if (!cat) {
      cat = await api("POST", "/v1/menu/categories", token, {
        branchCode: BRANCH,
        name: block.category,
        sortOrder: block.sortOrder,
      });
      await api("PATCH", `/v1/menu/categories/${cat.id}`, token, { isActive: false });
      cats2.set(block.category.toLowerCase(), cat);
      console.log("stub cat", block.category);
    } else if (block.category.toLowerCase() !== "cones") {
      await api("PATCH", `/v1/menu/categories/${cat.id}`, token, { isActive: false });
    }

    for (const name of block.items) {
      if (itemsByName.has(name.toLowerCase())) {
        const existing = itemsByName.get(name.toLowerCase());
        if (existing.isActive !== false) {
          await api("PATCH", `/v1/menu/items/${existing.id}`, token, { isActive: false });
        }
        continue;
      }
      const created = await api("POST", "/v1/menu/items", token, {
        branchCode: BRANCH,
        categoryId: cat.id,
        name,
        price: 999,
        simplePrice: true,
      });
      await api("PATCH", `/v1/menu/items/${created.id}`, token, { isActive: false });
      console.log("stub item", name);
    }
  }

  // Ensure missing REAL items exist
  const NEED = [
    {
      category: "Flavors",
      sortOrder: 10,
      items: [
        ["Kulfa", "قلفہ", 70],
        ["Pista", "پستہ", 70],
        ["Chocolate", "چاکلیٹ", 70],
        ["Chaska", "چسکا", 70],
        ["Mango", "مینگو", 70],
        ["Tutti Frutti", "ٹوٹی فروٹی", 70],
        ["Orange", "اورنج فلیور", 70],
        ["Vanilla", "ونیلا فلیور", 70],
      ],
    },
    {
      category: "Cones",
      sortOrder: 20,
      items: [
        ["Single Cone Scoop", "سنگل کون", 80],
        ["Double Cone Scoop", "ڈبل کون", 150],
      ],
    },
    {
      category: "Cups",
      sortOrder: 30,
      items: [
        ["One Scoop", "ایک اسکوپ", 70],
        ["Two Scoops", "دو اسکوپ", 140],
        ["Three Scoops", "تین اسکوپ", 210],
        ["Four Scoops", "چار اسکوپ", 280],
      ],
    },
    {
      category: "Family Packs",
      sortOrder: 40,
      items: [
        ["Six Scoops", "چھ اسکوپ", 420],
        ["Eight Scoops", "آٹھ اسکوپ", 560],
        ["Ten Scoops", "دس اسکوپ", 700],
        ["Twelve Scoops", "بارہ اسکوپ", 840],
      ],
    },
  ];

  menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
  const catMap = new Map((menu.categories ?? []).map((c) => [String(c.name).toLowerCase(), c]));
  const itemMap = new Map((menu.items ?? []).map((i) => [String(i.name).toLowerCase(), i]));

  for (const block of NEED) {
    let cat = catMap.get(block.category.toLowerCase());
    if (!cat) {
      cat = await api("POST", "/v1/menu/categories", token, {
        branchCode: BRANCH,
        name: block.category,
        imageUrl: menuImageUrl,
        sortOrder: block.sortOrder,
      });
      catMap.set(block.category.toLowerCase(), cat);
    } else {
      await api("PATCH", `/v1/menu/categories/${cat.id}`, token, {
        imageUrl: menuImageUrl,
        isActive: true,
        sortOrder: block.sortOrder,
      });
    }
    let sort = 0;
    for (const [name, secondaryName, price] of block.items) {
      const existing = itemMap.get(name.toLowerCase());
      if (existing) {
        await api("PATCH", `/v1/menu/items/${existing.id}`, token, {
          secondaryName,
          imageUrl: menuImageUrl,
          price,
          isActive: true,
          simplePrice: true,
          featured: true,
          sortOrder: sort++,
          categoryId: cat.id,
        });
        continue;
      }
      await api("POST", "/v1/menu/items", token, {
        branchCode: BRANCH,
        categoryId: cat.id,
        name,
        secondaryName,
        imageUrl: menuImageUrl,
        price,
        featured: true,
        sortOrder: sort++,
        simplePrice: true,
      });
      console.log("add", name, price);
    }
  }

  // Inventory: remove restaurant seed (RM-*), keep IC-*
  const inv = await api("GET", `/v1/inventory?branchCode=${encodeURIComponent(BRANCH)}`, token);
  for (const ing of inv.ingredients ?? []) {
    if (String(ing.sku).startsWith("IC-")) continue;
    await api("DELETE", `/v1/inventory/ingredients/${ing.id}`, token);
    console.log("del ing", ing.sku, ing.name);
  }
  // Re-fetch; if empty briefly avoid racing seed by creating IC first if missing
  let inv2 = await api("GET", `/v1/inventory?branchCode=${encodeURIComponent(BRANCH)}`, token);
  const haveIc = (inv2.ingredients ?? []).some((i) => String(i.sku).startsWith("IC-"));
  if (!haveIc) {
    console.log("IC ingredients missing — re-run seed-shehryar-menu-from-flyer.mjs");
  } else {
    // Delete leftover restaurant categories/suppliers
    for (const cat of inv2.categories ?? []) {
      const keep = ["Dairy", "Dry Goods", "Cold Store", "Packaging", "Ops Expense"].includes(cat.name);
      if (keep) continue;
      try {
        await api("DELETE", `/v1/inventory/categories/${cat.id}`, token);
        console.log("del cat", cat.name);
      } catch {
        /* may still have leftovers */
      }
    }
    for (const s of inv2.suppliers ?? []) {
      if (/Shehryar/i.test(s.name)) continue;
      try {
        await api("DELETE", `/v1/inventory/suppliers/${s.id}`, token);
        console.log("del supplier", s.name);
      } catch {
        /* ignore */
      }
    }
  }

  // Final public menu check (active only)
  const pub = await api("GET", `/v1/menu?branchCode=${encodeURIComponent(BRANCH)}`, token);
  console.log("\n=== PUBLIC MENU ===");
  console.log(
    "cats:",
    (pub.categories ?? []).map((c) => `${c.name}${c.isActive === false ? " (off)" : ""}`).join(", "),
  );
  console.log(
    "active items:",
    (pub.items ?? []).filter((i) => i.isActive !== false).map((i) => `${i.name}=${i.price}`).join(", "),
  );

  inv2 = await api("GET", `/v1/inventory?branchCode=${encodeURIComponent(BRANCH)}`, token);
  console.log(
    "ingredients:",
    (inv2.ingredients ?? []).map((i) => i.sku).join(", "),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
