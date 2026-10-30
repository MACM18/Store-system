# Daymark Store Desk

A single-store operations app for daily cash reconciliation, checkout, inventory, and team access. Built with Next.js, PostgreSQL, and Prisma.

## Local development

1. Install Node.js 24 and pnpm 12.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a reachable PostgreSQL database.
3. Run `pnpm install`.
4. Run `pnpm db:migrate` to create the tables.
5. Run `pnpm dev`, open the local app, and complete the one-time owner setup.

The first setup asks for the store name, ISO currency, store timezone, and owner credentials. The owner password must be at least 12 characters. Store dates use the selected timezone.

## Roles

- **Owner:** Full access, team creation, and device-session revocation.
- **Manager:** Products and prices, stock, cash movements, expenses, checkout, and reporting.
- **Cashier:** Checkout, drawer opening and closing, and cash movements.

Each signed-in device gets its own server-side session. Sessions expire after 14 days by default; set `SESSION_DAYS` between 1 and 60 to change that. Sessions use secure, HTTP-only cookies in production.

## Deployment to Dokploy

1. Create a Dokploy application that deploys the GHCR image `ghcr.io/macm18/store-system:latest`. Enable auto-deploy from its webhook and configure the private GHCR registry credentials if the package is private.
2. Configure `DATABASE_URL` to the PostgreSQL service reachable from the application container, `SESSION_DAYS` if desired, and `PORT=3000`.
3. Add a GitHub Actions repository secret named `DOKPLOY_WEBHOOK_URL` containing the HTTPS deployment webhook URL.
4. Push to `main` (or run the workflow manually). GitHub Actions builds and publishes the Docker image, then calls the checked-in Python webhook script.

The container runs `prisma migrate deploy` before starting Next.js. `/api/health` returns HTTP 200 only when PostgreSQL is reachable, and returns 503 otherwise. Do not set a custom Dokploy start command.

## Money and inventory

Money is stored as integer minor units for the configured currency. Each restock stores its own unit buying price, creates an inventory batch, and records the purchase as an expense using the selected payment method. Checkout consumes inventory batches oldest-first and captures buying cost on sale lines for estimated gross margin. Manual stock count corrections are audited separately and do not create purchase expenses.
