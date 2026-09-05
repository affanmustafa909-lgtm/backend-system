/**
 * Seed Ice Cream menu + photos on the live restaurant org.
 * Usage: node scripts/seed-live-ice-cream-menu.mjs
 */
const API = (process.env.LIVE_API_URL ?? "https://backend-system-production-28a3.up.railway.app").replace(/\/$/, "");
const EMAIL = process.env.SEED_USER_EMAIL ?? "admin.restaurant@pops.demo";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "Owner@12345";
const BRANCH = process.env.SEED_BRANCH_CODE ?? "REST-HQ";

const MENU = [
  {
    category: "Scoops",
    sortOrder: 10,
    imageUrl: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=400&q=60",
    items: [
      { name: "Chocolate Scoop", price: 350, featured: true, imageUrl: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=400&q=60" },
      { name: "Vanilla Scoop", price: 320, imageUrl: "https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=400&q=60" },
      { name: "Strawberry Scoop", price: 340, featured: true, imageUrl: "https://images.unsplash.com/photo-1633933358116-a27b902fad35?auto=format&fit=crop&w=400&q=60" },
      { name: "Pistachio Scoop", price: 380, imageUrl: "https://images.unsplash.com/photo-1501443762994-82bd5dace89a?auto=format&fit=crop&w=400&q=60" },
    ],
  },
  {
    category: "Sundaes",
    sortOrder: 20,
    imageUrl: "https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=400&q=60",
    items: [
      { name: "Hot Fudge Sundae", price: 650, featured: true, imageUrl: "https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=400&q=60" },
      { name: "Banana Split", price: 720, imageUrl: "https://images.unsplash.com/photo-1488900128323-21503983a07e?auto=format&fit=crop&w=400&q=60" },
      { name: "Brownie Sundae", price: 690, imageUrl: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=400&q=60" },
    ],
  },
  {
    category: "Shakes",
    sortOrder: 30,
    imageUrl: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=400&q=60",
    items: [
      { name: "Chocolate Shake", price: 480, imageUrl: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=400&q=60" },
      { name: "Strawberry Shake", price: 470, featured: true, imageUrl: "https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=400&q=60" },
      { name: "Mango Shake", price: 490, imageUrl: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=400&q=60" },
    ],
  },
  {
    category: "Cones",
    sortOrder: 40,
    imageUrl: "https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?auto=format&fit=crop&w=400&q=60",
    items: [
      { name: "Vanilla Cone", price: 280, imageUrl: "https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?auto=format&fit=crop&w=400&q=60" },
      { name: "Chocolate Dip Cone", price: 320, featured: true, imageUrl: "https://images.unsplash.com/photo-1505394033641-40c6ad1178d7?auto=format&fit=crop&w=400&q=60" },
      { name: "Waffle Cone Duo", price: 420, imageUrl: "https://images.unsplash.com/photo-1488900128323-21503983a07e?auto=format&fit=crop&w=400&q=60" },
    ],
  },
  {
    category: "Cakes",
    sortOrder: 50,
    imageUrl: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=400&q=60",
    items: [
      { name: "Ice Cream Cake Slice", price: 550, imageUrl: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=400&q=60" },
      { name: "Cheesecake Cup", price: 520, imageUrl: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=400&q=60" },
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
      imageUrl: block.imageUrl,
      sortOrder: block.sortOrder,
    });
    cats.set(block.category.toLowerCase(), cat);
    console.log("category", block.category);
  } else if (!cat.imageUrl) {
    cat = await api("PATCH", `/v1/menu/categories/${cat.id}`, token, {
      imageUrl: block.imageUrl,
      isActive: true,
      sortOrder: block.sortOrder,
    });
    cats.set(block.category.toLowerCase(), cat);
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
      imageUrl: item.imageUrl,
      price: item.price,
      featured: item.featured ?? false,
      simplePrice: true,
    });
    existingItems.add(item.name.toLowerCase());
    console.log("item", item.name);
  }
}

const after = await api("GET", `/v1/menu?branchCode=${encodeURIComponent(BRANCH)}`, token);
const ice = (after.categories ?? []).filter((c) =>
  ["scoops", "sundaes", "shakes", "cones", "cakes"].includes(String(c.name).toLowerCase()),
);
console.log("ice cream categories", ice.map((c) => c.name).join(", "));
console.log("done");
