"use strict";

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createServer, openDatabase } = require("../server");

const db = openDatabase(":memory:");
const server = createServer(db);
let baseUrl;
let adminCookie;
let cashierCookie;
let createdSale;

async function request(path, { cookie, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function login(email, password) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return result.response.headers.get("set-cookie")?.split(";")[0];
}

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminCookie = await login("admin@dvnpos.local", "DvnPos2026!");
  assert.ok(adminCookie);
  await request("/api/users", {
    cookie: adminCookie,
    method: "POST",
    body: { full_name: "Jesse Cashier", email: "jesse@shop.example", password: "secure-cashier-password", role: "Cashier" },
  });
  cashierCookie = await login("jesse@shop.example", "secure-cashier-password");
  assert.ok(cashierCookie);
});

after(() => {
  server.close();
  db.close();
});

test("requires authentication and returns an application health check", async () => {
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);

  const unauthorized = await request("/api/products");
  assert.equal(unauthorized.response.status, 401);

  const health = await request("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.status, "ok");
});

test("rejects invalid credentials without creating a session", async () => {
  const loginResult = await request("/api/auth/login", {
    method: "POST",
    body: { email: "admin@dvnpos.local", password: "not-the-password" },
  });
  assert.equal(loginResult.response.status, 401);
  assert.match(loginResult.payload.error, /incorrect/i);
});

test("seeds the expanded 20-product catalog with self-hosted working illustrations", async () => {
  const { payload, response } = await request("/api/products", { cookie: adminCookie });
  assert.equal(response.status, 200);
  const { products } = payload;
  assert.equal(products.length, 20);
  assert.equal(products.filter((product) => product.image_url.startsWith("/images/")).length, 20);

  for (const product of products) {
    const image = await fetch(`${baseUrl}${product.image_url}`);
    assert.equal(image.status, 200, `${product.name} illustration should load`);
    assert.match(image.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await image.text(), /<svg\b/);
  }
});

test("restricts product, stock, reports, refunds, and account access by role", async () => {
  const denied = await request("/api/products", {
    cookie: cashierCookie,
    method: "POST",
    body: { name: "No", sku: "NO", category: "Other", cost_price: 1, selling_price: 2, stock_quantity: 1, min_stock_level: 1 },
  });
  assert.equal(denied.response.status, 403);

  assert.equal((await request("/api/reports?from=2026-01-01&to=2026-12-31", { cookie: cashierCookie })).response.status, 403);
  assert.equal((await request("/api/users", { cookie: cashierCookie })).response.status, 403);
  assert.equal((await request("/api/stock-movements", { cookie: cashierCookie })).response.status, 403);
  assert.equal((await request("/api/activity", { cookie: cashierCookie })).response.status, 403);

  const catalog = await request("/api/products", { cookie: cashierCookie });
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.payload.products.length > 0);
});

