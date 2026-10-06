"use strict";

const app = document.getElementById("app");
const modalRoot = document.getElementById("modal-root");
const toastRegion = document.getElementById("toast-region");
const money = new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" });
const dateShort = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" });
const icons = {
  dashboard: "⌂", pos: "⊞", products: "◈", sales: "▤", inventory: "▧", reports: "▥", activity: "◷", team: "♙",
};
const viewTitles = {
  dashboard: "Overview", pos: "Point of sale", products: "Products", sales: "Transactions",
  inventory: "Inventory", reports: "Reports", activity: "Activity history", team: "Team & access",
};
const categoriesFallback = ["All products"];
const productImages = [
  ["Coffee", "/images/coffee.svg"],
  ["Breakfast tea", "/images/tea.svg"],
  ["Spring water", "/images/water.svg"],
  ["Chocolate", "/images/chocolate.svg"],
  ["Cashews", "/images/nuts.svg"],
  ["Herbal soap", "/images/soap.svg"],
  ["Laundry soap", "/images/detergent.svg"],
  ["Notebook", "/images/notebook.svg"],
  ["Wildflower honey", "/images/honey.svg"],
  ["Fresh sourdough", "/images/sourdough.svg"],
  ["Long grain rice", "/images/rice.svg"],
  ["Golden cooking oil", "/images/oil.svg"],
  ["Mango juice", "/images/mango-juice.svg"],
  ["Butter biscuits", "/images/biscuits.svg"],
  ["Amber candle", "/images/candle.svg"],
  ["Cotton tote bag", "/images/tote-bag.svg"],
  ["Raw cane sugar", "/images/sugar.svg"],
  ["Smoked paprika", "/images/paprika.svg"],
  ["Botanical shampoo", "/images/shampoo.svg"],
  ["Farmhouse butter", "/images/butter.svg"],
];

const state = {
  user: null,
  view: "dashboard",
  dashboard: null,
  products: [],
  categories: categoriesFallback,
  category: "All products",
  productSearch: "",
  cart: [],
  discount: 0,
  payment: "Cash",
  sales: [],
  meta: null,
  report: null,
  activeUsers: [],
  movements: [],
  activity: [],
  activityFilters: { from: "", to: "", type: "", search: "" },
  loadingView: false,
  mobileNavOpen: false,
  includeArchived: false,
};

const fmt = (amount) => `UGX ${money.format(Number(amount) || 0)}`;
const fmtDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : dateTime.format(date);
};
const todayInput = () => new Date().toISOString().slice(0, 10);
const defaultRange = () => {
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: monthStart.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const initials = (value) => String(value || "U").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      state.user = null;
      state.cart = [];
      render();
    }
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

const post = (url, body) => api(url, { method: "POST", body: JSON.stringify(body) });
const patch = (url, body) => api(url, { method: "PATCH", body: JSON.stringify(body) });

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.innerHTML = `<span class="toast-icon">${isError ? "!" : "✓"}</span><span>${escapeHtml(message)}</span>`;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function loginView(error = "") {
  document.title = "Sign in · Cedar & Grain";
  app.innerHTML = `
    <main class="login-layout">
      <section class="login-art" aria-label="Cedar and Grain">
        <div class="brand"><span class="brand-mark">c.</span><span>Cedar &amp; Grain</span></div>
        <div class="art-copy">
          <p class="eyebrow">Your shop, beautifully run</p>
          <h1>Good things.<br>Good business.</h1>
          <p>One thoughtful place for your sales, your stock, and the little details that make your shop yours.</p>
        </div>
        <div class="art-footer"><span>Made for the neighborhood.</span><span>DVN POS · Kampala, Uganda</span></div>
      </section>
      <section class="login-form-side">
        <form class="login-card" id="login-form">
          <p class="eyebrow">WELCOME BACK</p>
          <h2>Sign in</h2>
          <p class="subheading">Enter your account details to open your shop.</p>
          ${error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div><div style="height:14px"></div>` : ""}
          <div class="field"><label for="login-email">Email address</label><input id="login-email" name="email" type="email" autocomplete="username" placeholder="you@yourshop.com" required maxlength="254"></div>
          <div class="field">
            <label for="login-password">Password</label>
            <div class="password-wrap"><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required maxlength="256"><button class="password-toggle" type="button" data-action="toggle-password">Show</button></div>
          </div>
          <button class="primary-btn login-submit" type="submit">Sign in to your shop <span aria-hidden="true">→</span></button>
          <div class="demo-hint">First time setting up? The administrator signs in with the email and password configured by your store owner.</div>
        </form>
      </section>
    </main>`;
}

function availableViews() {
  const views = [
    ["dashboard", "Overview", true],
    ["pos", "Register", true],
    ["sales", "Transactions", true],
  ];
  if (state.user.role !== "Cashier") {
    views.push(["products", "Products", false], ["inventory", "Inventory", false], ["reports", "Reports", false], ["activity", "Activity history", false]);
  }
  if (state.user.role === "Administrator") views.push(["team", "Team & access", false]);
  return views;
}

function appShell(content) {
  const currentTitle = viewTitles[state.view] || "Overview";
  const nav = availableViews();
  return `
    <div class="app-shell">
      <aside class="sidebar${state.mobileNavOpen ? " mobile-open" : ""}">
        <div class="brand-block"><span class="brand-mark">c.</span><div class="brand-copy"><div class="brand-name">Cedar &amp; Grain</div><div class="brand-caption">Daily goods · Kampala</div></div></div>
        <div class="nav-section">SHOP FLOOR</div>
        <nav class="nav-list" aria-label="Shop floor">
          ${nav.filter(([, , main]) => main).map(([id, label]) => navLink(id, label)).join("")}
        </nav>
        ${state.user.role !== "Cashier" ? `<div class="nav-section">MANAGEMENT</div><nav class="nav-list" aria-label="Management">${nav.filter(([, , main]) => !main).map(([id, label]) => navLink(id, label)).join("")}</nav>` : ""}
        <div class="sidebar-spacer"></div>
        <div class="sidebar-card"><div class="sidebar-card-title">A little shop, a lot of care.</div><p>Keep your shelves stocked and your regulars happy.</p></div>
        <div class="user-block"><div class="avatar">${escapeHtml(initials(state.user.full_name))}</div><div class="user-details"><div class="user-name">${escapeHtml(state.user.full_name)}</div><div class="user-role">${escapeHtml(state.user.role)}</div></div><button class="logout-btn" aria-label="Sign out" title="Sign out" data-action="logout">↪</button></div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div class="breadcrumb"><span class="brand-small">C&amp;G</span><span>›</span><strong>${escapeHtml(currentTitle)}</strong></div>
          <div class="topbar-right"><span class="topbar-date">${escapeHtml(dateShort.format(new Date()))}</span><span class="store-status"><span class="status-dot"></span>Shop open</span><button class="icon-btn mobile-menu" aria-label="Open navigation" data-action="mobile-nav">☰</button></div>
        </header>
        <div class="page-content">${content}</div>
      </main>
    </div>`;
}

function navLink(id, label) {
  return `<button class="nav-link${state.view === id ? " active" : ""}" data-action="navigate" data-view="${id}" aria-label="${escapeHtml(label)}" aria-current="${state.view === id ? "page" : "false"}"><span class="nav-icon">${icons[id]}</span><span class="nav-label">${escapeHtml(label)}</span></button>`;
}

function statCard(label, value, note, icon, shade = "") {
  return `<article class="stat-card"><div class="stat-label"><span class="stat-icon ${shade}">${icon}</span>${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">${escapeHtml(note)}</div></article>`;
}

