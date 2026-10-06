# DVN POS · Cedar & Grain

A practical, mobile-friendly point-of-sale and inventory application. Its Node.js HTTP server and built-in SQLite database run together as one small deployment; there is no frontend build, external database service, or npm runtime dependency.

## Project structure

```text
.
├── server.js           # HTTP server, SQLite schema, demo catalog, and API
├── public/
│   ├── index.html      # Application entry point
│   ├── app.js          # Register, inventory, reporting, and product gallery
│   ├── styles.css      # Responsive application styles
│   └── images/         # Original, locally hosted product illustrations
├── test/
│   └── pos.test.js     # End-to-end API and catalog-migration tests
├── Dockerfile          # Production container image
├── render.yaml         # Render deployment blueprint
└── README.md           # Setup, features, deployment, and database guide
```

## What’s included

- Secure, server-managed accounts with Administrator, Manager, and Cashier roles. Passwords are individually salted and hashed with Node.js `scrypt`; sign-in sessions use random opaque tokens stored only as SHA-256 hashes in an `HttpOnly`, `SameSite=Strict` cookie.
- A fast product-search register, category filters, stock-aware cart, quantity controls, configurable percentage discounts, four payment methods, transactional checkout, and printable itemized receipts.
- Product catalog with 20 realistic sample products, 20 original self-hosted product illustrations, category, SKU, buying/selling prices, opening stock, low-stock threshold, and reversible archive/restore. Choose an illustration while adding a product, or paste an authorized HTTPS image URL.
- Transactional stock additions, reductions, and exact-count adjustments; dated, attributed stock movement history; automated checkout deductions; and refund returns that restore stock exactly once.
- A unified, manager/administrator-only activity history for completed sales, refunds, stock changes, product catalog edits, and team-account changes. The dashboard shows recent events; the full history supports date/category/text filters and CSV export. Audit entries commit atomically with the underlying change and never contain passwords.
- Filterable sale history; cashier-specific transaction and receipt access; date-filtered sales, profit, cashier and payment reports; best sellers; inventory valuation; and CSV downloads.
- Sales dashboard with seven-day sales chart, payment breakdown, recent transactions, low-stock alerts, gross profit, and daily, weekly, and monthly figures.
- An explicit application health endpoint at `/health` for uptime monitors and deployment providers.

## Technology

- Node.js 24 and the standard-library `node:http`, `node:crypto`, and built-in `node:sqlite` modules.
- SQLite for persistent application state, sessions, sales, stock, and audit history.
- Plain HTML, modern responsive CSS, and vanilla browser JavaScript.
- Docker and Render for a readily reproducible deployment with a persistent database disk.
- Node’s built-in test runner and native `fetch` for API integration tests.

**Required runtime:** Node.js `>=22.13.0`; Node.js 24 LTS is recommended.

## Sample product catalog

For a usable demo without inventing sales or analytics, the shop starts with 20 illustrative products:

| Category | Sample products |
| --- | --- |
| Bakery | Fresh Sourdough Loaf |
| Beverages | Arabica Coffee 500g, Black Tea 100 Bags, Spring Water 1.5L, Mango Juice 1L |
| Dairy | Farmhouse Butter 250g |
| Home & Care | Bath Soap 125g, Laundry Detergent 1kg, Amber Soy Candle, Cotton Market Tote, Botanical Shampoo 400ml |
| Pantry | Wildflower Honey 350g, Long Grain Rice 2kg, Olive Cooking Oil 1L, Raw Cane Sugar 1kg, Smoked Paprika 100g |
| Snacks | Milk Chocolate Bar, Roasted Cashews 250g, Butter Biscuits 200g |
| Stationery | Notebook A5 |

The images are original SVG illustrations served by the application from `public/images/`. To use one when adding or editing a product, select it in the built-in illustration gallery; you can also supply a business-owned HTTPS image URL. Nothing in the sample catalog represents a real supplier, real stocktaking, or completed sale.

## Run locally

In PowerShell or a terminal with Node.js 24 installed:

```powershell
$env:POS_ADMIN_EMAIL = "owner@example.com"
$env:POS_ADMIN_PASSWORD = "choose-a-unique-password-of-16-chars"
npm.cmd start
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the configured administrator email and password. The first run creates `data/pos.sqlite`, the sample Cedar & Grain product catalog, and the administrator account. To keep an account you control, configure the initial administrator credentials **before** the first launch.

```powershell
npm.cmd test
```

SQLite is stored in `data/pos.sqlite`. Preserve that directory when restarting or updating the application. To serve a different port or put the SQLite file elsewhere, configure `PORT` and `POS_DB_PATH`.

## Deploy online with Render

This project includes a Dockerfile and [`render.yaml`](./render.yaml). From your own GitHub account:

1. Create a repository from this source and push it to GitHub.
2. In Render, create a new **Blueprint** from your repository.
3. Supply `POS_ADMIN_EMAIL` and `POS_ADMIN_PASSWORD` as private environment variables. Use a strong, unique password of at least 10 characters. The database administrator is initialized once on the first boot and credentials are **not** printed in the application logs or supplied as public test credentials.
4. Wait for Render's `/health` check to pass, then visit its assigned `https://` URL and sign in with **the credentials you privately configured**.
5. Verify you can create a product, ring up a sale, open and print its receipt, and view the saved sale after a redeploy. The mounted persistent disk at `/data` keeps SQLite and sessions across application restarts.
6. Add a Manager or Cashier from **Team & access** and provide their credentials privately to reviewers if needed. Do not share your administrator password or publish a screenshot with personal credentials.