test("creates products, validates unique SKUs, and records inventory adjustments", async () => {
  const product = {
    name: "Test Almonds",
    sku: "TEST-ALM-100",
    category: "Test goods",
    cost_price: 4000,
    selling_price: 6500,
    stock_quantity: 8,
    min_stock_level: 2,
    image_url: "/images/honey.svg",
  };
  const created = await request("/api/products", { cookie: adminCookie, method: "POST", body: product });
  assert.equal(created.response.status, 201);
  const productId = created.payload.product.id;
  assert.equal(created.payload.product.stock_quantity, 8);
  assert.equal(created.payload.product.image_url, "/images/honey.svg");

  const rejectedImage = await request(`/api/products/${productId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { image_url: "/images/../../server.js" },
  });
  assert.equal(rejectedImage.response.status, 400);

  const insecureImage = await request(`/api/products/${productId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { image_url: "http://images.example.test/picture.jpg" },
  });
  assert.equal(insecureImage.response.status, 400);

  const occupiedSku = await request(`/api/products/${productId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { sku: "DRK-001" },
  });
  assert.equal(occupiedSku.response.status, 409);

  const duplicate = await request("/api/products", { cookie: adminCookie, method: "POST", body: product });
  assert.equal(duplicate.response.status, 409);

  const updated = await request(`/api/products/${productId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { name: "Test Almonds Premium", cost_price: 4500, selling_price: 7000, min_stock_level: 3 },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.product.name, "Test Almonds Premium");
  assert.equal(updated.payload.product.cost_price, 4500);
  assert.equal(updated.payload.product.selling_price, 7000);
  assert.equal(updated.payload.product.stock_quantity, 8);
  assert.equal(updated.payload.product.min_stock_level, 3);

  const adjustment = await request(`/api/products/${productId}/stock`, {
    cookie: adminCookie,
    method: "POST",
    body: { mode: "add", quantity: 4, reason: "Test delivery" },
  });
  assert.equal(adjustment.response.status, 200);
  assert.equal(adjustment.payload.product.stock_quantity, 12);

  const oversizedCount = await request(`/api/products/${productId}/stock`, {
    cookie: adminCookie,
    method: "POST",
    body: { mode: "add", quantity: 1_000_000, reason: "Impossible stock delivery" },
  });
  assert.equal(oversizedCount.response.status, 400);

  const clearance = await request("/api/products", {
    cookie: adminCookie,
    method: "POST",
    body: {
      name: "Clearance test item",
      sku: "TEST-CLEARANCE",
      category: "Test goods",
      cost_price: 4000,
      selling_price: 2500,
      stock_quantity: 0,
      min_stock_level: 1,
      image_url: "",
    },
  });
  assert.equal(clearance.response.status, 201);
  assert.equal(clearance.payload.product.selling_price, 2500);

  const movements = await request("/api/stock-movements", { cookie: adminCookie });
  assert.ok(movements.payload.movements.some((item) => item.product_id === productId && item.reason === "Test delivery"));

  const productActivity = await request("/api/activity?type=products&search=TEST-ALM-100", { cookie: adminCookie });
  assert.equal(productActivity.response.status, 200);
  assert.ok(productActivity.payload.activity.some((entry) =>
    entry.event_type === "product.created" && entry.product_id === productId && entry.actor_name === "Store Administrator"));
  assert.ok(productActivity.payload.activity.some((entry) => entry.event_type === "product.updated"));
  const inventoryActivity = await request("/api/activity?type=inventory&search=Test%20delivery", { cookie: adminCookie });
  assert.ok(inventoryActivity.payload.activity.some((entry) =>
    entry.event_type === "inventory.addition" && entry.details.previous_quantity === 8 && entry.details.quantity_after === 12));
});

test("checkout reduces stock, creates a discounted receipt, and refunds restore stock exactly once", async () => {
  const item = (await request("/api/products", { cookie: adminCookie })).payload.products.find((p) => p.sku === "DRK-001");
  const beforeStock = item.stock_quantity;
  const saleResponse = await request("/api/sales", {
    cookie: adminCookie,
    method: "POST",
    body: { items: [{ product_id: item.id, quantity: 2 }], discount_percent: 10, payment_method: "Mobile Money" },
  });
  assert.equal(saleResponse.response.status, 201);
  createdSale = saleResponse.payload.sale;
  assert.equal(createdSale.subtotal, 36000);
  assert.equal(createdSale.discount_amount, 3600);
  assert.equal(createdSale.total, 32400);
  assert.equal(createdSale.payment_method, "Mobile Money");
  assert.equal(createdSale.items.length, 1);
  assert.equal(createdSale.items[0].quantity, 2);
  const saleActivity = await request(`/api/activity?type=sales&search=${createdSale.receipt_number}`, { cookie: adminCookie });
  assert.equal(saleActivity.response.status, 200);
  assert.equal(saleActivity.payload.activity.length, 1);
  assert.equal(saleActivity.payload.activity[0].event_type, "sale.completed");
  assert.equal(saleActivity.payload.activity[0].details.payment_method, "Mobile Money");
  assert.equal(saleActivity.payload.activity[0].details.items[0].quantity, 2);

  const afterCheckout = await request("/api/products", { cookie: adminCookie });
  assert.equal(afterCheckout.payload.products.find((p) => p.id === item.id).stock_quantity, beforeStock - 2);

  const invalidSale = await request("/api/sales", {
    cookie: adminCookie,
    method: "POST",
    body: { items: [{ product_id: item.id, quantity: 99999 }], discount_percent: 0, payment_method: "Cash" },
  });
  assert.equal(invalidSale.response.status, 409);

  const cashierSaleResponse = await request("/api/sales", {
    cookie: cashierCookie,
    method: "POST",
    body: { items: [{ product_id: item.id, quantity: 1 }], discount_percent: 0, payment_method: "Card" },
  });
  assert.equal(cashierSaleResponse.response.status, 201);
  const otherSale = cashierSaleResponse.payload.sale;

  const ownSales = await request("/api/sales", { cookie: cashierCookie });
  assert.ok(ownSales.payload.sales.length > 0);
  assert.ok(ownSales.payload.sales.every((sale) => sale.cashier_id === 2));
  assert.equal((await request(`/api/sales/${createdSale.id}`, { cookie: cashierCookie })).response.status, 403);

  const scopedDashboard = await request("/api/dashboard", { cookie: cashierCookie });
  assert.equal(scopedDashboard.payload.today.transactions, 1);
  assert.equal(scopedDashboard.payload.gross_profit, undefined);
  assert.equal(scopedDashboard.payload.low_stock_items.length, 0);

  const refund = await request(`/api/sales/${createdSale.id}/refund`, {
    cookie: cashierCookie,
    method: "POST",
    body: { reason: "Not allowed to refund" },
  });
  assert.equal(refund.response.status, 403);

  const completedRefund = await request(`/api/sales/${createdSale.id}/refund`, {
    cookie: adminCookie,
    method: "POST",
    body: { reason: "Customer returned the unopened goods" },
  });
  assert.equal(completedRefund.response.status, 200);
  assert.equal(completedRefund.payload.sale.status, "refunded");
  assert.equal(completedRefund.payload.sale.refund_reason, "Customer returned the unopened goods");
  const refundActivity = await request(`/api/activity?type=sales&search=${createdSale.receipt_number}`, { cookie: adminCookie });
  assert.deepEqual(refundActivity.payload.activity.map((entry) => entry.event_type), ["sale.refunded", "sale.completed"]);
  assert.equal(refundActivity.payload.activity[0].details.reason, "Customer returned the unopened goods");
  assert.ok(refundActivity.payload.activity.every((entry) => entry.sale_id === createdSale.id));

  const repeatedRefund = await request(`/api/sales/${createdSale.id}/refund`, {
    cookie: adminCookie,
    method: "POST",
    body: { reason: "Trying the refund twice" },
  });
  assert.equal(repeatedRefund.response.status, 409);

  const restored = await request("/api/products", { cookie: adminCookie });
  assert.equal(restored.payload.products.find((p) => p.id === item.id).stock_quantity, beforeStock - 1);

  const report = await request("/api/reports?from=2000-01-01&to=2099-12-31", { cookie: adminCookie });
  assert.equal(report.response.status, 200);
  assert.ok(report.payload.sales.some((sale) => sale.id === createdSale.id && sale.status === "refunded"));
  assert.ok(report.payload.sales.some((sale) => sale.id === otherSale.id && sale.status === "completed"));
  assert.equal(report.payload.summary.revenue, otherSale.total);
  assert.equal(report.payload.summary.gross_profit, otherSale.total - item.cost_price);

  const movements = await request("/api/stock-movements", { cookie: adminCookie });
  assert.ok(movements.payload.movements.some((entry) => entry.sale_id === createdSale.id && entry.movement_type === "refund"));
});

test("records account creation and rejects invalid activity filters", async () => {
  const teamActivity = await request("/api/activity?type=team&search=Jesse%20Cashier", { cookie: adminCookie });
  assert.equal(teamActivity.response.status, 200);
  assert.ok(teamActivity.payload.activity.some((entry) =>
    entry.event_type === "user.created" && entry.details.email === "jesse@shop.example" && !("password" in entry.details)));

  const created = await request("/api/users", {
    cookie: adminCookie,
    method: "POST",
    body: { full_name: "Audit Test Manager", email: "audit-manager@shop.example", password: "initial-manager-password", role: "Manager" },
  });
  assert.equal(created.response.status, 201);
  const managerId = created.payload.user.id;
  const managerCookie = await login("audit-manager@shop.example", "initial-manager-password");
  assert.ok(managerCookie);
  assert.equal((await request("/api/activity", { cookie: managerCookie })).response.status, 200);

  const update = await request(`/api/users/${managerId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { full_name: "Audit Manager", password: "replacement-manager-password" },
  });
  assert.equal(update.response.status, 200);
  const deactivate = await request(`/api/users/${managerId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { is_active: false },
  });
  assert.equal(deactivate.response.status, 200);
  const accountActivity = await request("/api/activity?type=team&search=Audit%20Manager", { cookie: adminCookie });
  assert.ok(accountActivity.payload.activity.some((entry) =>
    entry.event_type === "user.updated" && entry.details.changes.password_changed === true));
  assert.ok(accountActivity.payload.activity.some((entry) => entry.event_type === "user.deactivated"));

  const invalidType = await request("/api/activity?type=other", { cookie: adminCookie });
  assert.equal(invalidType.response.status, 400);
  const invalidDates = await request("/api/activity?from=2099-01-01&to=2000-01-01", { cookie: adminCookie });
  assert.equal(invalidDates.response.status, 400);
});

test("rejects out-of-range discounts, unavailable products, and invalid report dates", async () => {
  const unavailable = await request("/api/sales", {
    cookie: adminCookie,
    method: "POST",
    body: { items: [{ product_id: 999999, quantity: 1 }], discount_percent: 0, payment_method: "Cash" },
  });
  assert.equal(unavailable.response.status, 404);

  const malformed = await request("/api/sales", {
    cookie: adminCookie,
    method: "POST",
    body: { items: [{ product_id: 1, quantity: 1 }], discount_percent: 101, payment_method: "Cash" },
  });
  assert.equal(malformed.response.status, 400);

  const nullItem = await request("/api/sales", {
    cookie: adminCookie,
    method: "POST",
    body: { items: [null], discount_percent: 0, payment_method: "Cash" },
  });
  assert.equal(nullItem.response.status, 400);

  const invalidDates = await request("/api/reports?from=2099-01-01&to=2000-01-01", { cookie: adminCookie });
  assert.equal(invalidDates.response.status, 400);
});

test("rejects foreign-origin writes and clears a signed-out session cookie", async () => {
  const csrf = await request("/api/auth/logout", {
    cookie: adminCookie,
    method: "POST",
    body: {},
    headers: { Origin: "https://another-origin.example" },
  });

  assert.equal(csrf.response.status, 403);

  const logout = await request("/api/auth/logout", { cookie: adminCookie, method: "POST", body: {} });
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
});

test("upgrades an existing shop without resetting stock, prices, custom products, or later image edits", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dvn-pos-catalog-"));
  const filename = path.join(directory, "legacy.sqlite");
  let legacy;
  let migrated;
  try {
    legacy = openDatabase(filename);
    legacy.prepare(`
      UPDATE products SET image_url = '', stock_quantity = 17, selling_price = 19000, is_active = 0 WHERE sku = 'DRK-001'
    `).run();
    legacy.prepare(`
      INSERT INTO products (name, sku, category, cost_price, selling_price, stock_quantity, min_stock_level, image_url)
      VALUES ('An existing shop favorite', 'OWN-001', 'House favorites', 1200, 2600, 3, 1, '')
    `).run();

    for (const sku of ["PAN-001", "BAK-001", "PAN-002", "PAN-003", "DRK-004", "SNK-003", "HOM-003", "HOM-004", "PAN-004", "PAN-005", "HOM-005", "DAI-001"]) {
      const product = legacy.prepare("SELECT id FROM products WHERE sku = ?").get(sku);
      legacy.prepare("DELETE FROM stock_movements WHERE product_id = ?").run(product.id);
      legacy.prepare("DELETE FROM products WHERE id = ?").run(product.id);
    }
    legacy.prepare("DELETE FROM app_settings").run();
    legacy.close();
    legacy = null;

    migrated = openDatabase(filename);
    const coffee = migrated.prepare("SELECT * FROM products WHERE sku = 'DRK-001'").get();
    assert.equal(coffee.image_url, "/images/coffee.svg");
    assert.equal(coffee.stock_quantity, 17);
    assert.equal(coffee.selling_price, 19000);
    assert.equal(coffee.is_active, 0);
    assert.equal(
      migrated.prepare("SELECT stock_quantity FROM products WHERE sku = 'OWN-001'").get().stock_quantity,
      3,
    );
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM products").get().count, 21);
    const addedHoney = migrated.prepare("SELECT * FROM products WHERE sku = 'PAN-001'").get();
    assert.equal(addedHoney.stock_quantity, 15);
    assert.equal(addedHoney.image_url, "/images/honey.svg");
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ? AND movement_type = 'opening'")
        .get(addedHoney.id).count,
      1,
    );
    migrated.prepare("UPDATE products SET image_url = '' WHERE sku = 'DRK-001'").run();
    migrated.close();
    migrated = null;

    migrated = openDatabase(filename);
    assert.equal(migrated.prepare("SELECT image_url FROM products WHERE sku = 'DRK-001'").get().image_url, "");
    migrated.close();
    migrated = null;
  } finally {
    if (legacy) legacy.close();
    if (migrated) migrated.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
