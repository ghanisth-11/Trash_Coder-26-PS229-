# Kabadiwala Connect backend

Node.js and Express API for the PRD v3 marketplace: Firebase authentication, Firestore persistence, Cloudinary uploads, Gemini detection, operator QC, middleman aggregation, recycler priority, dual-confirmation deals, append-only ledger and OpenWA WhatsApp intake.

The backend intentionally remains at this repository root (`src/`, `test/`, `package.json`) while the separate Next.js UI lives under `frontend/`. The frontend uses Firebase client authentication and sends Firebase ID tokens to this API; it never receives Firebase Admin, Cloudinary, Gemini, or OpenWA credentials. The backend audit checklist is retained locally in `project-artifacts/documentation/docs/BACKEND-AUDIT.md`.

## Run locally

Requires Node.js 22 or newer, a Firebase project with Auth and Firestore enabled, and provider credentials for the integrations you use. No real credentials are included.

```powershell
npm ci
Copy-Item .env.example .env
# Fill .env with your credentials.
npm run dev
```

## Frontend integration

The frontend is a separate Next.js application in `frontend/`. Its Firebase Web SDK configuration is public browser configuration, while all provider secrets remain in the root backend `.env`.

```powershell
Set-Location -LiteralPath ".\frontend"
Copy-Item .env.local.example .env.local
# Fill the NEXT_PUBLIC_FIREBASE_* values from Firebase Console > Project settings > Your apps > Web app.
npm ci
npm run dev -- -p 3001
```

Keep the API running on port 3000 and open `http://localhost:3001`. The default local CORS allowlist already includes `http://localhost:3001`; restart the API if you change `CORS_ORIGINS`.

## Android app (Capacitor)

The Next.js frontend can be packaged as an Android app with Capacitor. Install Android Studio with the Android SDK, then run the following from `frontend/`:

```powershell
# Builds the static mobile bundle, copies it to the Android project, and syncs Capacitor.
npm run cap:sync

# Opens the generated Android project. Use Android Studio to run it on a device or build an APK.
npm run cap:android
```

The mobile bundle defaults to the deployed API URL. To use another API deployment, set `MOBILE_API_BASE_URL` before `npm run cap:sync`. For a Capacitor Android app, add `https://localhost` to the backend's `CORS_ORIGINS` environment variable.

The sign-in page supports email/password. Creating an account creates the Firebase identity first, then creates its backend profile through `POST /api/auth/profile`. Middleman and recycler accounts remain pending until an administrator verifies them. The UI submits known collector lots as optional-photo multipart requests and e-waste lots as required-photo multipart requests. It does not create direct bulk lots: category lots must be built from processed inventory through the backend workflow.

Run the durable background worker in a second terminal:

```powershell
npm run worker
```

For a compiled deployment:

```sh
npm run build
npm start
# Separate process, same environment:
node dist/worker.js
```

Use Firebase client SDK sign-in (phone or email) to obtain ID tokens. Send `Authorization: Bearer <Firebase ID token>` on protected endpoints. The server verifies revocation and reads the Firestore role for every protected request. Public endpoints are `GET /health` and `GET /api/categories`. Buyer shop endpoints require the matching authenticated role. The OpenWA webhook instead requires a valid shared-secret header.

Create a Firebase Auth user for the first administrator, then bootstrap its Firestore profile with server credentials:

```sh
npm run bootstrap-admin -- FIREBASE_UID
```

Normal users create a profile through `POST /api/auth/profile`. Self-registration allows kabadiwala, middleman and recycler only. Buyers must be verified by an administrator before offers, aggregation or priority subscriptions. Staff roles can only be assigned by an administrator. Account role changes are blocked while active listings, holdings or deals would become inconsistent.

### Local demo accounts

For a video/demo environment, create one Firebase account for each role plus an administrator:

```powershell
npm run seed-demo
```

The script is idempotent. It creates verified Firestore profiles for the Collector, Aggregator, Recycler and Admin roles, retaining their profile IDs when it updates a prior local demo seed. It never creates sample listings, prices, deals or ledger records.

| Role                   | Email                   | Password        |
| ---------------------- | ----------------------- | --------------- |
| Collector (Kabadiwala) | `kabadiwala@demo.local` | `kabadiwala123` |
| Middleman (Aggregator) | `middleman@demo.local`  | `middleman123`  |
| Recycler               | `recycler@demo.local`   | `recycler123`   |
| Administrator          | `admin@demo.local`      | `admin123`      |

