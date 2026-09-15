/**
 * Seed Ice Cream menu for Shehryar (flyer prices). Prefer seed-shehryar-menu-from-flyer.mjs
 * when photos are available.
 *
 * Usage: node scripts/seed-live-ice-cream-menu.mjs
 */
const API = (process.env.LIVE_API_URL ?? "https://backend-system-production-28a3.up.railway.app").replace(/\/$/, "");
const EMAIL = process.env.SEED_USER_EMAIL ?? "Admin@shehryar.com";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "Admin123@";
const BRANCH = process.env.SEED_BRANCH_CODE ?? "MAIN";

const MENU = [
  {
    category: "Flavors",
    sortOrder: 10,
    items: [
      { name: "Kulfa", secondaryName: "قلفہ", price: 70, featured: true },
      { name: "Pista", secondaryName: "پستہ", price: 70, featured: true },
      { name: "Chocolate", secondaryName: "چاکلیٹ", price: 70, featured: true },
      { name: "Chaska", secondaryName: "چسکا", price: 70, featured: true },
      { name: "Mango", secondaryName: "مینگو", price: 70, featured: true },
      { name: "Tutti Frutti", secondaryName: "ٹوٹی فروٹی", price: 70, featured: true },
      { name: "Orange", secondaryName: "اورنج فلیور", price: 70, featured: true },
      { name: "Vanilla", secondaryName: "ونیلا فلیور", price: 70, featured: true },
    ],
  },
  {
    category: "Cones",
    sortOrder: 20,
    items: [
      { name: "Single Cone Scoop", secondaryName: "سنگل کون", price: 80, featured: true },
      { name: "Double Cone Scoop", secondaryName: "ڈبل کون", price: 150, featured: true },
    ],
  },
  {
    category: "Cups",
    sortOrder: 30,
    items: [
      { name: "One Scoop", secondaryName: "ایک اسکوپ", price: 70, featured: true },
      { name: "Two Scoops", secondaryName: "دو اسکوپ", price: 140 },
      { name: "Three Scoops", secondaryName: "تین اسکوپ", price: 210 },
      { name: "Four Scoops", secondaryName: "چار اسکوپ", price: 280 },
    ],
  },
  {
    category: "Family Packs",
    sortOrder: 40,
    items: [
      { name: "Six Scoops", secondaryName: "چھ اسکوپ", price: 420 },
      { name: "Eight Scoops", secondaryName: "آٹھ اسکوپ", price: 560 },
      { name: "Ten Scoops", secondaryName: "دس اسکوپ", price: 700, featured: true },
      { name: "Twelve Scoops", secondaryName: "بارہ اسکوپ", price: 840, featured: true },
    ],
  },
];

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${json?.message ?? text.slice(0, 200)}`);
  }
  return json;
}

const login = await api("POST", "/v1/auth/login", null, { email: EMAIL, password: PASSWORD });
const token = login.accessToken;
if (!token) throw new Error("Login did not return accessToken");

const menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
const cats = new Map((menu.categories ?? []).map((c) => [String(c.name).toLowerCase(), c]));

for (const block of MENU) {
  let cat = cats.get(block.category.toLowerCase());
  if (!cat) {
    cat = await api("POST", "/v1/menu/categories", token, {
      branchCode: BRANCH,
      name: block.category,
      sortOrder: block.sortOrder,
    });
    cats.set(block.category.toLowerCase(), cat);
    console.log("category", block.category);
  }

  const existingItems = new Set(
    (menu.items ?? [])
      .filter((i) => i.categoryId === cat.id)
      .map((i) => String(i.name).toLowerCase()),
  );

  for (const item of block.items) {
    if (existingItems.has(item.name.toLowerCase())) continue;
    await api("POST", "/v1/menu/items", token, {
      branchCode: BRANCH,
      categoryId: cat.id,
      name: item.name,
      secondaryName: item.secondaryName,
      price: item.price,
      featured: item.featured ?? false,
      simplePrice: true,
    });
    existingItems.add(item.name.toLowerCase());
    console.log("item", item.name, item.price);
  }
}

console.log("done — prefer seed-shehryar-menu-from-flyer.mjs for photo uploads");
