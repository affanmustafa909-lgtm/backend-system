/**
 * Replace Shehryar Ice Cream demo menu + restaurant inventory with
 * real flyer menu + daily-sheet ingredients. Uploads the paper photos.
 *
 * Usage:
 *   node scripts/seed-shehryar-menu-from-flyer.mjs
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
const SHEET_IMG = join(
  ASSETS,
  "c__Users_mabdu_AppData_Roaming_Cursor_User_workspaceStorage_6f94cd44a2f814410fe8aea1adbdb36c_images_image-4e315a8c-2e8e-4a0d-a794-1d781bab14ea.jpg",
);
const MENU_IMG = join(
  ASSETS,
  "c__Users_mabdu_AppData_Roaming_Cursor_User_workspaceStorage_6f94cd44a2f814410fe8aea1adbdb36c_images_ddddddddd_copy.jpg-d38da85f-5f54-4f40-9856-f9c5090a69ea.jpg",
);

const FLAVORS = [
  { name: "Kulfa", secondaryName: "قلفہ", featured: true },
  { name: "Pista", secondaryName: "پستہ", featured: true },
  { name: "Chocolate", secondaryName: "چاکلیٹ", featured: true },
  { name: "Chaska", secondaryName: "چسکا", featured: true },
  { name: "Mango", secondaryName: "مینگو", featured: true },
  { name: "Tutti Frutti", secondaryName: "ٹوٹی فروٹی", featured: true },
  { name: "Orange", secondaryName: "اورنج فلیور", featured: true },
  { name: "Vanilla", secondaryName: "ونیلا فلیور", featured: true },
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
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${json?.message ?? text.slice(0, 240)}`);
  }
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
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`upload ${basename(filePath)} → ${res.status} ${text.slice(0, 200)}`);
  const path = json.imageUrl;
  if (!path) throw new Error("upload missing imageUrl");
  return path.startsWith("http") ? path : `${API}${path}`;
}

async function main() {
  const login = await api("POST", "/v1/auth/login", null, { email: EMAIL, password: PASSWORD });
  const token = login.accessToken;
  if (!token) throw new Error("no accessToken");
  console.log(`[shehryar] logged in · ${API} · branch ${BRANCH}`);

  console.log("[upload] menu flyer + daily sheet…");
  const menuImageUrl = await uploadImage(token, MENU_IMG);
  const sheetImageUrl = await uploadImage(token, SHEET_IMG);
  console.log("  menuImageUrl =", menuImageUrl);
  console.log("  sheetImageUrl =", sheetImageUrl);

  // ── Clear old menu ─────────────────────────────────────────────────────
  const menu = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
  for (const item of menu.items ?? []) {
    await api("DELETE", `/v1/menu/items/${item.id}`, token);
    console.log("  deleted item", item.name);
  }
  for (const cat of menu.categories ?? []) {
    await api("DELETE", `/v1/menu/categories/${cat.id}`, token);
    console.log("  deleted category", cat.name);
  }

  // ── Shahryar menu from flyer ───────────────────────────────────────────
  const MENU = [
    {
      category: "Flavors",
      sortOrder: 10,
      imageUrl: menuImageUrl,
      items: FLAVORS.map((f, i) => ({
        name: f.name,
        secondaryName: f.secondaryName,
        price: 70,
        featured: f.featured,
        sortOrder: i,
        imageUrl: menuImageUrl,
      })),
    },
    {
      category: "Cones",
      sortOrder: 20,
      imageUrl: menuImageUrl,
      items: [
        { name: "Single Cone Scoop", secondaryName: "سنگل کون", price: 80, featured: true, sortOrder: 0, imageUrl: menuImageUrl },
        { name: "Double Cone Scoop", secondaryName: "ڈبل کون", price: 150, featured: true, sortOrder: 1, imageUrl: menuImageUrl },
      ],
    },
    {
      category: "Cups",
      sortOrder: 30,
      imageUrl: menuImageUrl,
      items: [
        { name: "One Scoop", secondaryName: "ایک اسکوپ", price: 70, featured: true, sortOrder: 0, imageUrl: menuImageUrl },
        { name: "Two Scoops", secondaryName: "دو اسکوپ", price: 140, sortOrder: 1, imageUrl: menuImageUrl },
        { name: "Three Scoops", secondaryName: "تین اسکوپ", price: 210, sortOrder: 2, imageUrl: menuImageUrl },
        { name: "Four Scoops", secondaryName: "چار اسکوپ", price: 280, sortOrder: 3, imageUrl: menuImageUrl },
      ],
    },
    {
      category: "Family Packs",
      sortOrder: 40,
      imageUrl: menuImageUrl,
      items: [
        { name: "Six Scoops", secondaryName: "چھ اسکوپ", price: 420, sortOrder: 0, imageUrl: menuImageUrl },
        { name: "Eight Scoops", secondaryName: "آٹھ اسکوپ", price: 560, sortOrder: 1, imageUrl: menuImageUrl },
        { name: "Ten Scoops", secondaryName: "دس اسکوپ", price: 700, featured: true, sortOrder: 2, imageUrl: menuImageUrl },
        { name: "Twelve Scoops", secondaryName: "بارہ اسکوپ", price: 840, featured: true, sortOrder: 3, imageUrl: menuImageUrl },
      ],
    },
  ];

  for (const block of MENU) {
    const cat = await api("POST", "/v1/menu/categories", token, {
      branchCode: BRANCH,
      name: block.category,
      imageUrl: block.imageUrl,
      sortOrder: block.sortOrder,
    });
    console.log("  category", block.category);
    for (const item of block.items) {
      await api("POST", "/v1/menu/items", token, {
        branchCode: BRANCH,
        categoryId: cat.id,
        name: item.name,
        secondaryName: item.secondaryName,
        imageUrl: item.imageUrl,
        price: item.price,
        featured: item.featured ?? false,
        sortOrder: item.sortOrder ?? 0,
        simplePrice: true,
      });
      console.log("    item", item.name, item.price);
    }
  }

  // ── Clear old restaurant inventory, add ice-cream ingredients ──────────
  const inv = await api("GET", `/v1/inventory?branchCode=${encodeURIComponent(BRANCH)}`, token);
  for (const ing of inv.ingredients ?? []) {
    await api("DELETE", `/v1/inventory/ingredients/${ing.id}`, token);
    console.log("  deleted ingredient", ing.name);
  }
  for (const cat of inv.categories ?? []) {
    try {
      await api("DELETE", `/v1/inventory/categories/${cat.id}`, token);
      console.log("  deleted inv category", cat.name);
    } catch (err) {
      console.warn("  skip inv category", cat.name, String(err.message || err));
    }
  }
  for (const s of inv.suppliers ?? []) {
    try {
      await api("DELETE", `/v1/inventory/suppliers/${s.id}`, token);
      console.log("  deleted supplier", s.name);
    } catch (err) {
      console.warn("  skip supplier", s.name, String(err.message || err));
    }
  }

  const invCats = [
    { name: "Dairy", description: "دودھ / کریم — daily sheet" },
    { name: "Dry Goods", description: "چینی پاؤڈر وغیرہ" },
    { name: "Cold Store", description: "برف / آئسکریم" },
    { name: "Packaging", description: "کپ / پیکیجنگ" },
    { name: "Ops Expense", description: "روزانہ خرچ اشیاء (پیٹرول، صفائی)" },
  ];
  const catByName = {};
  for (const c of invCats) {
    const row = await api("POST", "/v1/inventory/categories", token, {
      branchCode: BRANCH,
      name: c.name,
      description: c.description,
    });
    catByName[c.name] = row.id;
    console.log("  inv category", c.name);
  }

  const ingredients = [
    { category: "Dairy", sku: "IC-MILK", name: "Daily Total Milk (ڈیلی ٹوٹل دودھ)", unit: "Liter", currentStock: 0, minStock: 10, reorderLevel: 20, maxStock: 200, unitCost: 200 },
    { category: "Dairy", sku: "IC-CREAM", name: "Daily Total Cream (ڈیلی ٹوٹل کریم)", unit: "Kg", currentStock: 0, minStock: 5, reorderLevel: 10, maxStock: 100, unitCost: 400 },
    { category: "Dry Goods", sku: "IC-SUGAR", name: "Sugar Powder (چینی پاؤڈر)", unit: "Kg", currentStock: 0, minStock: 5, reorderLevel: 10, maxStock: 100, unitCost: 180 },
    { category: "Cold Store", sku: "IC-ICE", name: "Ice (برف)", unit: "Kg", currentStock: 0, minStock: 20, reorderLevel: 40, maxStock: 300, unitCost: 20 },
    { category: "Cold Store", sku: "IC-DIAMOND", name: "Diamond Ice Cream (ڈائمنڈ آئسکریم)", unit: "Packet", currentStock: 0, minStock: 5, reorderLevel: 10, maxStock: 80, unitCost: 500 },
    { category: "Packaging", sku: "IC-CUPS", name: "Cups (کپ)", unit: "Piece", currentStock: 0, minStock: 50, reorderLevel: 100, maxStock: 2000, unitCost: 5 },
    { category: "Ops Expense", sku: "IC-PETROL", name: "Petrol (پٹرول)", unit: "Liter", currentStock: 0, minStock: 0, reorderLevel: 0, maxStock: 100, unitCost: 280 },
    { category: "Ops Expense", sku: "IC-ROTI", name: "Roti (روٹی)", unit: "Piece", currentStock: 0, minStock: 0, reorderLevel: 0, maxStock: 100, unitCost: 20 },
    { category: "Ops Expense", sku: "IC-SOAP", name: "Soap + Cloth (صابن + صافی)", unit: "Packet", currentStock: 0, minStock: 2, reorderLevel: 5, maxStock: 50, unitCost: 150 },
    { category: "Ops Expense", sku: "IC-PHENYL", name: "Phenyl + Poly + Brush (فینیل + پولی + برش)", unit: "Packet", currentStock: 0, minStock: 1, reorderLevel: 3, maxStock: 30, unitCost: 200 },
  ];

  for (const ing of ingredients) {
    await api("POST", "/v1/inventory/ingredients", token, {
      branchCode: BRANCH,
      categoryId: catByName[ing.category],
      sku: ing.sku,
      name: ing.name,
      unit: ing.unit,
      currentStock: ing.currentStock,
      minStock: ing.minStock,
      reorderLevel: ing.reorderLevel,
      maxStock: ing.maxStock,
      unitCost: ing.unitCost,
    });
    console.log("  ingredient", ing.sku, ing.name);
  }

  await api("POST", "/v1/inventory/suppliers", token, {
    branchCode: BRANCH,
    name: "Shehryar Local Supply — Toba Tek Singh",
    phone: "0346-7273552",
    address: "Toba Tek Singh",
    paymentTerms: "Cash",
    active: true,
  });

  const after = await api("GET", `/v1/menu/admin?branchCode=${encodeURIComponent(BRANCH)}`, token);
  console.log("\n=== DONE ===");
  console.log("categories:", (after.categories ?? []).map((c) => c.name).join(", "));
  console.log("items:", (after.items ?? []).length);
  console.log("sheet image (for Daily Sheet UI reference):", sheetImageUrl);
  console.log("Open Menu + Inventory + Daily Sheet in Scoops app.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