These credentials are for demos only; do not reuse them outside a demo environment. Sign in as the demo administrator in the separate frontend to open `/admin`, where the protected API supplies platform statistics and account-verification controls.

## Environment

See `.env.example`. `FIREBASE_SERVICE_ACCOUNT_JSON` is the full service account JSON string; Application Default Credentials also work. Keep it server-side. `JWT_SECRET` is retained for compatibility with the brief and is currently unused because authentication uses Firebase exclusively.

OpenWA replaces Twilio completely. Run OpenWA as a separate, private Easy API service and configure its webhook plugin to POST to the exact HTTPS backend URL `https://YOUR_API_DOMAIN/api/whatsapp/openwa/webhook`. Set the same high-entropy `OPENWA_WEBHOOK_SECRET` in the OpenWA container and the backend. The backend uses OpenWA's `sendText` API for outgoing messages; `OPERATOR_ALERT_WHATSAPP` optionally routes QC alerts as WhatsApp messages. These messages are queued and retried.

The OpenWA runtime definition uses the current v5 webhook envelope and pins both OpenWA npm packages to `5.1.0`; upgrade those two packages together after validating the Easy API and webhook contract in a non-production session.

Set `CORS_ORIGINS` to comma-separated frontend origins. Set `TRUST_PROXY_HOPS` only to the known number of trusted reverse proxies. Production explicitly rejects Firebase emulator environment variables.

Production startup also requires `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` and `GEMINI_API_KEY`, and rejects a wildcard CORS origin. `GEMINI_MODEL` defaults to `gemini-2.5-flash`; only use a model name that supports the configured generation API. Request logs contain request ID, method, route, status and duration only—never tokens, request bodies or secrets.

### OpenWA container and AWS

The deployable OpenWA image definition is in [`openwa/`](openwa). Copy [`openwa/.env.example`](openwa/.env.example) to a private `openwa/.env`, fill the API key and webhook secret with different random values, and set the production backend webhook URL. The backend `.env` must use the same `OPENWA_API_KEY` and `OPENWA_WEBHOOK_SECRET`, with `OPENWA_API_URL` set to the private OpenWA service address.

```powershell
Copy-Item .\openwa\.env.example .\openwa\.env
docker build --tag kabadiwala-openwa:local .\openwa
docker run --init --env-file .\openwa\.env --publish 8080:8080 --volume openwa-sessions:/sessions kabadiwala-openwa:local
```

On first start, OpenWA presents a QR/link-code flow. Link a dedicated business WhatsApp number, then keep the `/sessions` volume: it contains the authenticated browser profile. For AWS, create a private ECR repository in the Console, build the image locally, and use the Console's generated **View push commands** to push it. Run it in ECS/Fargate with an encrypted EFS mount at `/sessions`, inject `WA_API_KEY` and `OPENWA_WEBHOOK_SECRET` through Secrets Manager, and keep port 8080 private to the backend security group/service. Expose only the backend's HTTPS webhook through an ALB. Never put the OpenWA session directory, API key, or webhook secret in ECR, source control, logs, or a public task definition.

## Firebase rules and local emulators

```sh
# Firebase CLI is included as a dev dependency. Install Java 21 or newer separately.
npx firebase emulators:start --project demo-kabadiwala --only auth,firestore
```

For an emulator run, set `FIREBASE_PROJECT_ID=demo-kabadiwala`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`. Configure the client SDK to use those same emulators. Use a real Firebase project and no emulator variables for live service integration.

Deploy rules and index configuration explicitly to your own project:

```sh
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

All direct client writes are denied, including admin clients. The API uses the Admin SDK, so its middleware and transactions are the authoritative write controls. Firestore rules permit scoped reads for live notifications, owned listings, deals, chat, ledger and staff QC. Buyer shops require a bearer token and the matching middleman/recycler role; their responses expose a restricted listing view. Client queries must include ownership filters because Firestore rules are not filters.

## API contract

JSON responses use conventional HTTP statuses. Errors have `{ "error": { "code", "message", "requestId" } }`. List endpoints return `{ "items": [], "nextCursor": null }`; pass `limit` (1–100) and `after` from the cursor. Cursors use stable document ID order. Chat messages have timestamps for client chronological sorting.

Category slugs: `electronic-battery`, `ram-storage`, `integrated-circuits`, `ewaste-cables`, `copper-scrap`, `paper`, `cardboard`, `plastic`, `metal`, `glass`, `mixed`, `other`. The AI category labels are normalized to slugs. Admin/QC/reference categories can also use a custom slug without `/`.

