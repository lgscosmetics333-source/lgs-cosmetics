# One Hostinger website: frontend + backend

Deploy this repository as **one Node.js Web App**. The single process serves the storefront, admin, API, customer authentication and uploaded images on `https://lgscosmetics.com`. MySQL is the separate database service supplied by your hosting plan; a second backend website is not needed.

## Hostinger deployment settings

| Setting                         | Value                                  |
| ------------------------------- | -------------------------------------- |
| Repository                      | `lgscosmetics333-source/lgs-cosmetics` |
| Branch                          | `main`                                 |
| Root directory                  | `./`                                   |
| Framework                       | **Nitro**                              |
| Node.js                         | **22.x**                               |
| Package manager                 | **npm**                                |
| Install command, if shown       | `npm ci --include=dev`                 |
| Build command                   | **`npm run build:hostinger`**          |
| Output directory                | **`.output`**                          |
| Entry file (relative to output) | **`app.mjs`**                          |

Use the custom build command above, rather than the generic `npm run build`. The generic build remains available for existing Vercel/Lovable integrations. Do not start `server/index.mjs` on Hostinger: it is now imported middleware, not the combined app's listener. Do not use `npm run dev`, two child processes or a separate backend port in production.

`build:hostinger` selects the Nitro Node middleware preset automatically, then packages the API and its locked production dependencies into `.output/backend`. The output contains everything needed to run `node .output/app.mjs`. No development `.env`, database dump, existing upload or test file is included. `npm ci` at the repository root installs both frontend and backend dependencies through the existing postinstall script.

## Hostinger environment variables

Add these in the **same website's Environment variables** screen, before deployment. Use the actual MySQL database details from your hosting account and two different random secrets of at least 32 characters.

```dotenv
NODE_ENV=production
DB_HOST=YOUR_MYSQL_HOST
DB_PORT=3306
DB_NAME=YOUR_DATABASE_NAME
DB_USER=YOUR_DATABASE_USER
DB_PASSWORD=YOUR_DATABASE_PASSWORD
JWT_SECRET=YOUR_RANDOM_ADMIN_SECRET
CUSTOMER_AUTH_SECRET=YOUR_DIFFERENT_RANDOM_AUTH_SECRET
FRONTEND_URL=https://lgscosmetics.com
CUSTOMER_AUTH_URL=https://lgscosmetics.com
RAZORPAY_ENABLED=false
RESEND_ENABLED=false
RESEND_DOMAIN_VERIFIED=false
EKART_ENABLED=false
```

Hostinger supplies `PORT`; remove any manually configured `PORT=5000`. The app listens on `0.0.0.0` on that assigned port. Remove old `VITE_API_URL`, `VITE_API_MODE` and `LGS_INTERNAL_API_ORIGIN` values from Hostinger; the combined build uses relative `/api` URLs in the browser and creates its own loopback API URL for SSR. A `DEPLOY_TARGET` environment variable is no longer required: the build script selects Hostinger itself.

Use the same public origin for both authentication URLs, without a trailing slash. If the canonical domain changes, update these values and the canonical origin in `src/lib/seo.ts` together.

For production images, set **`UPLOAD_DIR`** to an absolute, writable directory outside the deployment output which Hostinger preserves across releases. Restore the old backend's `uploads` files into this directory. If it is omitted, uploads are stored in the app's `backend/uploads` directory and may be replaced by the next deployment. Confirm persistence with Hostinger before accepting customer orders.

Existing database records and uploaded images are not in GitHub. Reuse the existing MySQL database credentials or migrate its data securely; the build does not seed or replace your products. Startup runs the existing application/auth schema initialization. Do not run the development seed script on a live customer database.

## Optional database import files

The app creates and updates its tables automatically after it connects to MySQL. For a new, empty Hostinger database, `backend/database/hostinger-import.sql` provides the core table structure. After importing it, import `backend/database/seed.sql` to add the 5 public product categories and 14 catalog products.

If you want to reuse an existing database, keep its data and point the app's `DB_*` environment variables at it. Let the app start and apply schema updates first; then import `seed.sql` only if you want missing catalog entries added. Its `INSERT IGNORE` statements leave existing product/category slugs unchanged. Do not import the structure file into an existing production database.

The seed file does not contain customer records, orders, reviews, uploaded files, or an admin account. Better Auth creates its customer-auth tables at first successful startup. To regenerate both files after catalog or image changes, run `npm run build:hostinger` and then `node backend/scripts/export-hostinger-database.mjs`.

## Start and verify

After deploying, runtime logs should show `LGS frontend + API listening on port ...` and, after MySQL connects, `LGS database and customer authentication are ready.`

- `/` renders the storefront, metadata and GTM container.
- `/api/health` returns HTTP 200 only after database/auth initialization succeeds.
- `/api/products` returns real catalog data from the same website.
- `/admin/login` and `/account` use this same origin. Verify a real sign-in/session, then verify admin changes and a test checkout.
- `/uploads/...` serves your restored product images.
- `/robots.txt`, `/sitemap.xml` and `/google1c15fb62e2b5282c.html` are available on the same domain.

If MySQL is unavailable, the listener and static storefront remain online, API requests return 503 and initialization retries every 30 seconds. The sitemap also returns a temporary 503 instead of removing real products from the index. Check Runtime logs and correct the database credentials/host; a visible homepage alone does not establish that checkout and authentication work.

Configure Razorpay, email and Ekart separately using `backend/COMMERCE-SETUP.md`. Leave their enable flags false until configured. For this combined deployment, `EKART_PUBLIC_BACKEND_URL`, if enabled, is also `https://lgscosmetics.com`; configure provider callbacks/webhooks on this same domain.

## Local verification

```sh
npm ci
npm run build:hostinger
npm run check:hostinger
npx tsc --noEmit
```

The packaged-app test exercises one HTTP listener, API routing, SSR product content, auth adapter/body/cookie forwarding, protected admin writes, static assets and unavailable-database behavior. It mocks database reads and authentication persistence; it does not validate real MySQL access, payment/shipping providers or a deployed customer login. For a local run with a configured database, use `npm start` after `npm run build:hostinger`.