The deployment blueprint provisions a paid Render Starter web service and persistent disk; cloud-provider fees and an account are the deploying owner's responsibility. Configure a custom domain through your host if a non-Render URL is desired. HTTPS is provided by the host's public `https://` URL; the application sets the `Secure` session-cookie attribute in `NODE_ENV=production`.

### Other hosting / Docker

Host on any **persistent** Node.js or Docker provider. For a container host, map a persistent disk to `/data`, set `POS_ADMIN_EMAIL`, `POS_ADMIN_PASSWORD`, and (if desired) `PORT`. Build using the provided Dockerfile:

```sh
docker build -t dvn-pos .
docker run -d --name dvn-pos --restart unless-stopped \
  -p 3000:3000 -v dvn-pos-data:/data \
  -e NODE_ENV=production \
  -e POS_ADMIN_EMAIL=owner@example.com \
  -e POS_ADMIN_PASSWORD='YOUR-UNIQUE-LONG-PASSWORD' \
  dvn-pos
```

Bind and preserve `/data`, keep host-level TLS in front of the app, and never publish secrets to Git. **Do not use ephemeral-filesystem hosting** for production: the SQLite catalog, orders, inventory, and users live in the configured file.

## Database schema

The application creates its SQLite tables on first start in `server.js`, with foreign keys and appropriate uniqueness, positive-quantity, stock, discount, and payment-method constraints:

| Table | Purpose |
| --- | --- |
| `users` | Full names, unique case-insensitive email, salted password hash, role, and activation state. |
| `sessions` | Hashed random session tokens, account foreign key, and expiry. |
| `products` | Product code/SKU, category, price in whole Ugandan shillings, stock, minimum stock, image URL, and archive state. |
| `sales` | Receipt, cashier, subtotal, percentage/amount discount, total, payment, completion/refund state and audit note. |
| `sale_items` | Itemized sale-time product name, SKU, quantity, selling price, purchase cost and line total; historical receipts survive product edits. |
| `stock_movements` | Signed stock change, resulting quantity, movement type, user, reason, timestamp, and associated sale/refund. |
| `activity_logs` | Actor, action category, human-readable summary, structured non-secret details, and optional sale/product/team references. |
| `app_settings` | Idempotent migration markers that preserve existing store data. |

All product prices and sales totals use **integer UGX** (not floating-point money). Receipt totals are authoritative server-side calculations; a cart never supplies the price or cost. Checkout, refunds, and stock adjustments are atomic SQLite transactions.

## Access policy

| Capability | Administrator | Manager | Cashier |
| --- | :---: | :---: | :---: |
| Search items, checkout, discounts, print receipt | Yes | Yes | Yes |
| View own transactions and receipts | Yes | Yes | Yes |
| View everyone’s transactions and receipts | Yes | Yes | No |
| Add/edit/archive products and adjust stock | Yes | Yes | No |
| View business reports, stock movement history, and activity history | Yes | Yes | No |
| Process refunds | Yes | Yes | No |
| Create accounts, edit roles, deactivate users | Yes | No | No |

Roles and sensitive actions are enforced on the server, not just hidden in the interface. Cashiers can only view their own receipts and transaction history. At least one active Administrator must remain. Password changes revoke other sessions; deactivating an account revokes all its sessions.

Audit history complements the detailed `stock_movements` ledger and sales records; it does not replace either. Each completed sale or refund and each product, inventory, or team-account change is logged in the same database transaction as its source change. Activity details exclude passwords and password hashes. Administrators and Managers can filter and export the latest 500 matching events; Cashiers cannot access the activity API or management page.

## Demo data and honest submissions

On an empty database, the app seeds the **20 illustrative Cedar & Grain products and original, self-hosted SVG product illustrations** listed above, with opening stock so the register and low-stock features can be tried immediately.

On existing databases, a one-time, idempotent catalog migration adds a starter product only if its SKU is not already in use. It preserves existing products, custom SKUs, product prices, stock counts, archive state, and transactions. It fills in illustrations for the original eight demo products only if their image is blank; later image choices are never overwritten. The migration records the opening stock of newly added demo products as clearly labeled stock movements.

The app seeds **no transactions, sales, performance, or profit**. Add your own products and create genuine test sales to demonstrate the application; clear out or replace the illustrative products before operating an actual shop. Unchanged starter credentials are intentionally documented as **not** publicly accessible test accounts.

This source includes the application, database schema, deployment blueprint, and this setup guide. **It does not claim to be a publicly hosted deployment, a configured reviewer account, an independently submitted GitHub repository, real business data, screenshots, or a demonstration video.** The person submitting the project must provision their own online host, repository, live URL, and test cashier account.

## Security and operations

- Run production behind a trusted HTTPS reverse proxy, set `NODE_ENV=production`, and restrict access to deployment secrets. Server-side request-origin validation protects mutating API requests.
- Use a strong `POS_ADMIN_PASSWORD`; the application refuses a new production database when it is omitted. Never reuse a shared example password for an internet-facing deployment.
- HTTP rate limits sign-in attempts per client address. Keep the application and its persistent database disk private and backed up according to the business's retention policy.
- Product pictures use original SVG illustrations served by the app itself, with local initials as a graceful fallback. The product editor includes a quick-pick gallery; images can alternatively use a business-owned or otherwise authorized HTTPS image URL.
- SQLite WAL supports reliable local single-host operation; use a deliberately selected, shared transactional database and deployment architecture before scaling writes across multiple application instances.