Money is INR. Reference `buyPrice` and `sellPrice` are unit rates; known listings use weight for `per_kg`, quantity for `per_piece`, or one for `per_lot`. **QC `finalPrice`, deal `agreedPrice` and batch `askingPrice` are total lot amounts.** Shop `price` is always a total and includes `priceIsTotal: true`. Collector Shop shows collector prices to its middleman or recycler buyer; Middleman Shop shows aggregator batch asking prices to recyclers. AI notes explicitly state that estimates need local verification.

Listings support JSON for known materials or multipart form data with optional `photo`. E-waste requires multipart `photo`. JPEG, PNG and WebP signatures are checked, with an 8 MB upload limit. Multipart `geo` is a JSON string such as `{"lat":28.6,"lng":77.2}`.

| Area      | Endpoints                                                                                                                                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth      | `POST /api/auth/verify-token`, `POST /api/auth/profile`, `PATCH /api/auth/profile`, `POST /api/auth/set-role`                                                                                                                                                                                                               |
| Listings  | `POST /api/listings/known`, `POST /api/listings/ewaste`, `GET /api/listings/mine`, `GET /api/listings/:id`, `PATCH /api/listings/:id/manual`, `PATCH /api/listings/:id/price`, `DELETE /api/listings/:id`                                                                                                                   |
| Middleman | `GET /api/middleman/collector-shop`, `POST /api/middleman/buy`, `POST /api/middleman/process`, `POST /api/middleman/aggregate`, `POST /api/middleman/list-to-recycler`, `GET /api/middleman/inventory`                                                                                                                      |
| Recycler  | `GET /api/recycler/collector-shop`, `GET /api/recycler/middleman-shop`, `POST/GET /api/recycler/priority`, `POST /api/recycler/offer/listings/:id`, `POST /api/recycler/offer/inventory/:id`                                                                                                                                |
| QC        | `GET /api/operator/tickets`, `POST /api/operator/tickets/:id/claim`, `PATCH /api/operator/tickets/:id`                                                                                                                                                                                                                      |
| Deals     | `GET /api/deals`, `GET /api/deals/:id`, `POST /api/deals/:id/accept`, `POST /api/deals/:id/complete`, `GET/POST /api/deals/:id/chat`                                                                                                                                                                                        |
| Personal  | `GET /api/ledger`, `GET /api/notifications`, `GET /api/pickups`, `PATCH /api/pickups/:id`                                                                                                                                                                                                                                   |
| Admin     | `GET /api/admin/users?role=...`, `PATCH /api/admin/users/:uid/verify`, `PATCH /api/admin/users/:uid/role`, `GET /api/admin/listings`, `GET /api/admin/tickets`, `GET /api/admin/deals`, `GET /api/admin/stats`, `PATCH /api/admin/price/:category`, `DELETE /api/admin/listings/:id`, `PATCH /api/admin/pickups/:id/assign` |
| Other     | `POST /api/whatsapp/openwa/webhook`, `GET /api/price/:category`, `GET /api/categories`                                                                                                                                                                                                                                      |

The brief specifies two indistinguishable `/api/recycler/offer/:id` routes. Use the explicit routes above. The short form is also supported, resolving a unique listing or inventory ID and rejecting collisions.

Both shops accept `category`, `minPrice`, and `maxPrice`; Collector Shop also accepts `lat` + `lng` + `radiusKm` together. Collector Shop returns only collector listings. Middleman Shop returns only listed aggregator batches. Recyclers cannot buy a collector mixed lot or e-waste directly; `/api/middleman/process` records middleman inspection and categorized weighed outputs before aggregation. Shop access and offers are role-checked by the API.

## Workflow and curl examples

Examples use POSIX shell variables and quoting. On Windows use Git Bash, or adapt them for PowerShell and call `curl.exe`. Set `BASE=http://localhost:3000` and replace the tokens/IDs. These examples cover the build checkpoints in the supplied prompt.

