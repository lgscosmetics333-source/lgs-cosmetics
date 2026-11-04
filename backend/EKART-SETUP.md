# Ekart Elite shipping setup

Implemented against the supplied Ekart OpenAPI 3.8.10 (`spec.yaml`) and its V3 serviceability endpoint. No third-party SDK is needed. The API origin is `https://app.elite.ekartlogistics.in`.

## Account and pickup prerequisites

Complete Ekart account/KYC activation and confirm that the API user is enabled. The API login uses Client ID, API username and API password; a dashboard login is not assumed to have API access. Token expiry comes from `expires_in`, and the backend refreshes it automatically.

Register the pickup address in Ekart. `EKART_PICKUP_ALIAS` must exactly match the registered address alias, and `EKART_PICKUP_PINCODE` must be its real six-digit PIN. A different registered return alias can be set in `EKART_RETURN_ALIAS`. Do not invent a GSTIN; leave `EKART_SELLER_GSTIN` empty for an unregistered seller and confirm with Ekart that the account permits this.

## Backend environment variables

On Hostinger select the **backend app** (`peru-pigeon-257481.hostingersite.com`) → Environment variables. Use the Ekart entries in `.env.example`; never upload the local `.env` to GitHub or put credentials in `VITE_` variables.

Required for activation:

| Variable | Purpose |
| --- | --- |
| `EKART_CLIENT_ID` | Client ID displayed by Ekart |
| `EKART_USERNAME` / `EKART_PASSWORD` | API user's credentials |
| `EKART_PICKUP_PINCODE` | Registered pickup PIN |
| `EKART_PICKUP_ALIAS` | Exact registered pickup address alias |
| `EKART_SELLER_NAME` / `EKART_SELLER_ADDRESS` | Actual seller invoice identity/address |
| `EKART_QUOTE_SECRET` | Random server-only signing secret, at least 32 characters |
| `EKART_ENABLED` | Keep `false` until account access and product measurements are verified |

Additional settings:

- `EKART_RATE_MODE=fixed` uses Rs40 delivery and free shipping from Rs900 before discounts. Ekart availability and an estimate are still checked.
- `EKART_RATE_MODE=live` charges the V3 forward delivered estimate, including its quoted taxes and COD fees, rounded up to the nearest paisa. Free shipping is not applied in this mode. Review any storefront free-shipping promotions before switching to live rates.
- `EKART_SERVICE=SURFACE` (default) or `EXPRESS`.
- `EKART_PACKAGING_WEIGHT_GRAMS` and `EKART_BOX_PADDING_CM` account for additional outer packaging, beyond the measurements of individual protected units. Both default to zero; enter measured values if required.
- `EKART_WEBHOOK_SECRET`: random 30-character hex value.
- `EKART_PUBLIC_BACKEND_URL=https://peru-pigeon-257481.hostingersite.com`.

Local setup/check commands (run from repository root):

```powershell
node backend/scripts/ekart-setup.mjs --init-local
node backend/scripts/ekart-setup.mjs --check-connection
node backend/scripts/ekart-setup.mjs --addresses
```

`--init-local` preserves credentials and generates local signing/webhook secrets without printing them. Put the corresponding secrets into the backend's Hostinger Environment Variables through its private UI. `--addresses` prints only registered aliases and PIN codes. `--check-connection` does not create a shipment.

## Product measurements and checkout

In Admin → Products → Edit, fill packed unit weight (grams), length, width and height (whole centimeters). Use the largest protected unit for products with different variants. The cart estimate stacks units and adds configured packaging; this is a conservative packing estimate, not a packing optimizer. Admin must confirm the real final parcel dimensions before booking. The final courier charge may change after measurement or courier weighing.

With shipping enabled, delivery orders need a successful server quote. Unserviceable PIN/payment combinations, missing measurements and unavailable Ekart responses block delivery checkout; store pickup remains available. Signed quotes expire after ten minutes and bind the customer, cart, PIN, payment method, coupon, product prices and parcel. Order creation revalidates these values and stock. A changed or expired quote must be refreshed.

