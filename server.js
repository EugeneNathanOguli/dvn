"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.POS_DB_PATH || path.join(__dirname, "data", "pos.sqlite");
const SESSION_DAYS = 7;
const MAX_BODY_BYTES = 1_000_000;
const PAYMENT_METHODS = ["Cash", "Mobile Money", "Card", "Bank transfer"];
const ROLES = ["Administrator", "Manager", "Cashier"];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function openDatabase(filePath = DB_PATH) {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Administrator', 'Manager', 'Cashier')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
      category TEXT NOT NULL,
      cost_price INTEGER NOT NULL CHECK(cost_price >= 0),
      selling_price INTEGER NOT NULL CHECK(selling_price >= 0),
      stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
      min_stock_level INTEGER NOT NULL DEFAULT 5 CHECK(min_stock_level >= 0),
      image_url TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      cashier_id INTEGER NOT NULL REFERENCES users(id),
      subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
      discount_percent REAL NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 100),
      discount_amount INTEGER NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
      total INTEGER NOT NULL CHECK(total >= 0),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'Mobile Money', 'Card', 'Bank transfer')),
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'refunded')),
      refund_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      refunded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
      unit_cost INTEGER NOT NULL CHECK(unit_cost >= 0),
      line_total INTEGER NOT NULL CHECK(line_total >= 0)
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      quantity_change INTEGER NOT NULL,
      quantity_after INTEGER NOT NULL CHECK(quantity_after >= 0),
      movement_type TEXT NOT NULL CHECK(movement_type IN ('opening', 'addition', 'reduction', 'adjustment', 'sale', 'refund')),
      reason TEXT NOT NULL,
      sale_id INTEGER REFERENCES sales(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL CHECK(json_valid(details)),
      sale_id INTEGER REFERENCES sales(id),
      product_id INTEGER REFERENCES products(id),
      subject_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_type_created ON activity_logs(event_type, created_at);
  `);
  seedDatabase(db);
  return db;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function seedDatabase(db) {
  const users = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (users === 0) {
    const email = (process.env.POS_ADMIN_EMAIL || "admin@dvnpos.local").trim().toLowerCase();
    const password = process.env.POS_ADMIN_PASSWORD || "DvnPos2026!";
    if (process.env.NODE_ENV === "production" && !process.env.POS_ADMIN_PASSWORD) {
      throw new Error("Set POS_ADMIN_PASSWORD before starting in production.");
    }
    if (password.length < 10) {
      throw new Error("POS_ADMIN_PASSWORD must contain at least 10 characters.");
    }
    db.prepare(`
      INSERT INTO users (full_name, email, password_hash, role)
      VALUES (?, ?, ?, 'Administrator')
    `).run("Store Administrator", email, hashPassword(password));
  }
  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
  const activeAdministrator = db.prepare(`
    SELECT id FROM users WHERE role = 'Administrator' AND is_active = 1 ORDER BY id LIMIT 1
  `).get();
  const products = [
    ["Arabica Coffee 500g", "DRK-001", "Beverages", 12000, 18000, 24, 6, "/images/coffee.svg"],
    ["Black Tea 100 Bags", "DRK-002", "Beverages", 8500, 13000, 32, 8, "/images/tea.svg"],
    ["Spring Water 1.5L", "DRK-003", "Beverages", 1500, 2500, 46, 12, "/images/water.svg"],
    ["Milk Chocolate Bar", "SNK-001", "Snacks", 2500, 4000, 6, 10, "/images/chocolate.svg"],
    ["Roasted Cashews 250g", "SNK-002", "Snacks", 9000, 14000, 18, 5, "/images/nuts.svg"],
    ["Bath Soap 125g", "HOM-001", "Home & Care", 2200, 3500, 29, 8, "/images/soap.svg"],
    ["Laundry Detergent 1kg", "HOM-002", "Home & Care", 11000, 16500, 14, 5, "/images/detergent.svg"],
    ["Notebook A5", "STA-001", "Stationery", 3500, 6000, 3, 8, "/images/notebook.svg"],
    ["Wildflower Honey 350g", "PAN-001", "Pantry", 9000, 14000, 15, 4, "/images/honey.svg"],
    ["Fresh Sourdough Loaf", "BAK-001", "Bakery", 8000, 12000, 9, 4, "/images/sourdough.svg"],
    ["Long Grain Rice 2kg", "PAN-002", "Pantry", 6200, 9500, 28, 8, "/images/rice.svg"],
    ["Olive Cooking Oil 1L", "PAN-003", "Pantry", 12500, 18000, 11, 4, "/images/oil.svg"],
    ["Mango Juice 1L", "DRK-004", "Beverages", 5500, 8000, 16, 5, "/images/mango-juice.svg"],
    ["Butter Biscuits 200g", "SNK-003", "Snacks", 3500, 5500, 20, 6, "/images/biscuits.svg"],
    ["Amber Soy Candle", "HOM-003", "Home & Care", 8000, 12500, 7, 3, "/images/candle.svg"],
    ["Cotton Market Tote", "HOM-004", "Home & Care", 5000, 8500, 13, 4, "/images/tote-bag.svg"],
    ["Raw Cane Sugar 1kg", "PAN-004", "Pantry", 3500, 5500, 25, 7, "/images/sugar.svg"],
    ["Smoked Paprika 100g", "PAN-005", "Pantry", 4000, 6500, 5, 6, "/images/paprika.svg"],
    ["Botanical Shampoo 400ml", "HOM-005", "Home & Care", 8500, 13000, 12, 4, "/images/shampoo.svg"],
    ["Farmhouse Butter 250g", "DAI-001", "Dairy", 6000, 9000, 8, 4, "/images/butter.svg"],
  ];
  if (productCount === 0) {
    if (!activeAdministrator) throw new Error("Cannot seed the starter catalog without an active administrator account.");
    const insertProduct = db.prepare(`
      INSERT INTO products (name, sku, category, cost_price, selling_price, stock_quantity, min_stock_level, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, user_id, quantity_change, quantity_after, movement_type, reason)
      VALUES (?, ?, ?, ?, 'opening', 'Opening balance')
    `);
    db.exec("BEGIN");
    try {
      for (const product of products) {
        const result = insertProduct.run(...product);
        insertMovement.run(Number(result.lastInsertRowid), activeAdministrator.id, product[5], product[5]);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const migrationKey = "starter-catalog-illustrations-2026-10";
  const migration = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(migrationKey);
  if (!migration) {
    const admin = db.prepare(`
      SELECT id FROM users WHERE role = 'Administrator' AND is_active = 1 ORDER BY id LIMIT 1
    `).get();
    if (!admin) throw new Error("Cannot add starter products without an active administrator account.");

    const existing = db.prepare("SELECT 1 AS found FROM products WHERE sku = ?");
    const insertProduct = db.prepare(`
      INSERT OR IGNORE INTO products (name, sku, category, cost_price, selling_price, stock_quantity, min_stock_level, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, user_id, quantity_change, quantity_after, movement_type, reason)
      VALUES (?, ?, ?, ?, 'opening', 'Opening starter-catalog stock')
    `);
    const attachStarterImage = db.prepare(`
      UPDATE products SET image_url = ?
      WHERE sku = ? AND name = ? AND (image_url = '' OR image_url IS NULL)
    `);
    db.exec("BEGIN");
    try {
      for (const product of products) {
        const prior = existing.get(product[1]);
        if (!prior) {
          const inserted = insertProduct.run(...product);
          if (Number(inserted.changes) === 1 && product[5] > 0) {
            insertMovement.run(Number(inserted.lastInsertRowid), admin.id, product[5], product[5]);
          }
        } else {
          attachStarterImage.run(product[7], product[1], product[0]);
        }
      }
      db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(migrationKey, "complete");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part.trim(), ""];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (size === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(Object.assign(new Error("Request body must be a JSON object."), { status: 400 }));
          return;
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function requireText(value, field, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw Object.assign(new Error(`${field} is required and must be at most ${max} characters.`), { status: 400 });
  }
  return value.trim();
}

function requireInteger(value, field, { min = 0, max = 1_000_000 } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw Object.assign(new Error(`${field} must be a whole number between ${min} and ${max}.`), { status: 400 });
  }
  return value;
}

function requirePrice(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) {
    throw Object.assign(new Error(`${field} must be a non-negative whole amount in UGX.`), { status: 400 });
  }
  return value;
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) {
    throw Object.assign(new Error("You do not have permission to perform this action."), { status: 403 });
  }
}

function cleanUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    is_active: Boolean(user.is_active),
  };
}

function cleanProduct(product) {
  return {
    ...product,
    is_active: Boolean(product.is_active),
  };
}

function parseActivity(row) {
  return { ...row, details: JSON.parse(row.details) };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function logActivity(db, { actorId, type, summary, details = {}, saleId = null, productId = null, subjectUserId = null }) {
  db.prepare(`
    INSERT INTO activity_logs (actor_id, event_type, summary, details, sale_id, product_id, subject_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actorId, type, summary, JSON.stringify(details), saleId, productId, subjectUserId);
}

function clampDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error(`${field} must be a valid date in YYYY-MM-DD format.`), { status: 400 });
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error(`${field} must be a valid date in YYYY-MM-DD format.`), { status: 400 });
  }
  return value;
}

function serveStatic(response, pathname) {
  let relative;
  try {
    relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).slice(1);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Malformed URL path.");
    return;
  }
  const root = path.resolve(__dirname, "public");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filename, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.code === "ENOENT" ? "Not found" : "Unable to read the requested file.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filename)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  });
}

function createServer(db = openDatabase()) {
  const loginAttempts = new Map();

  async function handle(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    if (pathname === "/health" && request.method === "GET") {
      return json(response, 200, { status: "ok" });
    }
    if (!pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json(response, 405, { error: "Method not allowed." });
      }
      if (request.method === "HEAD") {
        response.writeHead(200);
        return response.end();
      }
      return serveStatic(response, pathname);
    }

    try {
      const mutating = !["GET", "HEAD"].includes(request.method);
      if (mutating && request.headers.origin) {
        let origin;
        try {
          origin = new URL(request.headers.origin);
        } catch {
          throw Object.assign(new Error("Cross-origin request rejected."), { status: 403 });
        }
        const expectedHost = request.headers["x-forwarded-host"] || request.headers.host;
        if (origin.host !== expectedHost) {
          throw Object.assign(new Error("Cross-origin request rejected."), { status: 403 });
        }
      }

      let body = {};
      if (mutating) {
        const contentType = request.headers["content-type"] || "";
        if (!contentType.toLowerCase().startsWith("application/json")) {
          throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
        }
        body = await readBody(request);
      }

      if (pathname === "/api/auth/login" && request.method === "POST") {
        const email = requireText(body.email, "Email", 254).toLowerCase();
        const password = requireText(body.password, "Password", 256);
        const windowStart = Date.now() - 60_000;
        const attempts = (loginAttempts.get(request.socket.remoteAddress) || []).filter((time) => time > windowStart);
        if (attempts.length >= 12) {
          throw Object.assign(new Error("Too many sign-in attempts. Try again in a minute."), { status: 429 });
        }
        attempts.push(Date.now());
        loginAttempts.set(request.socket.remoteAddress, attempts);
        const user = db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);
        if (!user || !verifyPassword(password, user.password_hash)) {
          throw Object.assign(new Error("Email or password is incorrect."), { status: 401 });
        }
        loginAttempts.delete(request.socket.remoteAddress);
        const token = crypto.randomBytes(32).toString("hex");
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
        db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
          crypto.createHash("sha256").update(token).digest("hex"),
          user.id,
          Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
        );
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        return json(response, 200, { user: cleanUser(user) }, {
          "Set-Cookie": `dvn_pos_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`,
        });
      }

      const cookie = parseCookies(request.headers.cookie).dvn_pos_session;
      const tokenHash = cookie ? crypto.createHash("sha256").update(cookie).digest("hex") : "";
      const session = tokenHash
        ? db.prepare(`
            SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
          `).get(tokenHash, Date.now())
        : null;

      if (pathname === "/api/auth/logout" && request.method === "POST") {
        if (tokenHash) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
        return json(response, 200, { success: true }, {
          "Set-Cookie": "dvn_pos_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        });
      }
      if (pathname === "/api/session" && request.method === "GET") {
        if (!session) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
        return json(response, 200, { user: cleanUser(session) });
      }
      if (!session) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });

      if (pathname === "/api/meta" && request.method === "GET") {
        const categories = db.prepare("SELECT DISTINCT category FROM products ORDER BY category").all().map((row) => row.category);
        const cashiers = session.role === "Cashier"
          ? []
          : db.prepare("SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name").all();
        return json(response, 200, { categories, payment_methods: PAYMENT_METHODS, users: cashiers });
      }

      if (pathname === "/api/dashboard" && request.method === "GET") {
        const today = new Date().toISOString().slice(0, 10);
        const scopedSales = session.role === "Cashier" ? " AND cashier_id = ?" : "";
        const scopedParameters = session.role === "Cashier" ? [session.id] : [];
        const todayStats = db.prepare(`
          SELECT COUNT(*) AS transactions, COALESCE(SUM(total), 0) AS total
          FROM sales WHERE status = 'completed' AND date(created_at) = ?${scopedSales}
        `).get(today, ...scopedParameters);
        const periods = db.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-6 days') THEN total ELSE 0 END), 0) AS week,
            COALESCE(SUM(CASE WHEN substr(created_at, 1, 7) = strftime('%Y-%m', 'now') THEN total ELSE 0 END), 0) AS month,
            COALESCE(SUM(total), 0) AS lifetime,
            COALESCE(SUM(total - discount_amount), 0) AS before_discount
          FROM sales WHERE status = 'completed'${scopedSales}
        `).get(...scopedParameters);
        const inventory = db.prepare(`
          SELECT COUNT(*) AS products,
            COALESCE(SUM(CASE WHEN stock_quantity <= min_stock_level THEN 1 ELSE 0 END), 0) AS low_stock,
            COALESCE(SUM(stock_quantity * cost_price), 0) AS inventory_value
          FROM products WHERE is_active = 1
        `).get();
        const profit = db.prepare(`
          SELECT COALESCE(SUM(s.total - (
            SELECT COALESCE(SUM(si.quantity * si.unit_cost), 0)
            FROM sale_items si WHERE si.sale_id = s.id
          )), 0) AS gross_profit
          FROM sales s
          WHERE s.status = 'completed'${session.role === "Cashier" ? " AND s.cashier_id = ?" : ""}
        `).get(...scopedParameters);
        const bestSeller = db.prepare(`
          SELECT si.product_name AS name, SUM(si.quantity) AS quantity
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.status = 'completed'${session.role === "Cashier" ? " AND s.cashier_id = ?" : ""}
          GROUP BY si.product_name ORDER BY quantity DESC, name LIMIT 1
        `).get(...scopedParameters);
        const paymentMethods = db.prepare(`
          SELECT payment_method AS method, COUNT(*) AS transactions, SUM(total) AS total
          FROM sales WHERE status = 'completed' AND date(created_at) = ?${scopedSales}
          GROUP BY payment_method ORDER BY total DESC
        `).all(today, ...scopedParameters);
        const chart = db.prepare(`
          SELECT date(created_at) AS day, SUM(total) AS total
          FROM sales WHERE status = 'completed' AND created_at >= datetime('now', '-6 days')${scopedSales}
          GROUP BY date(created_at) ORDER BY day
        `).all(...scopedParameters);
        const recentSales = db.prepare(`
          SELECT s.id, s.receipt_number, s.total, s.payment_method, s.status, s.created_at,
                 u.full_name AS cashier_name,
                 (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
          FROM sales s JOIN users u ON u.id = s.cashier_id
          ${session.role === "Cashier" ? "WHERE s.cashier_id = ?" : ""}
          ORDER BY s.id DESC LIMIT 6
        `).all(...scopedParameters);
        const lowStockItems = db.prepare(`
          SELECT id, name, sku, stock_quantity, min_stock_level, category
          FROM products WHERE is_active = 1 AND stock_quantity <= min_stock_level
          ORDER BY stock_quantity, name LIMIT 8
        `).all();
        const recentActivity = session.role === "Cashier" ? [] : db.prepare(`
          SELECT a.id, a.event_type, a.summary, a.details, a.sale_id, a.product_id,
            a.subject_user_id, a.created_at, u.full_name AS actor_name
          FROM activity_logs a JOIN users u ON u.id = a.actor_id
          ORDER BY a.id DESC LIMIT 8
        `).all().map(parseActivity);
        return json(response, 200, {
          today: todayStats,
          week: periods.week,
          month: periods.month,
          lifetime: periods.lifetime,
          products: inventory.products,
          low_stock: session.role === "Cashier" ? undefined : inventory.low_stock,
          inventory_value: session.role === "Cashier" ? undefined : inventory.inventory_value,
          gross_profit: session.role === "Cashier" ? undefined : profit.gross_profit,
          best_seller: bestSeller || null,
          payment_methods: paymentMethods,
          chart,
          recent_sales: recentSales,
          low_stock_items: session.role === "Cashier" ? [] : lowStockItems,
          recent_activity: recentActivity,
        });
      }

      if (pathname === "/api/activity" && request.method === "GET") {
        requireRole(session, ["Administrator", "Manager"]);
        const fromValue = requestUrl.searchParams.get("from");
        const toValue = requestUrl.searchParams.get("to");
        const type = requestUrl.searchParams.get("type") || "";
        const search = (requestUrl.searchParams.get("search") || "").trim();
        const conditions = ["1 = 1"];
        const parameters = [];
        if (fromValue) {
          conditions.push("date(a.created_at) >= ?");
          parameters.push(clampDate(fromValue, "Start date"));
        }
        if (toValue) {
          conditions.push("date(a.created_at) <= ?");
          parameters.push(clampDate(toValue, "End date"));
        }
        if (fromValue && toValue && fromValue > toValue) {
          throw Object.assign(new Error("Start date must not be after end date."), { status: 400 });
        }
        if (type) {
          if (!["sales", "inventory", "products", "team"].includes(type)) {
            throw Object.assign(new Error("Select a valid activity category."), { status: 400 });
          }
          conditions.push("a.event_type LIKE ?");
          parameters.push(`${type === "sales" ? "sale" : type === "inventory" ? "inventory" : type === "products" ? "product" : "user"}.%`);
        }
        if (search) {
          conditions.push("(a.summary LIKE ? OR u.full_name LIKE ? OR a.event_type LIKE ? OR a.details LIKE ?)");
          parameters.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        const rows = db.prepare(`
          SELECT a.id, a.actor_id, a.event_type, a.summary, a.details, a.sale_id,
            a.product_id, a.subject_user_id, a.created_at, u.full_name AS actor_name
          FROM activity_logs a JOIN users u ON u.id = a.actor_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY a.id DESC LIMIT 500
        `).all(...parameters).map(parseActivity);
        return json(response, 200, { activity: rows });
      }

      if (pathname === "/api/products" && request.method === "GET") {
        const search = (requestUrl.searchParams.get("search") || "").trim();
        const activeOnly = requestUrl.searchParams.get("active") !== "all";
        const result = db.prepare(`
          SELECT * FROM products
          WHERE (? = 0 OR is_active = 1)
            AND (? = '' OR name LIKE '%' || ? || '%' OR sku LIKE '%' || ? || '%' OR category LIKE '%' || ? || '%')
          ORDER BY name
        `).all(activeOnly ? 1 : 0, search, search, search, search);
        return json(response, 200, { products: result.map(cleanProduct) });
      }
      if (pathname === "/api/products" && request.method === "POST") {
        requireRole(session, ["Administrator", "Manager"]);
        const product = validateProduct(body);
        db.exec("BEGIN");
        try {
          const result = db.prepare(`
            INSERT INTO products (name, sku, category, cost_price, selling_price, stock_quantity, min_stock_level, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(...product);
          const id = Number(result.lastInsertRowid);
          if (product[5] > 0) {
            db.prepare(`
              INSERT INTO stock_movements (product_id, user_id, quantity_change, quantity_after, movement_type, reason)
              VALUES (?, ?, ?, ?, 'opening', 'Opening stock')
            `).run(id, session.id, product[5], product[5]);
          }
          logActivity(db, {
            actorId: session.id,
            type: "product.created",
            summary: `Added ${product[0]} (${product[1]}) to the catalog.`,
            productId: id,
            details: {
              sku: product[1],
              category: product[2],
              cost_price: product[3],
              selling_price: product[4],
              opening_stock: product[5],
              min_stock_level: product[6],
            },
          });
          db.exec("COMMIT");
          return json(response, 201, { product: cleanProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)) });
        } catch (error) {
          db.exec("ROLLBACK");
          if (error.errcode === 2067) {
            throw Object.assign(new Error("A product with that SKU already exists."), { status: 409 });
          }
          throw error;
        }
      }

      const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
      if (productMatch && request.method === "PATCH") {
        requireRole(session, ["Administrator", "Manager"]);
        const id = Number(productMatch[1]);
        const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
        if (!existing) throw Object.assign(new Error("Product not found."), { status: 404 });
        if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
          throw Object.assign(new Error("Product status must be active or archived."), { status: 400 });
        }
        const updates = validateProduct({ ...existing, ...body, stock_quantity: existing.stock_quantity });
        const nextActive = body.is_active === false ? 0 : body.is_active === true ? 1 : existing.is_active;
        const updatesProduct = updates[0] !== existing.name
          || updates[1] !== existing.sku
          || updates[2] !== existing.category
          || updates[3] !== existing.cost_price
          || updates[4] !== existing.selling_price
          || updates[6] !== existing.min_stock_level
          || updates[7] !== existing.image_url;
        const statusChanged = nextActive !== existing.is_active;
        if (!updatesProduct && !statusChanged) {
          return json(response, 200, { product: cleanProduct(existing) });
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(`
            UPDATE products SET name = ?, sku = ?, category = ?, cost_price = ?, selling_price = ?,
              min_stock_level = ?, image_url = ?, is_active = ? WHERE id = ?
          `).run(
            updates[0], updates[1], updates[2], updates[3], updates[4], updates[6], updates[7],
            nextActive, id,
          );
          const eventType = statusChanged
            ? nextActive ? "product.restored" : "product.archived"
            : "product.updated";
          const action = statusChanged ? (nextActive ? "Restored" : "Archived") : "Updated";
          logActivity(db, {
            actorId: session.id,
            type: eventType,
            summary: `${action} ${updates[0]} (${updates[1]}).`,
            productId: id,
            details: {
              changes: {
                ...(updates[0] !== existing.name ? { name: { from: existing.name, to: updates[0] } } : {}),
                ...(updates[1] !== existing.sku ? { sku: { from: existing.sku, to: updates[1] } } : {}),
                ...(updates[2] !== existing.category ? { category: { from: existing.category, to: updates[2] } } : {}),
                ...(updates[3] !== existing.cost_price ? { cost_price: { from: existing.cost_price, to: updates[3] } } : {}),
                ...(updates[4] !== existing.selling_price ? { selling_price: { from: existing.selling_price, to: updates[4] } } : {}),
                ...(updates[6] !== existing.min_stock_level ? { min_stock_level: { from: existing.min_stock_level, to: updates[6] } } : {}),
                ...(updates[7] !== existing.image_url ? { image_updated: true } : {}),
                ...(statusChanged ? { active: { from: Boolean(existing.is_active), to: Boolean(nextActive) } } : {}),
              },
            },
          });
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          if (error.errcode === 2067) {
            throw Object.assign(new Error("A product with that SKU already exists."), { status: 409 });
          }
          throw error;
        }
        return json(response, 200, { product: cleanProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)) });
      }

      const stockMatch = pathname.match(/^\/api\/products\/(\d+)\/stock$/);
      if (stockMatch && request.method === "POST") {
        requireRole(session, ["Administrator", "Manager"]);
        const id = Number(stockMatch[1]);
        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
        if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });
        const mode = body.mode;
        if (!["add", "remove", "set"].includes(mode)) {
          throw Object.assign(new Error("Stock mode must be add, remove, or set."), { status: 400 });
        }
        const quantity = requireInteger(body.quantity, "Quantity", { min: mode === "set" ? 0 : 1 });
        const reason = requireText(body.reason, "Reason", 200);
        const change = mode === "add" ? quantity : mode === "remove" ? -quantity : quantity - product.stock_quantity;
        const after = product.stock_quantity + change;
        if (after < 0) throw Object.assign(new Error("Stock cannot be reduced below zero."), { status: 409 });
        if (after > 1_000_000) throw Object.assign(new Error("Stock cannot exceed 1,000,000 units."), { status: 400 });
        if (change === 0) throw Object.assign(new Error("The stock adjustment does not change the quantity."), { status: 400 });
        db.exec("BEGIN");
        try {
          db.prepare("UPDATE products SET stock_quantity = ? WHERE id = ?").run(after, id);
          const type = mode === "add" ? "addition" : mode === "remove" ? "reduction" : "adjustment";
          db.prepare(`
            INSERT INTO stock_movements (product_id, user_id, quantity_change, quantity_after, movement_type, reason)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(id, session.id, change, after, type, reason);
          logActivity(db, {
            actorId: session.id,
            type: `inventory.${type}`,
            summary: `${capitalize(type)} ${Math.abs(change)} ${Math.abs(change) === 1 ? "unit" : "units"} of ${product.name}; ${product.stock_quantity} → ${after}.`,
            productId: id,
            details: {
              sku: product.sku,
              change,
              previous_quantity: product.stock_quantity,
              quantity_after: after,
              reason,
            },
          });
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return json(response, 200, { product: cleanProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)) });
      }

      if (pathname === "/api/stock-movements" && request.method === "GET") {
        requireRole(session, ["Administrator", "Manager"]);
        const rows = db.prepare(`
          SELECT m.id, m.product_id, p.name AS product_name, p.sku, m.quantity_change,
            m.quantity_after, m.movement_type, m.reason, m.created_at, u.full_name AS user_name,
            m.sale_id
          FROM stock_movements m
          JOIN products p ON p.id = m.product_id
          JOIN users u ON u.id = m.user_id
          ORDER BY m.id DESC LIMIT 300
        `).all();
        return json(response, 200, { movements: rows });
      }

      if (pathname === "/api/sales" && request.method === "GET") {
        const conditions = ["1 = 1"];
        const parameters = [];
        if (session.role === "Cashier") {
          conditions.push("s.cashier_id = ?");
          parameters.push(session.id);
        }
        const from = requestUrl.searchParams.get("from");
        const to = requestUrl.searchParams.get("to");
        const cashierId = requestUrl.searchParams.get("cashier");
        const paymentMethod = requestUrl.searchParams.get("payment");
        const search = (requestUrl.searchParams.get("search") || "").trim();
        if (from) {
          conditions.push("date(s.created_at) >= ?");
          parameters.push(clampDate(from, "Start date"));
        }
        if (to) {
          conditions.push("date(s.created_at) <= ?");
          parameters.push(clampDate(to, "End date"));
        }
        if (cashierId && session.role !== "Cashier") {
          conditions.push("s.cashier_id = ?");
          parameters.push(requireInteger(Number(cashierId), "Cashier", { min: 1 }));
        }
        if (paymentMethod) {
          if (!PAYMENT_METHODS.includes(paymentMethod)) throw Object.assign(new Error("Unknown payment method."), { status: 400 });
          conditions.push("s.payment_method = ?");
          parameters.push(paymentMethod);
        }
        if (search) {
          conditions.push("(s.receipt_number LIKE ? OR u.full_name LIKE ?)");
          parameters.push(`%${search}%`, `%${search}%`);
        }
        const sales = db.prepare(`
          SELECT s.id, s.receipt_number, s.cashier_id, s.subtotal, s.discount_percent, s.discount_amount,
            s.total, s.payment_method, s.status, s.created_at, s.refund_reason, u.full_name AS cashier_name,
            (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
          FROM sales s JOIN users u ON u.id = s.cashier_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY s.id DESC LIMIT 500
        `).all(...parameters);
        return json(response, 200, { sales });
      }

      if (pathname === "/api/sales" && request.method === "POST") {
        if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
          throw Object.assign(new Error("A sale must contain between 1 and 100 distinct products."), { status: 400 });
        }
        if (!PAYMENT_METHODS.includes(body.payment_method)) {
          throw Object.assign(new Error("Select a valid payment method."), { status: 400 });
        }
        const discountPercent = body.discount_percent;
        if (typeof discountPercent !== "number" || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
          throw Object.assign(new Error("Discount must be between 0% and 100%."), { status: 400 });
        }
        const quantities = new Map();
        for (const item of body.items) {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw Object.assign(new Error("Each sale item must specify a product and quantity."), { status: 400 });
          }
          const productId = requireInteger(item.product_id, "Product", { min: 1 });
          const quantity = requireInteger(item.quantity, "Quantity", { min: 1 });
          quantities.set(productId, (quantities.get(productId) || 0) + quantity);
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          const cart = [...quantities].map(([id, quantity]) => {
            const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(id);
            if (!product) throw Object.assign(new Error("One of the selected products is unavailable."), { status: 404 });
            if (product.stock_quantity < quantity) {
              throw Object.assign(new Error(`Not enough stock for ${product.name}. Only ${product.stock_quantity} remain.`), { status: 409 });
            }
            return { product, quantity };
          });
          const subtotal = cart.reduce((sum, item) => sum + item.product.selling_price * item.quantity, 0);
          if (!Number.isSafeInteger(subtotal)) {
            throw Object.assign(new Error("Sale total is too large. Split the sale into smaller transactions."), { status: 400 });
          }
          const discountAmount = Math.round(subtotal * discountPercent / 100);
          const total = subtotal - discountAmount;
          const receiptNumber = `DVN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
          const saleResult = db.prepare(`
            INSERT INTO sales (receipt_number, cashier_id, subtotal, discount_percent, discount_amount, total, payment_method)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(receiptNumber, session.id, subtotal, discountPercent, discountAmount, total, body.payment_method);
          const saleId = Number(saleResult.lastInsertRowid);
          const insertItem = db.prepare(`
            INSERT INTO sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const reduceStock = db.prepare("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?");
          const insertMovement = db.prepare(`
            INSERT INTO stock_movements (product_id, user_id, quantity_change, quantity_after, movement_type, reason, sale_id)
            VALUES (?, ?, ?, ?, 'sale', ?, ?)
          `);
          for (const { product, quantity } of cart) {
            insertItem.run(saleId, product.id, product.name, product.sku, quantity, product.selling_price, product.cost_price, product.selling_price * quantity);
            const update = reduceStock.run(quantity, product.id, quantity);
            if (Number(update.changes) !== 1) throw Object.assign(new Error(`Stock changed while checking out ${product.name}. Please try again.`), { status: 409 });
            insertMovement.run(product.id, session.id, -quantity, product.stock_quantity - quantity, `Sale ${receiptNumber}`, saleId);
          }
          logActivity(db, {
            actorId: session.id,
            type: "sale.completed",
            summary: `Completed sale ${receiptNumber} for ${total} UGX.`,
            saleId,
            details: {
              receipt_number: receiptNumber,
              total,
              subtotal,
              discount_percent: discountPercent,
              discount_amount: discountAmount,
              payment_method: body.payment_method,
              items: cart.map(({ product, quantity }) => ({
                product_id: product.id, name: product.name, sku: product.sku, quantity,
              })),
            },
          });
          db.exec("COMMIT");
          return json(response, 201, { sale: getSale(db, saleId) });
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      const saleMatch = pathname.match(/^\/api\/sales\/(\d+)$/);
      if (saleMatch && request.method === "GET") {
        const sale = getSale(db, Number(saleMatch[1]));
        if (!sale) throw Object.assign(new Error("Sale not found."), { status: 404 });
        if (session.role === "Cashier" && sale.cashier_id !== session.id) {
          throw Object.assign(new Error("You can only view your own receipts."), { status: 403 });
        }
        return json(response, 200, { sale });
      }

      const refundMatch = pathname.match(/^\/api\/sales\/(\d+)\/refund$/);
      if (refundMatch && request.method === "POST") {
        requireRole(session, ["Administrator", "Manager"]);
        const saleId = Number(refundMatch[1]);
        const reason = requireText(body.reason, "Refund reason", 200);
        db.exec("BEGIN IMMEDIATE");
        try {
          const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId);
          if (!sale) throw Object.assign(new Error("Sale not found."), { status: 404 });
          if (sale.status !== "completed") throw Object.assign(new Error("This sale has already been refunded."), { status: 409 });
          const items = db.prepare("SELECT * FROM sale_items WHERE sale_id = ?").all(saleId);
          for (const item of items) {
            if (item.product_id === null) continue;
            const product = db.prepare("SELECT stock_quantity FROM products WHERE id = ?").get(item.product_id);
            if (!product) continue;
            const quantityAfter = product.stock_quantity + item.quantity;
            db.prepare("UPDATE products SET stock_quantity = ? WHERE id = ?").run(quantityAfter, item.product_id);
            db.prepare(`
              INSERT INTO stock_movements (product_id, user_id, quantity_change, quantity_after, movement_type, reason, sale_id)
              VALUES (?, ?, ?, ?, 'refund', ?, ?)
            `).run(item.product_id, session.id, item.quantity, quantityAfter, `Refund ${sale.receipt_number}: ${reason}`, saleId);
          }
          db.prepare(`
            UPDATE sales SET status = 'refunded', refund_reason = ?,
              refunded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
          `).run(reason, saleId);
          logActivity(db, {
            actorId: session.id,
            type: "sale.refunded",
            summary: `Refunded sale ${sale.receipt_number} for ${sale.total} UGX.`,
            saleId,
            details: {
              receipt_number: sale.receipt_number,
              total: sale.total,
              reason,
              restocked_items: items.map((item) => ({
                product_id: item.product_id, name: item.product_name, sku: item.sku, quantity: item.quantity,
              })),
            },
          });
          db.exec("COMMIT");
          return json(response, 200, { sale: getSale(db, saleId) });
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      if (pathname === "/api/reports" && request.method === "GET") {
        requireRole(session, ["Administrator", "Manager"]);
        const from = clampDate(requestUrl.searchParams.get("from"), "Start date");
        const to = clampDate(requestUrl.searchParams.get("to"), "End date");
        if (from > to) throw Object.assign(new Error("Start date must not be after end date."), { status: 400 });
        const sales = db.prepare(`
          SELECT s.id, s.receipt_number, s.created_at, s.total, s.subtotal, s.discount_amount,
            s.payment_method, s.status, u.full_name AS cashier_name
          FROM sales s JOIN users u ON u.id = s.cashier_id
          WHERE date(s.created_at) BETWEEN ? AND ?
          ORDER BY s.created_at DESC
        `).all(from, to);
        const summary = db.prepare(`
          SELECT COUNT(*) AS transactions,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_amount ELSE 0 END), 0) AS discounts
          FROM sales WHERE date(created_at) BETWEEN ? AND ?
        `).get(from, to);
        const grossProfit = db.prepare(`
          SELECT COALESCE(SUM(s.total - (
            SELECT COALESCE(SUM(si.quantity * si.unit_cost), 0)
            FROM sale_items si WHERE si.sale_id = s.id
          )), 0) AS total
          FROM sales s
          WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
        `).get(from, to).total;
        const products = db.prepare(`
          SELECT si.product_name AS name, si.sku, SUM(si.quantity) AS quantity,
            SUM(si.line_total) AS revenue
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
          GROUP BY si.product_name, si.sku ORDER BY quantity DESC, revenue DESC LIMIT 100
        `).all(from, to);
        const cashiers = db.prepare(`
          SELECT u.full_name AS name, COUNT(s.id) AS transactions,
            COALESCE(SUM(s.total), 0) AS revenue
          FROM sales s JOIN users u ON u.id = s.cashier_id
          WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
          GROUP BY u.id ORDER BY revenue DESC
        `).all(from, to);
        const payments = db.prepare(`
          SELECT payment_method AS method, COUNT(*) AS transactions, SUM(total) AS revenue
          FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?
          GROUP BY payment_method ORDER BY revenue DESC
        `).all(from, to);
        const inventory = db.prepare(`
          SELECT id, name, sku, category, stock_quantity, min_stock_level,
            cost_price, selling_price, stock_quantity * cost_price AS inventory_value
          FROM products WHERE is_active = 1 ORDER BY name
        `).all();
        return json(response, 200, {
          from,
          to,
          summary: { ...summary, gross_profit: grossProfit },
          sales,
          products,
          cashiers,
          payments,
          inventory,
        });
      }

      if (pathname === "/api/inventory-report" && request.method === "GET") {
        requireRole(session, ["Administrator", "Manager"]);
        const inventory = db.prepare(`
          SELECT id, name, sku, category, stock_quantity, min_stock_level,
            cost_price, selling_price, stock_quantity * cost_price AS inventory_value
          FROM products WHERE is_active = 1 ORDER BY name
        `).all();
        return json(response, 200, { inventory });
      }

      if (pathname === "/api/users" && request.method === "GET") {
        requireRole(session, ["Administrator"]);
        const users = db.prepare("SELECT * FROM users ORDER BY full_name").all();
        return json(response, 200, { users: users.map(cleanUser) });
      }
      if (pathname === "/api/users" && request.method === "POST") {
        requireRole(session, ["Administrator"]);
        const fullName = requireText(body.full_name, "Full name");
        const email = requireText(body.email, "Email", 254).toLowerCase();
        const password = requireText(body.password, "Password", 256);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
        }
        if (password.length < 10) throw Object.assign(new Error("Password must contain at least 10 characters."), { status: 400 });
        if (!ROLES.includes(body.role)) throw Object.assign(new Error("Select a valid role."), { status: 400 });
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = db.prepare(`
            INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)
          `).run(fullName, email, hashPassword(password), body.role);
          const id = Number(result.lastInsertRowid);
          logActivity(db, {
            actorId: session.id,
            type: "user.created",
            summary: `Created ${body.role} account for ${fullName}.`,
            subjectUserId: id,
            details: { full_name: fullName, email, role: body.role },
          });
          db.exec("COMMIT");
          return json(response, 201, { user: cleanUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)) });
        } catch (error) {
          db.exec("ROLLBACK");
          if (error.errcode === 2067) {
            throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
          }
          throw error;
        }
      }
      const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
      if (userMatch && request.method === "PATCH") {
        requireRole(session, ["Administrator"]);
        const id = Number(userMatch[1]);
        const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
        if (!target) throw Object.assign(new Error("User not found."), { status: 404 });
        if (id === session.id && body.is_active === false) {
          throw Object.assign(new Error("You cannot deactivate your own account."), { status: 400 });
        }
        const fullName = body.full_name === undefined ? target.full_name : requireText(body.full_name, "Full name");
        const role = body.role === undefined ? target.role : body.role;
        const isActive = body.is_active === undefined ? Boolean(target.is_active) : body.is_active;
        if (!ROLES.includes(role)) throw Object.assign(new Error("Select a valid role."), { status: 400 });
        if (typeof isActive !== "boolean") throw Object.assign(new Error("Account status must be active or inactive."), { status: 400 });
        if (target.role === "Administrator" && target.is_active && (role !== "Administrator" || !isActive)) {
          const admins = db.prepare(`
            SELECT COUNT(*) AS count FROM users WHERE role = 'Administrator' AND is_active = 1
          `).get().count;
          if (admins < 2) throw Object.assign(new Error("At least one active administrator account must remain."), { status: 409 });
        }
        const password = body.password === undefined || body.password === "" ? null : requireText(body.password, "Password", 256);
        if (password && password.length < 10) {
          throw Object.assign(new Error("Password must contain at least 10 characters."), { status: 400 });
        }
        const changes = {
          ...(fullName !== target.full_name ? { full_name: { from: target.full_name, to: fullName } } : {}),
          ...(role !== target.role ? { role: { from: target.role, to: role } } : {}),
          ...(Number(isActive) !== target.is_active ? { active: { from: Boolean(target.is_active), to: isActive } } : {}),
          ...(password ? { password_changed: true } : {}),
        }
        if (Object.keys(changes).length) {
          db.exec("BEGIN IMMEDIATE");
          try {
            if (password) {
              db.prepare(`
                UPDATE users SET full_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?
              `).run(fullName, role, Number(isActive), hashPassword(password), id);
              db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(id, tokenHash);
            } else {
              db.prepare("UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?")
                .run(fullName, role, Number(isActive), id);
            }
            if (!isActive) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
            logActivity(db, {
              actorId: session.id,
              type: !isActive && target.is_active ? "user.deactivated"
                : isActive && !target.is_active ? "user.activated" : "user.updated",
              summary: `${!isActive && target.is_active ? "Deactivated" : isActive && !target.is_active ? "Activated" : "Updated"} account for ${fullName}.`,
              subjectUserId: id,
              details: { email: target.email, changes },
            });
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        }
        return json(response, 200, { user: cleanUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)) });
      }

      return json(response, 404, { error: "API endpoint not found." });
    } catch (error) {
      if (!response.headersSent) {
        const status = error.status || 500;
        if (status >= 500) console.error("Request failed:", error);
        return json(response, status, { error: status >= 500 ? "Something went wrong. Please try again." : error.message });
      }
      response.destroy(error);
    }
  }

  return http.createServer((request, response) => {
    handle(request, response);
  });
}