```sh
BASE=http://localhost:3000
# 1. Scaffold/health
curl "$BASE/health"
# 2. Authentication and first-login profile
curl -X POST "$BASE/api/auth/verify-token" -H "Authorization: Bearer $SELLER_TOKEN"
curl -X POST "$BASE/api/auth/profile" -H "Authorization: Bearer $SELLER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Collector","role":"kabadiwala","locality":"delhi","geo":{"lat":28.6,"lng":77.2},"available":true}'
# Admin verification of a buyer profile
curl -X PATCH "$BASE/api/admin/users/BUYER_UID/verify" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"verificationStatus":"verified"}'
# 3. Known material; reference rates are used when manual rates are omitted
curl -X POST "$BASE/api/listings/known" -H "Authorization: Bearer $SELLER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"category":"paper","name":"Newspapers","weight":10,"buyPrice":12,"sellPrice":18}'
# 4. Three sequential Gemini calls and QC fallback
curl -X POST "$BASE/api/listings/ewaste" -H "Authorization: Bearer $SELLER_TOKEN" -F 'photo=@battery.jpg' -F 'weight=2'
# 5. QC completion; finalPrice is the total amount for the lot
curl -X PATCH "$BASE/api/operator/tickets/TICKET_ID" -H "Authorization: Bearer $OPERATOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"category":"electronic-battery","condition":"damaged","finalPrice":240,"qcNotes":"Inspected","useCase":"Material recovery"}'
# 6. Middleman purchase, then acceptance and BOTH completion confirmations below
curl -X POST "$BASE/api/middleman/buy" -H "Authorization: Bearer $MIDDLEMAN_TOKEN" -H 'Content-Type: application/json' -d '{"listingId":"LISTING_ID","agreedPrice":120}'
# Only completed purchases can be aggregated; IDs cannot be reused in another batch
curl -X POST "$BASE/api/middleman/aggregate" -H "Authorization: Bearer $MIDDLEMAN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"listingIds":["PURCHASED_LISTING_ID"],"aggregatedCategory":"paper","askingPrice":200}'
curl -X POST "$BASE/api/middleman/list-to-recycler" -H "Authorization: Bearer $MIDDLEMAN_TOKEN" -H 'Content-Type: application/json' -d '{"inventoryId":"INVENTORY_ID"}'
# 7. Recycler shop, priority and batch offer (use an expiry within the next year)
curl "$BASE/api/recycler/collector-shop?category=paper" -H "Authorization: Bearer $BUYER_TOKEN"
curl "$BASE/api/recycler/middleman-shop?category=paper" -H "Authorization: Bearer $BUYER_TOKEN"
curl -X POST "$BASE/api/recycler/priority" -H "Authorization: Bearer $BUYER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"category":"paper","premiumTier":3,"expiresAt":"2027-01-01T00:00:00.000Z"}'
curl -X POST "$BASE/api/recycler/offer/inventory/INVENTORY_ID" -H "Authorization: Bearer $BUYER_TOKEN" -H 'Content-Type: application/json' -d '{"agreedPrice":200}'
# 8. At/above asking offers are seller-approved automatically. Below asking requires seller accept first.
curl -X POST "$BASE/api/deals/DEAL_ID/accept" -H "Authorization: Bearer $BUYER_TOKEN"
curl -X POST "$BASE/api/deals/DEAL_ID/complete" -H "Authorization: Bearer $SELLER_TOKEN"
curl -X POST "$BASE/api/deals/DEAL_ID/complete" -H "Authorization: Bearer $BUYER_TOKEN"
curl "$BASE/api/ledger" -H "Authorization: Bearer $SELLER_TOKEN"
curl -X POST "$BASE/api/deals/DEAL_ID/chat" -H "Authorization: Bearer $OPERATOR_TOKEN" -H 'Content-Type: application/json' -d '{"text":"Collection is arranged."}'
# 9. OpenWA webhooks require the shared header. Its webhook plugin sends a message.received envelope.
curl -X POST "$BASE/api/whatsapp/openwa/webhook" -H "Content-Type: application/json" -H "X-Webhook-Secret: $OPENWA_WEBHOOK_SECRET" \
  -d '{"webhookId":"local-test","sessionId":"kabadiwala-connect","event":"message.received","payload":{"message":{"id":"false_919876543210@c.us_TEST","from":"919876543210@c.us","body":"hello"}},"timestamp":1700000000000}'
# 10. Admin stats and reference price override
curl "$BASE/api/admin/stats" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH "$BASE/api/admin/price/paper" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"buyPrice":12,"sellPrice":18,"priceUnit":"per_kg","priceNote":"Operator verified local rate"}'
# 11. Validation: incomplete radius filter must be rejected (400)
curl "$BASE/api/middleman/collector-shop?lat=28.6&lng=77.2&radiusKm=20" -H "Authorization: Bearer $MIDDLEMAN_TOKEN"
```

## Transaction guarantees and recovery