function chartMarkup(data) {
  const map = new Map(data.map((item) => [item.day, item.total]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    const key = day.toISOString().slice(0, 10);
    return { key, value: Number(map.get(key) || 0), label: new Intl.DateTimeFormat("en-UG", { weekday: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`)) };
  });
  const highest = Math.max(...days.map(({ value }) => value), 0);
  if (highest === 0) return `<div class="empty-state">Your first sale will bring this chart to life.</div>`;
  const max = Math.max(highest, 3000);
  const chartW = 680;
  const chartH = 162;
  const startX = 36;
  const step = 92;
  const barW = 35;
  const baseline = 134;
  const top = 19;
  const grid = [0, 1, 2, 3].map((i) => {
    const y = top + i * 37;
    return `<line x1="${startX - 11}" y1="${y}" x2="${chartW - 17}" y2="${y}" stroke="#edf0e9" stroke-dasharray="3 5"/><text x="${startX - 13}" y="${y + 3}" text-anchor="end" class="chart-tooltip-text">${escapeHtml(abbreviateAmount(max * (3 - i) / 3))}</text>`;
  }).join("");
  const bars = days.map(({ key, value, label }, index) => {
    const height = Math.max(value ? Math.round((value / max) * 101) : 2, 2);
    const x = startX + index * step + 12;
    const y = baseline - height;
    const highlighted = key === todayInput();
    return `${value ? `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" class="chart-value-text">${escapeHtml(abbreviateAmount(value))}</text>` : ""}<rect x="${x}" y="${y}" width="${barW}" height="${height}" rx="5" fill="${highlighted ? "#45674a" : "#b9cbb2"}"/><text x="${x + barW / 2}" y="${baseline + 15}" text-anchor="middle" class="chart-tooltip-text"${highlighted ? ` fill="#37513b" font-weight="700"` : ""}>${escapeHtml(label)}</text>`;
  }).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${chartW} ${chartH}" role="img" aria-label="Sales over the past seven days">${grid}${bars}</svg></div>`;
}

function abbreviateAmount(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return money.format(Math.round(value));
}

function activityRows(entries, compact = false) {
  if (!entries.length) return `<div class="empty-state">Actions will appear here as your team works.</div>`;
  return `<div class="activity-list">${entries.map((entry) => `
    <div class="activity-row">
      <span class="activity-mark">${escapeHtml(entry.event_type.startsWith("sale.") ? "▤" : entry.event_type.startsWith("inventory.") ? "▧" : entry.event_type.startsWith("product.") ? "◈" : "♙")}</span>
      <div class="activity-copy"><div class="activity-summary">${escapeHtml(entry.summary)}</div><div class="activity-meta">${escapeHtml(entry.actor_name)} · ${escapeHtml(fmtDate(entry.created_at))}</div></div>
      ${!compact && entry.sale_id ? `<button class="panel-link" data-action="receipt" data-id="${entry.sale_id}">Receipt ↗</button>` : ""}
    </div>`).join("")}</div>`;
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return loadingView("Gathering your shop's details…");
  const bestSeller = d.best_seller
    ? `${d.best_seller.name} · ${d.best_seller.quantity} sold`
    : "No completed sales yet";
  const payments = d.payment_methods.length
    ? d.payment_methods.map(({ method, transactions, total }) => `
      <div class="payment-row">
        <span class="payment-icon">${paymentSymbol(method)}</span>
        <div><div class="payment-name">${escapeHtml(method)}</div><div class="payment-meta">${transactions} transaction${transactions === 1 ? "" : "s"}</div></div>
        <span class="payment-total">${escapeHtml(fmt(total))}</span>
      </div>`).join("")
    : `<div class="empty-state">No payments recorded today.</div>`;
  const lowStock = d.low_stock_items.length
    ? d.low_stock_items.slice(0, 5).map((product) => `
      <div class="low-stock-row">
        <span class="low-stock-initial">${escapeHtml(initials(product.name)[0])}</span>
        <div><div class="cell-main">${escapeHtml(product.name)}</div><div class="cell-sub">${escapeHtml(product.category)} · minimum ${product.min_stock_level}</div></div>
        <span class="badge ${product.stock_quantity === 0 ? "danger" : "warning"}">${product.stock_quantity === 0 ? "Out" : `${product.stock_quantity} left`}</span>
      </div>`).join("")
    : `<div class="empty-state">Every shelf is looking good.</div>`;
  const recent = d.recent_sales.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Receipt</th><th>Cashier</th><th>Payment</th><th>Total</th></tr></thead><tbody>${d.recent_sales.slice(0, 5).map((sale) => `
        <tr><td><button class="panel-link" data-action="receipt" data-id="${sale.id}">${escapeHtml(sale.receipt_number)}</button><div class="cell-sub">${escapeHtml(fmtDate(sale.created_at))}</div></td><td>${escapeHtml(sale.cashier_name)}</td><td>${escapeHtml(sale.payment_method)}</td><td class="money">${escapeHtml(fmt(sale.total))}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty-state">Your first sale will appear here.</div>`;
  const stats = state.user.role === "Cashier"
    ? [
      statCard("Today's sales", fmt(d.today.total), `${d.today.transactions} completed transactions`, "↗", ""),
      statCard("This week", fmt(d.week), "Last 7 days", "◷", "blue"),
      statCard("This month", fmt(d.month), new Intl.DateTimeFormat("en-UG", { month: "long", year: "numeric" }).format(new Date()), "▦", "amber"),
      statCard("Transactions", `${d.today.transactions}`, "Completed today", "▤", "rose"),
    ].join("")
    : [
      statCard("Today's sales", fmt(d.today.total), `${d.today.transactions} completed transactions`, "↗", ""),
      statCard("This week", fmt(d.week), "Last 7 days", "◷", "blue"),
      statCard("This month", fmt(d.month), new Intl.DateTimeFormat("en-UG", { month: "long", year: "numeric" }).format(new Date()), "▦", "amber"),
      statCard("Gross profit", fmt(d.gross_profit), `Best seller: ${bestSeller}`, "◆", "rose"),
    ].join("");
  return `
    <div class="page-heading"><div><p class="eyebrow">A good day starts here</p><h1>Your shop at a glance</h1><p>Here's what's happening at Cedar &amp; Grain today.</p></div><button class="primary-btn" data-action="navigate" data-view="pos">＋ &nbsp;New sale</button></div>
    <section class="stats-grid" aria-label="Sales overview">${stats}</section>
    <section class="dashboard-main-grid">
      <article class="chart-card"><div class="panel-heading"><div><h2>Sales this week</h2><p class="panel-subtitle">Your shop's rhythm, day by day</p></div><span class="badge">7 days</span></div>${chartMarkup(d.chart)}</article>
      <article class="panel"><div class="panel-heading"><div><h2>Today's payments</h2><p class="panel-subtitle">How customers are paying</p></div></div><div class="payment-list">${payments}</div></article>
    </section>
    ${state.user.role !== "Cashier" ? `<section class="sub-grid">
      <article class="panel"><div class="panel-heading"><div><h2>Recent transactions</h2><p class="panel-subtitle">The latest activity from your till</p></div><button class="panel-link" data-action="navigate" data-view="sales">All transactions →</button></div>${recent}</article>
      <article class="panel"><div class="panel-heading"><div><h2>Needs a little love</h2><p class="panel-subtitle">${d.low_stock} product${d.low_stock === 1 ? "" : "s"} running low</p></div><button class="panel-link" data-action="navigate" data-view="inventory">View stock →</button></div><div class="low-stock-list">${lowStock}</div></article>
    </section><section class="panel dashboard-activity"><div class="panel-heading"><div><h2>Recent activity</h2><p class="panel-subtitle">A shared record of changes across your shop</p></div><button class="panel-link" data-action="navigate" data-view="activity">Full activity history →</button></div>${activityRows(d.recent_activity || [], true)}</section>` : ""}
  `;
}

function paymentSymbol(method) {
  return ({ Cash: "◉", "Mobile Money": "▦", Card: "▤", "Bank transfer": "↗" })[method] || "◉";
}

function renderPos() {
  const categories = ["All products", ...new Set(state.products.map((product) => product.category))];
  const visible = state.products.filter((product) =>
    product.is_active
    && (state.category === "All products" || product.category === state.category)
    && (!state.productSearch || `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(state.productSearch.toLowerCase())),
  );
  const subtotal = state.cart.reduce((sum, item) => sum + item.selling_price * item.quantity, 0);
  const discountAmount = Math.round(subtotal * state.discount / 100);
  const cartItems = state.cart.length
    ? state.cart.map((item) => `
      <div class="cart-item">
        <div><div class="cart-item-name">${escapeHtml(item.name)}</div><div class="cart-item-price">${escapeHtml(fmt(item.selling_price))} each · ${escapeHtml(fmt(item.selling_price * item.quantity))}</div></div>
        <div class="quantity-controls"><button data-action="quantity" data-id="${item.id}" data-change="-1" aria-label="Remove one ${escapeHtml(item.name)}">−</button><span>${item.quantity}</span><button data-action="quantity" data-id="${item.id}" data-change="1" aria-label="Add one ${escapeHtml(item.name)}">+</button></div>
      </div>`).join("")
    : `<div class="cart-empty">A good sale starts with a good find.</div>`;
  return `
    <div class="page-heading"><div><p class="eyebrow">THE REGISTER</p><h1>Take a sale</h1><p>Tap a product or find something by name or code.</p></div><div class="store-status"><span class="status-dot"></span>Register open</div></div>
    <div class="pos-layout">
      <section class="products-panel">
        <div class="toolbar"><label class="search-box"><span class="search-symbol">⌕</span><input id="pos-search" type="search" placeholder="Find a product or scan its code…" value="${escapeHtml(state.productSearch)}" autocomplete="off"></label><span class="badge">${visible.length} in stock</span></div>
        <div class="category-row">${categories.map((category) => `<button class="category-pill${state.category === category ? " active" : ""}" data-action="category" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>
        ${visible.length ? `<div class="product-grid">${visible.map((product) => `
          <button class="product-card" data-action="add-cart" data-id="${product.id}"${product.stock_quantity === 0 ? " disabled" : ""} aria-label="Add ${escapeHtml(product.name)} to the sale">
            <div class="product-image">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)} product illustration" loading="lazy" onerror="this.remove()"><span class="image-fallback">${escapeHtml(initials(product.name)[0])}</span>` : `<span class="image-fallback">${escapeHtml(initials(product.name)[0])}</span>`}</div>
            <div class="product-info"><div class="cell-main">${escapeHtml(product.name)}</div><div class="cell-sub">${escapeHtml(product.sku)} · ${product.stock_quantity} in stock</div><div class="product-price-row"><span class="product-price">${escapeHtml(fmt(product.selling_price))}</span>${product.stock_quantity <= product.min_stock_level ? `<span class="badge warning">Low</span>` : ""}</div></div>
          </button>`).join("")}</div>` : `<div class="empty-state">Nothing by that name on the shelves. Try another search.</div>`}
      </section>
      <aside class="cart-panel" aria-label="Current sale">
        <div class="cart-heading"><h2>Your basket</h2><span class="cart-count">${state.cart.reduce((sum, item) => sum + item.quantity, 0)}</span></div>
        <div class="cart-items">${cartItems}</div>
        <div class="cart-discount"><label for="discount-input">Friendly discount</label><input id="discount-input" type="number" min="0" max="100" step="0.5" value="${state.discount}" aria-label="Discount percent"></div>
        <div class="cart-summary"><div class="summary-row"><span>Subtotal</span><span>${escapeHtml(fmt(subtotal))}</span></div>${state.discount ? `<div class="summary-row"><span>Discount (${state.discount}%)</span><span>−${escapeHtml(fmt(discountAmount))}</span></div>` : ""}<div class="summary-row total"><span>Total</span><span>${escapeHtml(fmt(subtotal - discountAmount))}</span></div></div>
        <div class="cart-checkout"><div class="field"><label for="payment-method">How would they like to pay?</label><select id="payment-method">${["Cash", "Mobile Money", "Card", "Bank transfer"].map((method) => `<option${state.payment === method ? " selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select></div><button class="primary-btn checkout-button" data-action="checkout"${!state.cart.length ? " disabled" : ""}>Complete sale &nbsp;→</button></div>
      </aside>
    </div>`;
}

function saleStatus(status) {
  if (status === "refunded") return `<span class="badge danger">Refunded</span>`;
  return `<span class="badge">Completed</span>`;
}

function salesToolbar(filters = {}) {
  return `<div class="toolbar">
    <label class="search-box"><span class="search-symbol">⌕</span><input class="sales-search" type="search" placeholder="Receipt or cashier name…" value="${escapeHtml(filters.search || "")}"></label>
    <div class="filter-group"><input class="toolbar-input sales-from" type="date" aria-label="Start date" value="${escapeHtml(filters.from || "")}"><span class="muted">to</span><input class="toolbar-input sales-to" type="date" aria-label="End date" value="${escapeHtml(filters.to || "")}"></div>
    ${state.user.role !== "Cashier" && state.meta?.users.length ? `<select class="toolbar-input toolbar-select sales-cashier" aria-label="Filter by cashier"><option value="">All cashiers</option>${state.meta.users.map((user) => `<option value="${user.id}"${String(filters.cashier || "") === String(user.id) ? " selected" : ""}>${escapeHtml(user.full_name)}</option>`).join("")}</select>` : ""}
    <select class="toolbar-input toolbar-select sales-payment" aria-label="Filter by payment method"><option value="">All payments</option>${["Cash", "Mobile Money", "Card", "Bank transfer"].map((method) => `<option${filters.payment === method ? " selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select>
    <button class="secondary-btn" data-action="filter-sales">Apply filters</button>
  </div>`;
}

function renderSales() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const filters = { search: params.get("search") || "", from: params.get("from") || "", to: params.get("to") || "", cashier: params.get("cashier") || "", payment: params.get("payment") || "" };
  return `
    <div class="page-heading"><div><p class="eyebrow">A RECORD OF THE GOOD WORK</p><h1>Transactions</h1><p>${state.sales.length} recent sale${state.sales.length === 1 ? "" : "s"}${state.sales.length === 500 ? " · showing latest 500" : ""}</p></div></div>
    ${salesToolbar(filters)}
    <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Receipt</th><th>Date &amp; time</th><th>Cashier</th><th>Payment</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
    ${state.sales.length ? state.sales.map((sale) => `<tr>
      <td><button class="panel-link" data-action="receipt" data-id="${sale.id}">${escapeHtml(sale.receipt_number)}</button></td><td>${escapeHtml(fmtDate(sale.created_at))}</td><td>${escapeHtml(sale.cashier_name)}</td><td>${escapeHtml(sale.payment_method)}</td><td>${sale.item_count || "—"}</td><td class="money">${escapeHtml(fmt(sale.total))}</td><td>${saleStatus(sale.status)}</td><td><div class="table-actions"><button class="icon-btn" title="View receipt" aria-label="View receipt" data-action="receipt" data-id="${sale.id}">↗</button>${state.user.role !== "Cashier" && sale.status === "completed" ? `<button class="danger-btn" data-action="refund" data-id="${sale.id}">Refund</button>` : ""}</div></td>
    </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">No transactions match these filters yet.</div></td></tr>`}
    </tbody></table></div></section>`;
}

function renderProducts() {
  const search = state.productSearch.toLowerCase();
  const products = state.products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search));
  return `
    <div class="page-heading"><div><p class="eyebrow">EVERYTHING ON YOUR SHELVES</p><h1>Products</h1><p>Thoughtful little details help everything run smoothly.</p></div><button class="primary-btn" data-action="add-product">＋ &nbsp;Add a product</button></div>
    <div class="toolbar"><label class="search-box"><span class="search-symbol">⌕</span><input id="management-product-search" type="search" placeholder="Find a product or SKU…" value="${escapeHtml(state.productSearch)}"></label><select class="toolbar-input toolbar-select" id="product-status-filter"><option value="active"${state.includeArchived ? "" : " selected"}>Active products</option><option value="all"${state.includeArchived ? " selected" : ""}>Include archived</option></select><span class="badge">${products.length} product${products.length === 1 ? "" : "s"}</span></div>
    <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Buying cost</th><th>Selling price</th><th>In stock</th><th>Health</th><th>Status</th><th></th></tr></thead><tbody>
    ${products.length ? products.map((product) => `<tr><td><div class="product-table-cell">${product.image_url ? `<img class="product-thumb" src="${escapeHtml(product.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<div class="cell-main">${escapeHtml(product.name)}</div></div></td><td>${escapeHtml(product.sku)}</td><td>${escapeHtml(product.category)}</td><td>${escapeHtml(fmt(product.cost_price))}</td><td class="money">${escapeHtml(fmt(product.selling_price))}</td><td>${product.stock_quantity}</td><td>${product.stock_quantity === 0 ? `<span class="badge danger">Out of stock</span>` : product.stock_quantity <= product.min_stock_level ? `<span class="badge warning">Low · minimum ${product.min_stock_level}</span>` : `<span class="badge">Healthy</span>`}</td><td>${product.is_active ? `<span class="badge">Active</span>` : `<span class="badge neutral">Archived</span>`}</td><td><div class="table-actions"><button class="icon-btn" data-action="edit-product" data-id="${product.id}" title="Edit ${escapeHtml(product.name)}" aria-label="Edit ${escapeHtml(product.name)}">✎</button>${product.is_active ? `<button class="icon-btn" data-action="adjust-stock" data-id="${product.id}" title="Adjust stock" aria-label="Adjust stock for ${escapeHtml(product.name)}">±</button>` : ""}<button class="${product.is_active ? "danger-btn" : "secondary-btn"}" data-action="toggle-product" data-id="${product.id}" data-active="${product.is_active}">${product.is_active ? "Archive" : "Restore"}</button></div></td></tr>`).join("") : `<tr><td colspan="9"><div class="empty-state">No products found. Try another search or add something wonderful.</div></td></tr>`}
    </tbody></table></div></section>`;
}

function renderInventory() {
  const total = state.products.filter((product) => product.is_active).reduce((sum, product) => sum + product.stock_quantity * product.cost_price, 0);
  const products = state.products.filter((product) => product.is_active);
  return `
    <div class="page-heading"><div><p class="eyebrow">EVERYTHING IN ITS RIGHT PLACE</p><h1>Inventory</h1><p>On-hand counts, stock value, and the story behind every change.</p></div><div class="inventory-value-card"><span>Value at buying cost</span><strong>${escapeHtml(fmt(total))}</strong></div></div>
    <div class="toolbar"><label class="search-box"><span class="search-symbol">⌕</span><input id="management-product-search" type="search" placeholder="Find a product or SKU…" value="${escapeHtml(state.productSearch)}"></label><select class="toolbar-input toolbar-select" id="inventory-filter"><option value="all">All stock levels</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></div>
    <section class="panel"><div class="panel-heading"><div><h2>On the shelves</h2><p class="panel-subtitle">${products.filter((p) => p.stock_quantity <= p.min_stock_level).length} products need attention · ${products.length} active products</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Category</th><th>On hand</th><th>Minimum</th><th>Buying cost</th><th>Shelf value</th><th>Stock health</th><th>Update</th></tr></thead><tbody id="inventory-rows">${products.map((product) => inventoryRow(product)).join("") || `<tr><td colspan="8"><div class="empty-state">No products on the shelves.</div></td></tr>`}</tbody></table></div></section>
    <section class="panel" style="margin-top:15px"><div class="panel-heading"><div><h2>Stock story</h2><p class="panel-subtitle">The latest additions, sales, and little adjustments.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>What happened</th><th>Change</th><th>New count</th><th>By</th><th>When</th><th>Reason</th></tr></thead><tbody>${state.movements.length ? state.movements.slice(0, 70).map((m) => `<tr><td><div class="cell-main">${escapeHtml(m.product_name)}</div><div class="cell-sub">${escapeHtml(m.sku)}</div></td><td>${escapeHtml(capitalize(m.movement_type))}</td><td class="stock-change ${m.quantity_change > 0 ? "stock-positive" : "stock-negative"}">${m.quantity_change > 0 ? "+" : ""}${m.quantity_change}</td><td>${m.quantity_after}</td><td>${escapeHtml(m.user_name)}</td><td>${escapeHtml(fmtDate(m.created_at))}</td><td>${escapeHtml(m.reason)}</td></tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">Stock movements will appear as things change.</div></td></tr>`}</tbody></table></div></section>`;
}

function inventoryRow(product) {
  const width = product.min_stock_level ? Math.min(100, product.stock_quantity / Math.max(product.min_stock_level * 2, 1) * 100) : product.stock_quantity ? 100 : 0;
  const shade = product.stock_quantity === 0 ? "#bd5a4a" : product.stock_quantity <= product.min_stock_level ? "#c88032" : "#77936c";
  const status = product.stock_quantity === 0 ? `<span class="badge danger">Out of stock</span>` : product.stock_quantity <= product.min_stock_level ? `<span class="badge warning">Needs restock</span>` : `<span class="badge">Looking good</span>`;
  return `<tr data-product-stock="${product.id}" data-quantity="${product.stock_quantity}" data-minimum="${product.min_stock_level}"><td><div class="cell-main">${escapeHtml(product.name)}</div><div class="cell-sub">${escapeHtml(product.sku)}</div></td><td>${escapeHtml(product.category)}</td><td><div class="stock-cell"><span class="money">${product.stock_quantity} units</span><div class="stock-meter"><span style="width:${width}%;background:${shade}"></span></div></div></td><td>${product.min_stock_level} units</td><td>${escapeHtml(fmt(product.cost_price))}</td><td class="money">${escapeHtml(fmt(product.stock_quantity * product.cost_price))}</td><td>${status}</td><td><button class="secondary-btn" data-action="adjust-stock" data-id="${product.id}">± &nbsp;Adjust</button></td></tr>`;
}

function renderReports() {
  const range = state.report ? { from: state.report.from, to: state.report.to } : defaultRange();
  const r = state.report;
  return `
    <div class="page-heading"><div><p class="eyebrow">THE BIGGER PICTURE</p><h1>Reports</h1><p>Clear numbers for the everyday decisions and the big ones.</p></div><div class="range-picker"><input id="report-from" class="toolbar-input" type="date" aria-label="Report start date" value="${escapeHtml(range.from)}"><input id="report-to" class="toolbar-input" type="date" aria-label="Report end date" value="${escapeHtml(range.to)}"><button class="primary-btn" data-action="run-report">Run report</button></div></div>
    ${!r ? loadingView("Putting the numbers together…") : `
      <section class="report-cards">${statCard("Net sales", fmt(r.summary.revenue), `${r.summary.transactions} transactions, including refunds`, "↗")}${statCard("Gross profit", fmt(r.summary.gross_profit), "Sales less product buying costs", "◆", "rose")}${statCard("Discounts given", fmt(r.summary.discounts), "Total savings passed to customers", "◇", "amber")}${statCard("Products sold", `${r.products.reduce((sum, item) => sum + item.quantity, 0)}`, "Across completed sales", "◈", "blue")}</section>
      <section class="report-tables">
        <article class="panel"><div class="panel-heading"><div><h2>Best sellers</h2><p class="panel-subtitle">By units sold during the selected period.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>SKU</th><th>Units</th><th>Sales</th></tr></thead><tbody>${r.products.length ? r.products.map((p) => `<tr><td class="cell-main">${escapeHtml(p.name)}</td><td>${escapeHtml(p.sku)}</td><td class="money">${p.quantity}</td><td>${escapeHtml(fmt(p.revenue))}</td></tr>`).join("") : `<tr><td colspan="4"><div class="empty-state">Your next great seller is still waiting.</div></td></tr>`}</tbody></table></div></article>
        <article class="panel"><div class="panel-heading"><div><h2>Sales by cashier</h2><p class="panel-subtitle">A little look at each shift.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Team member</th><th>Sales</th><th>Transactions</th></tr></thead><tbody>${r.cashiers.length ? r.cashiers.map((c) => `<tr><td class="cell-main">${escapeHtml(c.name)}</td><td>${escapeHtml(fmt(c.revenue))}</td><td>${c.transactions}</td></tr>`).join("") : `<tr><td colspan="3"><div class="empty-state">No sales in this period.</div></td></tr>`}</tbody></table></div></article>
        <article class="panel"><div class="panel-heading"><div><h2>How customers pay</h2><p class="panel-subtitle">Payment mix during the selected period.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Payment method</th><th>Transactions</th><th>Sales</th></tr></thead><tbody>${r.payments.length ? r.payments.map((p) => `<tr><td>${escapeHtml(p.method)}</td><td>${p.transactions}</td><td class="money">${escapeHtml(fmt(p.revenue))}</td></tr>`).join("") : `<tr><td colspan="3"><div class="empty-state">Nothing to tally just yet.</div></td></tr>`}</tbody></table></div></article>
        <article class="panel"><div class="panel-heading"><div><h2>Stock on hand</h2><p class="panel-subtitle">Live inventory, valued at buying cost.</p></div><button class="secondary-btn" data-action="export-inventory">Download CSV</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>In stock</th><th>Minimum</th><th>Stock value</th><th>Health</th></tr></thead><tbody>${r.inventory.filter((p) => p.stock_quantity <= p.min_stock_level).map((p) => `<tr><td><div class="cell-main">${escapeHtml(p.name)}</div><div class="cell-sub">${escapeHtml(p.sku)}</div></td><td>${p.stock_quantity}</td><td>${p.min_stock_level}</td><td>${escapeHtml(fmt(p.inventory_value))}</td><td>${p.stock_quantity ? `<span class="badge warning">Low stock</span>` : `<span class="badge danger">Out of stock</span>`}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-state">All your products are looking good.</div></td></tr>`}</tbody></table></div></article>
        <article class="panel report-span-2"><div class="panel-heading"><div><h2>Sales ledger</h2><p class="panel-subtitle">A downloadable, line-by-line record for your selected dates.</p></div><button class="secondary-btn" data-action="export-sales-report">↓ &nbsp;Export sales CSV</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Payment</th><th>Status</th><th>Subtotal</th><th>Discount</th><th>Sales</th></tr></thead><tbody>${r.sales.length ? r.sales.map((sale) => `<tr><td><button class="panel-link" data-action="receipt" data-id="${sale.id}">${escapeHtml(sale.receipt_number)}</button></td><td>${escapeHtml(fmtDate(sale.created_at))}</td><td>${escapeHtml(sale.cashier_name)}</td><td>${escapeHtml(sale.payment_method)}</td><td>${saleStatus(sale.status)}</td><td>${escapeHtml(fmt(sale.subtotal))}</td><td>${escapeHtml(fmt(sale.discount_amount))}</td><td class="money">${escapeHtml(fmt(sale.total))}</td></tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">No sales to report in this period.</div></td></tr>`}</tbody></table></div></article>
      </section>
    }`}`;
}

function renderTeam() {
  return `
    <div class="page-heading"><div><p class="eyebrow">A THOUGHTFUL TEAM MAKES A LOVELY SHOP</p><h1>Team &amp; access</h1><p>Welcome the right people in, and give each of them the right keys.</p></div><button class="primary-btn" data-action="add-user">＋ &nbsp;Add a teammate</button></div>
    <section class="panel"><div class="panel-heading"><div><h2>Your team</h2><p class="panel-subtitle">${state.activeUsers.filter((u) => u.is_active).length} active team members · passwords are securely protected</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Team member</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${state.activeUsers.map((user) => `<tr><td><div class="cell-main">${escapeHtml(user.full_name)}</div></td><td>${escapeHtml(user.email)}</td><td><span class="badge neutral">${escapeHtml(user.role)}</span></td><td>${user.is_active ? `<span class="badge">Active</span>` : `<span class="badge danger">Signed out · inactive</span>`}</td><td><div class="table-actions"><button class="secondary-btn" data-action="edit-user" data-id="${user.id}">Manage access</button></div></td></tr>`).join("")}</tbody></table></div></section>
    <section class="report-tables" style="margin-top:15px"><article class="panel"><div class="panel-heading"><h2>Administrator</h2></div><p class="subheading">Full access to everything in the shop: products, sales, reports, refunds, and team accounts.</p></article><article class="panel"><div class="panel-heading"><h2>Manager</h2></div><p class="subheading">Manage products and stock, view every transaction and receipt, process refunds, and run business reports.</p></article><article class="panel"><div class="panel-heading"><h2>Cashier</h2></div><p class="subheading">Ring up sales, apply customer discounts, print receipts, and view their own sales only.</p></article></section>
  `;
}

function renderActivity() {
  const filters = state.activityFilters;
  return `
    <div class="page-heading"><div><p class="eyebrow">A CLEAR RECORD OF EVERY CHANGE</p><h1>Activity history</h1><p>Track sales, refunds, inventory movements, product changes, and team access.</p></div><button class="secondary-btn" data-action="export-activity"${state.activity.length ? "" : " disabled"}>↓ &nbsp;Export CSV</button></div>
    <div class="toolbar activity-filters">
      <label class="field activity-search"><span>Search</span><input class="toolbar-input" id="activity-search" type="search" placeholder="Action, product, receipt, or teammate…" value="${escapeHtml(filters.search)}"></label>
      <label class="field"><span>From</span><input class="toolbar-input" id="activity-from" type="date" value="${escapeHtml(filters.from)}"></label>
      <label class="field"><span>To</span><input class="toolbar-input" id="activity-to" type="date" value="${escapeHtml(filters.to)}"></label>
      <label class="field"><span>Area</span><select class="toolbar-input toolbar-select" id="activity-type"><option value="">All activity</option>${[["sales", "Sales & refunds"], ["inventory", "Inventory"], ["products", "Products"], ["team", "Team access"]].map(([value, label]) => `<option value="${value}"${filters.type === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <button class="primary-btn" data-action="filter-activity">Apply filters</button>
    </div>
    <section class="panel"><div class="panel-heading"><div><h2>Recorded actions</h2><p class="panel-subtitle">${state.activity.length} event${state.activity.length === 1 ? "" : "s"} shown · latest 500 matching events</p></div></div>
      ${state.activity.length ? `<div class="activity-list activity-full-list">${state.activity.map((entry) => `
        <article class="activity-entry">
          <div class="activity-row">
            <span class="activity-mark">${escapeHtml(entry.event_type.startsWith("sale.") ? "▤" : entry.event_type.startsWith("inventory.") ? "▧" : entry.event_type.startsWith("product.") ? "◈" : "♙")}</span>
            <div class="activity-copy"><div class="activity-summary">${escapeHtml(entry.summary)}</div><div class="activity-meta">${escapeHtml(entry.actor_name)} · ${escapeHtml(fmtDate(entry.created_at))} · ${escapeHtml(entry.event_type.replace(".", " · "))}</div></div>
            ${entry.sale_id ? `<button class="panel-link" data-action="receipt" data-id="${entry.sale_id}">Receipt ↗</button>` : ""}
          </div>
          <details class="activity-details"><summary>View recorded details</summary><pre>${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre></details>
        </article>`).join("")}</div>` : `<div class="empty-state">No recorded actions match these filters.</div>`}
    </section>`;
}

function loadingView(text) {
  return `<div class="loading"><span class="spinner"></span>${escapeHtml(text)}</div>`;
}

function render() {
  if (!state.user) {
    loginView();
    return;
  }
  document.title = `${viewTitles[state.view] || "Overview"} · Cedar & Grain`;
  const renderers = {
    dashboard: renderDashboard, pos: renderPos, products: renderProducts,
    sales: renderSales, inventory: renderInventory, reports: renderReports, activity: renderActivity, team: renderTeam,
  };
  app.innerHTML = appShell((renderers[state.view] || renderDashboard)());
}

function setModal(html, wide = false) {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal-card${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true">${html}</section></div>`;
  modalRoot.querySelector("input,select,textarea,button")?.focus();
}

function clearModal() {
  modalRoot.innerHTML = "";
}

function productForm(product = null) {
  const editing = Boolean(product);
  setModal(`
    <div class="modal-heading"><div><h2>${editing ? "A little product update" : "Something new for the shelves"}</h2><p>All prices are in Ugandan shillings (UGX).</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>
    <form id="product-form" data-id="${product?.id || ""}">
      <div class="form-grid">
        <div class="field"><label for="product-name">Product name</label><input id="product-name" name="name" required maxlength="120" placeholder="A lovely product name" value="${escapeHtml(product?.name || "")}"></div>
        <div class="field"><label for="product-sku">Product code / SKU</label><input id="product-sku" name="sku" required maxlength="64" placeholder="e.g. TEA-001" value="${escapeHtml(product?.sku || "")}"></div>
        <div class="field"><label for="product-category">Category</label><input id="product-category" name="category" list="product-categories" required maxlength="80" placeholder="e.g. Beverages" value="${escapeHtml(product?.category || "")}"><datalist id="product-categories">${state.categories.filter((c) => c !== "All products").map((c) => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist></div>
        <div class="field image-field"><label for="product-image">Product image <span class="muted">(choose an illustration or paste an image URL)</span></label><input id="product-image" name="image_url" type="text" maxlength="2048" aria-label="Product image URL or built-in image path" placeholder="/images/honey.svg or https://…" value="${escapeHtml(product?.image_url || "")}"><div class="image-picker-label">A ready-to-use product illustration</div><div class="image-picker" aria-label="Choose a product illustration">${productImages.map(([label, url]) => `<button class="image-choice${product?.image_url === url ? " selected" : ""}" type="button" data-action="choose-image" data-image="${url}" title="${escapeHtml(label)}" aria-label="Use ${escapeHtml(label)} illustration"><img src="${url}" alt="" loading="lazy"><span>${escapeHtml(label)}</span></button>`).join("")}</div></div>
        <div class="field"><label for="product-cost">Buying cost · UGX</label><input id="product-cost" name="cost_price" type="number" min="0" step="1" required placeholder="0" value="${product?.cost_price ?? ""}"></div>
        <div class="field"><label for="product-selling">Selling price · UGX</label><input id="product-selling" name="selling_price" type="number" min="0" step="1" required placeholder="0" value="${product?.selling_price ?? ""}"></div>
        ${editing ? "" : `<div class="field"><label for="product-quantity">Opening stock · units</label><input id="product-quantity" name="stock_quantity" type="number" min="0" step="1" required value="0"></div>`}
        <div class="field"><label for="product-minimum">Low-stock alert at · units</label><input id="product-minimum" name="min_stock_level" type="number" min="0" step="1" required value="${product?.min_stock_level ?? 5}"></div>
      </div>
      <div class="modal-actions"><button class="secondary-btn" type="button" data-action="close-modal">Not now</button><button class="primary-btn" type="submit">${editing ? "Save product" : "Add to the shelves"}</button></div>
    </form>
  `);
}

function stockForm(product) {
  setModal(`
    <div class="modal-heading"><div><h2>A stock adjustment</h2><p>${escapeHtml(product.name)} · ${product.stock_quantity} in stock · ${escapeHtml(product.sku)}</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>
    <form id="stock-form" data-id="${product.id}">
      <div class="field"><label for="stock-mode">What would you like to do?</label><select name="mode" id="stock-mode"><option value="add">Add stock received</option><option value="remove">Record a stock reduction</option><option value="set">Set an exact stock count</option></select></div>
      <div class="field"><label for="stock-quantity">Quantity · units</label><input id="stock-quantity" name="quantity" type="number" min="1" step="1" required></div>
      <div class="field"><label for="stock-reason">A note for the stock history</label><input id="stock-reason" name="reason" maxlength="200" required placeholder="e.g. New delivery from the supplier"></div>
      <div class="modal-actions"><button class="secondary-btn" type="button" data-action="close-modal">Not now</button><button class="primary-btn" type="submit">Save the count</button></div>
    </form>
  `);
}

function userForm(user = null) {
  const editing = Boolean(user);
  setModal(`
    <div class="modal-heading"><div><h2>${editing ? "A teammate's access" : "Welcome someone new"}</h2><p>${editing ? "Update their details, role, or sign-in access." : "Add a teammate who helps make your shop."}</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>
    <form id="user-form" data-id="${user?.id || ""}">
      <div class="field"><label for="user-name">Full name</label><input id="user-name" name="full_name" required maxlength="120" value="${escapeHtml(user?.full_name || "")}"></div>
      ${editing ? `<div class="field"><label>Email address</label><input value="${escapeHtml(user.email)}" disabled></div>` : `<div class="field"><label for="user-email">Email address</label><input id="user-email" name="email" type="email" required maxlength="254" autocomplete="off" placeholder="teammate@yourshop.com"></div>`}
      <div class="field"><label for="user-role">Their role</label><select id="user-role" name="role">${["Cashier", "Manager", "Administrator"].map((role) => `<option${user?.role === role ? " selected" : ""}>${role}</option>`).join("")}</select></div>
      <div class="field"><label for="user-password">Initial password${editing ? " · optional" : ""}</label><input id="user-password" name="password" type="password" minlength="10" maxlength="256" autocomplete="new-password" ${editing ? `placeholder="Leave blank to keep their current password"` : `required placeholder="At least 10 characters"`}></div>
      ${editing ? `<div class="field"><label for="user-active">Sign-in status</label><select id="user-active" name="is_active"><option value="true"${user.is_active ? " selected" : ""}>Active — can sign in</option><option value="false"${!user.is_active ? " selected" : ""}>Inactive — signed out</option></select></div>` : ""}
      <div class="modal-actions"><button class="secondary-btn" type="button" data-action="close-modal">Not now</button><button class="primary-btn" type="submit">${editing ? "Save changes" : "Create account"}</button></div>
    </form>
  `);
}

async function receiptDialog(saleId) {
  try {
    const { sale } = await api(`/api/sales/${saleId}`);
    const items = sale.items.map((item) => `<div class="receipt-line"><span>${escapeHtml(item.product_name)}<span class="cell-sub"> × ${item.quantity} at ${escapeHtml(fmt(item.unit_price))}</span></span><span>${escapeHtml(fmt(item.line_total))}</span></div>`).join("");
    setModal(`
      <div class="modal-heading"><div></div><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>
      <div id="receipt-print">
        <div class="receipt-brand"><div class="brand-mark">c.</div><h2 class="receipt-title">Cedar &amp; Grain</h2><p class="receipt-details">Daily goods, carefully chosen · Kampala, Uganda</p><p class="receipt-details">Thank you for shopping local.</p></div>
        <hr class="receipt-divider">
        <div class="receipt-line"><span>Receipt</span><strong>${escapeHtml(sale.receipt_number)}</strong></div>
        <div class="receipt-line"><span>Date</span><span>${escapeHtml(fmtDate(sale.created_at))}</span></div>
        <div class="receipt-line"><span>Cashier</span><span>${escapeHtml(sale.cashier_name)}</span></div>
        <div class="receipt-line"><span>Payment</span><span>${escapeHtml(sale.payment_method)}</span></div>
        ${sale.status === "refunded" ? `<div class="receipt-line"><strong>STATUS</strong><strong>REFUNDED · ${escapeHtml(sale.refund_reason)}</strong></div>` : ""}
        <hr class="receipt-divider">
        <div class="receipt-items">${items}</div>
        <hr class="receipt-divider">
        <div class="receipt-line"><span>Subtotal</span><span>${escapeHtml(fmt(sale.subtotal))}</span></div>
        ${sale.discount_percent ? `<div class="receipt-line"><span>Discount (${sale.discount_percent}%)</span><span>−${escapeHtml(fmt(sale.discount_amount))}</span></div>` : ""}
        <div class="receipt-line receipt-total"><span>Total</span><span>${escapeHtml(fmt(sale.total))}</span></div>
        <p class="receipt-thanks">Made with care. Come by again soon! 🌿</p>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-action="close-modal">Close</button><button class="primary-btn" data-action="print-receipt">Print receipt</button></div>
    `);
  } catch (error) {
    showToast(error.message, true);
  }
}

function refundDialog(saleId) {
  setModal(`
    <div class="modal-heading"><div><h2>Put this sale right</h2><p>All items will return to stock and be recorded in the stock history.</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>
    <form id="refund-form" data-id="${saleId}">
      <div class="field"><label for="refund-reason">What is the reason for the refund?</label><textarea id="refund-reason" name="reason" maxlength="200" required placeholder="A clear note helps the team understand what happened."></textarea></div>
      <div class="modal-actions"><button class="secondary-btn" type="button" data-action="close-modal">Keep the sale</button><button class="danger-btn" type="submit">Confirm refund</button></div>
    </form>
  `);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const contents = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8;" }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function loadCoreData() {
  const [dashboard, meta] = await Promise.all([api("/api/dashboard"), api("/api/meta")]);
  state.dashboard = dashboard;
  state.meta = meta;
  state.categories = ["All products", ...meta.categories];
}

async function loadProducts() {
  const params = new URLSearchParams({ active: state.view === "products" && state.includeArchived ? "all" : "active" });
  const products = await api(`/api/products?${params}`);
  state.products = products.products;
  state.categories = ["All products", ...new Set([...state.categories.slice(1), ...products.products.map((product) => product.category)])];
}

function salesFiltersFromControls() {
  return {
    search: app.querySelector(".sales-search")?.value.trim() || "",
    from: app.querySelector(".sales-from")?.value || "",
    to: app.querySelector(".sales-to")?.value || "",
    cashier: app.querySelector(".sales-cashier")?.value || "",
    payment: app.querySelector(".sales-payment")?.value || "",
  };
}

async function loadSales(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const { sales } = await api(`/api/sales?${params}`);
  state.sales = sales;
  const hashQuery = params.toString();
  window.history.replaceState(null, "", `#${state.view}${hashQuery ? `?${hashQuery}` : ""}`);
}

async function loadActivity(filters = state.activityFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const { activity } = await api(`/api/activity?${params}`);
  state.activity = activity;
  state.activityFilters = { ...filters };
}

async function loadReports(from, to) {
  const range = { ...defaultRange(), from: from || defaultRange().from, to: to || todayInput() };
  state.report = null;
  render();
  const params = new URLSearchParams(range);
  state.report = await api(`/api/reports?${params}`);
}

async function refreshView({ preserve = true } = {}) {
  state.loadingView = true;
  try {
    const view = state.view;
    if (view === "dashboard") {
      const dashboard = await api("/api/dashboard");
      state.dashboard = dashboard;
    }
    if (["pos", "products", "inventory"].includes(view)) await loadProducts();
    if (["sales", "dashboard"].includes(view) && view === "dashboard" && state.user.role !== "Cashier") {
      state.sales = state.dashboard.recent_sales;
    } else if (view === "sales") {
      const currentFilters = preserve ? Object.fromEntries(new URLSearchParams(window.location.hash.split("?")[1] || "")) : {};
      await loadSales(currentFilters);
    }
    if (view === "inventory") {
      const { movements } = await api("/api/stock-movements");
      state.movements = movements;
    }
    if (view === "team") {
      const { users } = await api("/api/users");
      state.activeUsers = users;
    }
    if (view === "activity") await loadActivity();
    if (view === "reports") {
      const { from, to } = state.report || defaultRange();
      if (!state.report) await loadReports(from, to);
    }
    render();
  } catch (error) {
    render();
    showToast(error.message, true);
  } finally {
    state.loadingView = false;
  }
}

async function authenticated(user) {
  state.user = user;
  state.view = "dashboard";
  state.cart = [];
  state.discount = 0;
  try {
    await loadCoreData();
    render();
    await refreshView();
  } catch (error) {
    state.user = null;
    loginView(error.message);
  }
}

function navigate(view) {
  if (!viewTitles[view]) return;
  if ((["products", "inventory", "reports", "activity"].includes(view) && state.user.role === "Cashier") || (view === "team" && state.user.role !== "Administrator")) {
    showToast("You do not have access to that page.", true);
    return;
  }
  state.view = view;
  state.mobileNavOpen = false;
  if (view === "dashboard") state.dashboard = null;
  if (["products", "inventory"].includes(view)) state.productSearch = "";
  if (view === "pos") state.category = "All products";
  if (view !== "reports") state.report = null;
  if (view === "sales") state.sales = [];
  window.scrollTo(0, 0);
  render();
  refreshView({ preserve: false });
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || !product.is_active || product.stock_quantity === 0) return showToast("That product is out of stock.", true);
  const inCart = state.cart.find((item) => item.id === productId);
  if (inCart) {
    if (inCart.quantity >= product.stock_quantity) return showToast(`Only ${product.stock_quantity} ${product.name} remain.`, true);
    inCart.quantity += 1;
  } else {
    state.cart.push({ ...product, quantity: 1 });
  }
  render();
}

function changeQuantity(productId, amount) {
  const item = state.cart.find((product) => product.id === productId);
  const product = state.products.find((entry) => entry.id === productId);
  if (!item || !product) return;
  if (amount > 0 && item.quantity >= product.stock_quantity) {
    showToast(`Only ${product.stock_quantity} ${product.name} remain.`, true);
    return;
  }
  item.quantity += amount;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.id !== productId);
  render();
}

async function completeSale(button) {
  if (!state.cart.length) return;
  button.disabled = true;
  const items = state.cart.map(({ id, quantity }) => ({ product_id: id, quantity }));
  try {
    const { sale } = await post("/api/sales", {
      items,
      discount_percent: state.discount,
      payment_method: state.payment,
    });
    state.cart = [];
    state.discount = 0;
    showToast(`Sale complete. Receipt ${sale.receipt_number}.`);
    await loadCoreData();
    await loadProducts();
    await refreshView();
    await receiptDialog(sale.id);
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

async function applySalesFilters() {
  const filters = salesFiltersFromControls();
  if (filters.from && filters.to && filters.from > filters.to) {
    showToast("Start date must not be after end date.", true);
    return;
  }
  try {
    await loadSales(filters);
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}

function handleProductForm(form) {
  const formData = new FormData(form);
  const editing = Boolean(form.dataset.id);
  const payload = {
    name: formData.get("name").trim(),
    sku: formData.get("sku").trim(),
    category: formData.get("category").trim(),
    image_url: formData.get("image_url").trim(),
    cost_price: Number(formData.get("cost_price")),
    selling_price: Number(formData.get("selling_price")),
    min_stock_level: Number(formData.get("min_stock_level")),
  };
  if (!editing) payload.stock_quantity = Number(formData.get("stock_quantity"));
  return (editing ? patch(`/api/products/${form.dataset.id}`, payload) : post("/api/products", payload));
}

function submitForm(form) {
  form.querySelector('[type="submit"]').disabled = true;
  if (form.id === "login-form") {
    const data = new FormData(form);
    post("/api/auth/login", { email: data.get("email").trim(), password: data.get("password") })
      .then(({ user }) => authenticated(user))
      .catch((error) => loginView(error.message));
    return;
  }
  if (form.id === "product-form") {
    handleProductForm(form).then(async () => {
      clearModal();
      showToast("Product saved. The shelves are looking good.");
      await loadProducts();
      await refreshView();
    }).catch((error) => {
      form.querySelector('[type="submit"]').disabled = false;
      showToast(error.message, true);
    });
    return;
  }
  if (form.id === "stock-form") {
    const data = new FormData(form);
    post(`/api/products/${form.dataset.id}/stock`, {
      mode: data.get("mode"), quantity: Number(data.get("quantity")), reason: data.get("reason").trim(),
    }).then(async () => {
      clearModal();
      showToast("Stock count updated and added to the stock history.");
      await loadProducts();
      await refreshView();
    }).catch((error) => {
      form.querySelector('[type="submit"]').disabled = false;
      showToast(error.message, true);
    });
    return;
  }
  if (form.id === "user-form") {
    const data = new FormData(form);
    const editing = Boolean(form.dataset.id);
    const payload = { full_name: data.get("full_name").trim(), role: data.get("role") };
    if (editing) payload.is_active = data.get("is_active") === "true";
    else payload.email = data.get("email").trim();
    if (data.get("password")) payload.password = data.get("password");
    const save = editing ? patch(`/api/users/${form.dataset.id}`, payload) : post("/api/users", payload);
    save.then(async () => {
      clearModal();
      showToast(editing ? "Your teammate's access has been updated." : "A new teammate is ready to join the shop.");
      const { users } = await api("/api/users");
      state.activeUsers = users;
      render();
    }).catch((error) => {
      form.querySelector('[type="submit"]').disabled = false;
      showToast(error.message, true);
    });
    return;
  }
  if (form.id === "refund-form") {
    const data = new FormData(form);
    post(`/api/sales/${form.dataset.id}/refund`, { reason: data.get("reason").trim() })
      .then(async () => {
        clearModal();
        showToast("The sale has been refunded and its stock has been restored.");
        await loadCoreData();
        await refreshView();
      }).catch((error) => {
        form.querySelector('[type="submit"]').disabled = false;
        showToast(error.message, true);
      });
  }
}

async function exportInventory() {
  const { inventory } = await api("/api/inventory-report");
  downloadCsv("cedar-grain-inventory.csv", [["Product", "SKU", "Category", "In stock", "Minimum stock", "Buying cost (UGX)", "Selling price (UGX)", "Inventory value (UGX)"], ...inventory.map((p) => [p.name, p.sku, p.category, p.stock_quantity, p.min_stock_level, p.cost_price, p.selling_price, p.inventory_value])]);
}

document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  try {
    if (action === "navigate") return navigate(control.dataset.view);
    if (action === "toggle-password") {
      const password = document.getElementById("login-password");
      if (!password) return;
      password.type = password.type === "password" ? "text" : "password";
      control.textContent = password.type === "password" ? "Show" : "Hide";
      return;
    }
    if (action === "logout") {
      await post("/api/auth/logout", {});
      state.user = null;
      state.cart = [];
      state.dashboard = null;
      state.products = [];
      clearModal();
      loginView();
      return;
    }
    if (action === "mobile-nav") {
      state.mobileNavOpen = !state.mobileNavOpen;
      app.querySelector(".sidebar")?.classList.toggle("mobile-open", state.mobileNavOpen);
      return;
    }
    if (action === "category") {
      state.category = control.dataset.category;
      return render();
    }
    if (action === "add-cart") return addToCart(Number(control.dataset.id));
    if (action === "quantity") return changeQuantity(Number(control.dataset.id), Number(control.dataset.change));
    if (action === "checkout") return completeSale(control);
    if (action === "filter-sales") return applySalesFilters();
    if (action === "filter-activity") {
      const filters = {
        from: document.getElementById("activity-from").value,
        to: document.getElementById("activity-to").value,
        type: document.getElementById("activity-type").value,
        search: document.getElementById("activity-search").value.trim(),
      };
      if (filters.from && filters.to && filters.from > filters.to) return showToast("Start date must not be after end date.", true);
      await loadActivity(filters);
      return render();
    }
    if (action === "export-activity") {
      downloadCsv("cedar-grain-activity.csv", [
        ["Date", "Actor", "Event", "Summary", "Details", "Sale ID", "Product ID", "User ID"],
        ...state.activity.map((entry) => [entry.created_at, entry.actor_name, entry.event_type, entry.summary, JSON.stringify(entry.details), entry.sale_id, entry.product_id, entry.subject_user_id]),
      ]);
      return;
    }
    if (action === "add-product") return productForm();
    if (action === "edit-product") {
      const product = state.products.find((item) => item.id === Number(control.dataset.id));
      if (product) productForm(product);
      return;
    }
    if (action === "adjust-stock") {
      const product = state.products.find((item) => item.id === Number(control.dataset.id));
      if (product) stockForm(product);
      return;
    }
    if (action === "choose-image") {
      const imageInput = document.getElementById("product-image");
      if (!imageInput) return;
      imageInput.value = control.dataset.image;
      for (const choice of modalRoot.querySelectorAll(".image-choice")) {
        choice.classList.toggle("selected", choice === control);
      }
      return;
    }
    if (action === "toggle-product") {
      const product = state.products.find((item) => item.id === Number(control.dataset.id));
      if (!product) return;
      const restore = control.dataset.active !== "true";
      const message = restore ? "Restore this product and put it back on the shelves?" : "Archive this product? Its sales and stock history will be kept.";
      if (!window.confirm(message)) return;
      await patch(`/api/products/${product.id}`, { is_active: restore });
      showToast(restore ? "Product restored." : "Product archived. Its history stays safe.");
      await loadProducts();
      return refreshView();
    }
    if (action === "receipt") return receiptDialog(Number(control.dataset.id));
    if (action === "refund") return refundDialog(Number(control.dataset.id));
    if (action === "print-receipt") {
      window.print();
      return;
    }
    if (action === "add-user") return userForm();
    if (action === "edit-user") {
      const user = state.activeUsers.find((item) => item.id === Number(control.dataset.id));
      if (user) userForm(user);
      return;
    }
    if (action === "run-report") {
      const from = document.getElementById("report-from").value;
      const to = document.getElementById("report-to").value;
      if (!from || !to) return showToast("Choose a start date and an end date.", true);
      if (from > to) return showToast("Start date must not be after end date.", true);
      await loadReports(from, to);
      return render();
    }
    if (action === "export-sales-report") {
      if (!state.report) return;
      const r = state.report;
      downloadCsv(`cedar-grain-sales-${r.from}-to-${r.to}.csv`, [["Receipt", "Date", "Cashier", "Payment", "Status", "Subtotal (UGX)", "Discount (UGX)", "Sales (UGX)"], ...r.sales.map((s) => [s.receipt_number, s.created_at, s.cashier_name, s.payment_method, s.status, s.subtotal, s.discount_amount, s.total])]);
      return;
    }
    if (action === "export-inventory") {
      await exportInventory();
      return;
    }
    if (action === "close-modal") return clearModal();
    if (action === "backdrop" && event.target === control) return clearModal();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.addEventListener("submit", (event) => {
  if (["login-form", "product-form", "stock-form", "user-form", "refund-form"].includes(event.target.id)) {
    event.preventDefault();
    if (event.target.reportValidity()) submitForm(event.target);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "pos-search") {
    const cursor = event.target.selectionStart;
    state.productSearch = event.target.value;
    const inputValue = state.productSearch;
    render();
    const replacement = document.getElementById("pos-search");
    replacement.focus();
    replacement.setSelectionRange(cursor, cursor);
    if (replacement.value !== inputValue) replacement.value = inputValue;
  }
  if (event.target.id === "management-product-search") {
    state.productSearch = event.target.value;
    const pageTop = window.scrollY;
    render();
    window.scrollTo(0, pageTop);
    document.getElementById("management-product-search")?.focus();
    document.getElementById("management-product-search")?.setSelectionRange(state.productSearch.length, state.productSearch.length);
  }
  if (event.target.id === "discount-input") {
    const discount = Number(event.target.value);
    if (Number.isFinite(discount) && discount >= 0 && discount <= 100) {
      const cursor = event.target.selectionStart;
      state.discount = discount;
      const top = window.scrollY;
      render();
      window.scrollTo(0, top);
      const replacement = document.getElementById("discount-input");
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    }
    if (event.target.id === "product-image") {
      const selectedImage = event.target.value.trim();
      for (const choice of modalRoot.querySelectorAll(".image-choice")) {
        choice.classList.toggle("selected", choice.dataset.image === selectedImage);
      }
    }
  }
  if (event.target.classList.contains("sales-search")) {
    state.salesSearch = event.target.value;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "payment-method") state.payment = event.target.value;
  if (event.target.id === "stock-mode") {
    const quantity = document.getElementById("stock-quantity");
    if (quantity) quantity.min = event.target.value === "set" ? "0" : "1";
  }
  if (event.target.id === "discount-input") {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      showToast("Discount must be between 0% and 100%.", true);
      event.target.value = state.discount;
    } else {
      state.discount = value;
      render();
    }
  }
  if (event.target.id === "inventory-filter" || event.target.id === "product-status-filter") {
    const filter = event.target.value;
    const rows = event.target.id === "inventory-filter"
      ? app.querySelectorAll("[data-product-stock]")
    : [];
    if (event.target.id === "inventory-filter") {
      for (const row of rows) {
        const quantity = Number(row.dataset.quantity);
        const minimum = Number(row.dataset.minimum);
        row.hidden = filter === "low" ? quantity === 0 || quantity > minimum : filter === "out" ? quantity > 0 : false;
      }
    } else {
      state.includeArchived = filter === "all";
      loadProducts().then(() => render()).catch((error) => showToast(error.message, true));
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalRoot.firstChild) clearModal();
  if (event.key === "Enter" && event.target.id === "pos-search" && state.products.length) {
    const term = event.target.value.trim().toLowerCase();
    const match = term ? state.products.find((product) => product.is_active && `${product.name} ${product.sku}`.toLowerCase().includes(term)) : null;
    if (match) addToCart(match.id);
  }
});

async function start() {
  try {
    const { user } = await api("/api/session");
    await authenticated(user);
  } catch {
    loginView();
  }
}

start();