The V3 endpoint supplies serviceability, estimated transit time and forward pricing, avoiding the incomplete V1 rate schema in the supplied specification. COD quotes include the amount to collect, including the customer delivery fee; rate calculation is bounded until stable. Customer shipping totals are never read from browser-supplied prices.

## Dispatch from Admin → Orders

1. Confirm the order. Online payments must already be verified as Paid.
2. Check actual packed grams/cm and actual invoice tax (zero when no tax is charged).
3. Press **Book Ekart shipment** and confirm. This is a real courier booking and can incur charges.
4. Download the shipping label and prepare the parcel for Ekart pickup according to the account's pickup arrangement. Booking alone does not mark the parcel Shipped; a pickup/transit scan does.

The order number is the Ekart order/invoice reference. Only one booking is permitted per customer order. Booking failures/timeouts are placed in **Needs review** because the courier might have accepted the request. Check Ekart before any retry. If a shipment exists, use **Verify and attach AWB**; the server verifies the AWB's order number with Ekart. If no shipment exists, contact the operator/developer to resolve the reservation after confirmation from Ekart; there is deliberately no automatic second booking.

**Cancel shipment** is available before pickup. It leaves the customer order open. After confirmed courier cancellation, cancel the customer order separately to return reserved stock. If cancellation was ambiguous, use **Verify cancellation with Ekart** once Ekart reports Cancelled/Seller Cancelled. Shipped returns/RTO require operator handling; they do not automatically release stock or refund money. New bookings after a cancelled shipment are not supported on the same order.

## Tracking/webhooks

The tracking worker checks up to 20 pending shipments every five minutes. Admin can refresh immediately (one-minute minimum interval per order). Order detail pages display the last courier status/location/estimated delivery and a public Ekart tracking link. Delivery scans for COD mean money collected by the courier, **not bank settlement**.

For prompt updates, deploy backend and frontend first, set the same webhook secret in the deployed backend and the operator's configuration, then run:

```powershell
node backend/scripts/ekart-setup.mjs --register-webhook
```

This explicitly registers the `track_updated` webhook on the configured public HTTPS backend. The secret URL is hidden by the helper. The supplied specification does not define an HMAC header/algorithm, so the receiver authenticates a random secret URL and then fetches the authoritative tracking state from Ekart. It never applies a status asserted by a callback. Treat the callback URL as a secret. The background worker remains a fallback if callbacks fail. Browser challenges must not block the webhook route.

Duplicate/older scans do not create repeated events or downgrade order status. RTO Delivered is not treated as customer Delivered. COD is marked Paid on a verified customer delivery scan; refunds and courier settlements remain manual.

## Deploy and verify

Deploy the code to both existing GitHub-connected Hostinger apps; keep published Git history intact. Set variables in the backend app, not the frontend. The existing frontend `/api/**` proxy also covers shipping routes. The backend's existing startup model sync adds the new nullable product/order columns; back up the live database before deployment as with other schema updates.

Check Admin → Orders → **Check API connection**, add product measurements, then enable `EKART_ENABLED=true` and redeploy/restart the backend. Validate an allowed and disallowed PIN, COD and prepaid quotes, and store pickup. Use a controlled real booking only after account activation and operator confirmation.

Automated verification uses mocked provider calls and never creates a real Ekart shipment:

```powershell
node backend/tests/ekart.test.mjs
# Optional local MySQL integration: creates and cleans fixture records.
$env:EKART_INTEGRATION_TEST='1'
node backend/tests/ekart.test.mjs
```

The database verification performs the repository's existing model sync, so run it only on a local/test database. It covers checkout price signatures, inventory, concurrent booking, ambiguous booking recovery, tracking, cancellation, COD payment state, admin authentication/roles, PDF labels and webhook trust boundaries.

Startup/migration/seed schema sync now removes redundant Sequelize-generated single-column unique indexes before applying model changes. One equivalent uniqueness constraint, all primary/custom indexes and prefix indexes are retained. This prevents repeated restarts from exhausting MySQL's 64-index limit.