function validateProduct(input) {
  const name = requireText(input.name, "Product name");
  const sku = requireText(input.sku, "SKU", 64);
  const category = requireText(input.category, "Category", 80);
  const cost = requirePrice(input.cost_price, "Buying cost");
  const price = requirePrice(input.selling_price, "Selling price");
  const stock = requireInteger(input.stock_quantity, "Stock quantity");
  const minimum = requireInteger(input.min_stock_level, "Minimum stock level");
  const image = input.image_url === undefined || input.image_url === null || input.image_url === "" ? "" : requireText(input.image_url, "Product image URL", 2048);
  if (image) {
    if (!/^\/images\/[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/.test(image)) {
      let parsed;
      try {
        parsed = new URL(image);
      } catch {
        throw Object.assign(new Error("Use a built-in /images/name.svg illustration or a valid HTTPS image URL."), { status: 400 });
      }
      if (parsed.protocol !== "https:") {
        throw Object.assign(new Error("Use a built-in /images/name.svg illustration or a valid HTTPS image URL."), { status: 400 });
      }
    }
  }
  return [name, sku, category, cost, price, stock, minimum, image];
}

function getSale(db, id) {
  const sale = db.prepare(`
    SELECT s.*, u.full_name AS cashier_name
    FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id = ?
  `).get(id);
  if (!sale) return null;
  sale.items = db.prepare(`
    SELECT product_id, product_name, sku, quantity, unit_price, unit_cost, line_total
    FROM sale_items WHERE sale_id = ? ORDER BY id
  `).all(id);
  return sale;
}

if (require.main === module) {
  const db = openDatabase();
  const server = createServer(db);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`DVN POS is running on port ${PORT}`);
  });
}

module.exports = { createServer, hashPassword, openDatabase, verifyPassword };