- Creating an offer atomically reserves the item and creates its deal and chat thread. `assigned` is an explicit state, resolving the missing state in the PRD's abbreviated lifecycle. Reserved items disappear from the shop.
- Sellers approve below-asking offers before buyers lock them. Both original parties must confirm completion. Completion writes both immutable ledger entries and sold state in one transaction. Repeated confirmations are idempotent. There is no payment gateway or automatic money transfer.
- Operator QC price is a total, cannot change through chat or offers, and only admin can reprice an unreserved listing. Existing reserved/completed trades cannot be repriced, even by admin.
- Priority uses active, unexpired subscriptions belonging to verified recyclers; tier 3 wins, then oldest subscription, then stable ID. Assignment is transactional. The worker recovers any `priced` listing left between QC commit and assignment if a request/process failed.
- Gemini makes exactly three sequential calls to `GEMINI_MODEL` (default `gemini-2.5-flash`): vision description, vision plus description classification, then text pricing. Structured output is validated. Listings preserve the original Cloudinary image URL plus validated stage output, confidence, model/prompt version, timestamps and sanitized fallback state in `aiPipeline`. E-waste, copper/PCB/high-value metal are forced to QC. Any AI failure creates a manual-review QC ticket rather than losing the listing. Cloudinary upload failures return an explicit error. Known listings without rates and unavailable AI persist as drafts, recoverable via `PATCH /api/listings/:id/manual`.
- Aggregator inventory is category-specific: a batch cannot be `mixed`, and every source holding must be a completed, owned lot in exactly the batch category. Mixed and e-waste source lots must first be inspected and split into segregated outputs.
- Price reference writes never overwrite a manual operator/admin override with a Gemini estimate.
- OpenWA inbound `message.received` events are authenticated with a shared header, deduplicated by session ID plus message ID, durably queued before a `204` response, and processed in database receipt order per phone number. Responses are queued in the same transaction as session changes. Webhook enqueue latency is capped at four seconds; timeout returns 503 so OpenWA can retry. Text-only addresses use locality matching; unmatched requests remain pending for admin assignment. No unconfigured geocoder or invented coordinates are used.
- Outbound WhatsApp messages use the private OpenWA Easy API and have leases plus exponential retry, with five attempts before `failed`. Delivery is at-least-once: a crash after OpenWA accepts a send but before its database acknowledgement can produce a duplicate reply. Inspect failed `jobs` in a secured Firebase console. Do not expose the collection to clients.
- Notification documents are the live-update seam. Clients can subscribe through Firestore; a future Socket.io adapter can consume the same events. No Socket.io implementation is included.

## Checks and remaining operational setup

```sh
npm run typecheck
npm test
npm run test:emulator
npm run build
npm audit --omit=dev
```

Tests use an isolated, serialized in-memory transactional adapter that enforces read-before-write ordering and rollback. They exercise HTTP authorization/validation and business invariants including competing offers, dual confirmation, idempotent ledger entries, aggregation ownership, priority, QC protection, AI failure and WhatsApp deduplication/session recovery. They do not replace an integration run against Firebase emulators or real providers.

The included Firestore emulator suite passed: client privilege escalation and ledger writes are denied, private reads are scoped, competing real transactions reserve exactly once, and duplicate completion creates only two ledger documents. Extend these tests when adding frontend query patterns.

No cloud resources or credentials were supplied, so live Firebase, Gemini, Cloudinary and OpenWA verification remains part of deployment setup. Run API and worker under a process supervisor, use HTTPS, restrict service-account IAM and monitor failed jobs.

Firebase Admin is updated to 14.5 and Gaxios 6's UUID dependency is overridden to the patched CommonJS-compatible 11.1 line; Gaxios uses its unchanged `v4` API. Production dependencies have no reported npm audit vulnerabilities. Three moderate advisories remain in the development-only Firebase CLI/OpenTelemetry/PubSub dependency chain; avoid installing dev dependencies in the production image (`npm ci --omit=dev` after building). No unsupported major override is applied to that tooling.

The implementation uses single-field Firestore queries and in-process filtering/pagination, suitable for the MVP. Large-scale shop geographic search, admin analytics and queue scans require indexed query design, rollups and a dedicated queue/search service. In-process rate limits need a shared store for horizontally scaled deployments. Chat messages use their own collection to avoid Firestore's per-document size limit.

The PRD leaves minimum collector payout and reservation expiry open. Neither a payout floor nor automatic deal release is invented here. Priority tiers are self-selected as requested; paid tier entitlement checks must be added when billing is introduced. Active-user stats use a 30-day window and the last successful token-verification/profile update.

Implementation references: [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Gemini content API](https://ai.google.dev/api/generate-content), [OpenWA webhooks](https://openwa.dev/docs/guides/webhooks-for-business), [OpenWA Docker deployment](https://openwa.dev/docs/getting-started/docker).
