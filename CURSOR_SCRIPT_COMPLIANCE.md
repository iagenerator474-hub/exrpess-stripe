# Conformité Cursor Script — Freelance hardening

Ce document atteste que le projet respecte le script « express-stripe-auth-skeleton (Freelance short missions hardening) ».

---

## Phase 0 — Inventaire ✓

| Élément | Emplacement |
|--------|-------------|
| Route webhook Stripe | `api/src/modules/stripe/stripe.routes.ts` (POST /stripe/webhook) |
| Création Checkout session | `api/src/modules/payments/checkout.service.ts` + `stripe.service.ts` |
| Modèles Order, PaymentEvent | `api/prisma/schema.prisma` |
| Logique refresh token | `api/src/modules/auth/refreshToken.service.ts` (rotate, replacedByTokenId) |
| Middleware auth guard | `api/src/middleware/authGuard.ts` |
| Tests | `api/tests/` — vitest + supertest (auth, auth.refresh, health, payments.checkout, stripe.webhook) |
| Frontend | `frontend/` (React/Vite optionnel) ; demo minimale dans `api/demo/` |

---

## Phase 1 — Repo backend-first ✓

- Backend dans **`api/`** (src, prisma, Dockerfile, entrypoint, tests).
- Demo HTML minimale dans **`api/demo/`** (servie à `/demo`).
- **`docker compose up`** build depuis `./api`, lance API + Postgres sans dépendre du front.
- Scripts racine : `npm run dev` → `cd api && npm run dev` ; `npm run db:migrate` → `cd api && npm run db:migrate`.
- README : « API backend » + option demo + frontend optionnel.

---

## Phase 2 — Stripe idempotence stripeSessionId ✓

- **Prisma** : `Order.stripeSessionId` unique ; `PaymentEvent.stripeEventId` unique ; `Order.paidAt` présent.
- **Webhook** : signature via `constructEvent` ; 200 ACK immédiat ; `setImmediate(processEvent)`.
- **Traitement async** :  
  1) `PaymentEvent.create` (P2002 → already_processed, stop).  
  2) `Order.updateMany` où `id = orderId AND stripeSessionId = sessionId AND status != 'paid'` → `status = 'paid', paidAt = now()`.  
  3) Logs : requestId, stripeEventId, stripeSessionId, orderId, outcome (updated_order | noop | already_processed).
- **Checkout** : Order créée (pending) → session Stripe créée → `Order.stripeSessionId = session.id` mis à jour.

---

## Phase 3 — Auth refresh race condition ✓

- **Rotation** : cookie → hash → `findUnique` ; transaction avec `updateMany` conditionnel  
  `where: { id, revokedAt: null, replacedByTokenId: null, expiresAt: { gt: now } }` → `revokedAt: now` ; si `count === 0` → 401 ; création nouveau token + `replacedByTokenId` sur l’ancien.
- Double appel (séquentiel ou parallèle) : un 200, un 401. Test « two parallel refresh with same cookie: one 200 one 401 » présent.

---

## Phase 4 — README + .env.example ✓

- **`.env.example`** (api/) : DATABASE_URL, JWT_*, STRIPE_*, CORS_ORIGINS, TRUST_PROXY, COOKIE_*, rate limits, WEBHOOK_BODY_LIMIT.
- **README** : What/Why (« Pourquoi fiable »), Quickstart (docker + migrations + dev), Stripe flow, Security notes, Env vars, API (openapi.yaml), Smoke test (SMOKE_TEST.md), Go-live (GO_LIVE_CHECKLIST.md), Structure.

---

## Phase 5 — 3 tests golden ✓

1. **Webhook idempotent** : `api/tests/stripe.webhook.test.ts` — « replay same checkout.session.completed 5 times results in single PaymentEvent and single Order update » (200 x5, create appelé 5 fois, P2002 x4, updateMany x1).
2. **Refresh double-use** : `api/tests/auth.refresh.test.ts` — « two parallel refresh with same cookie: one 200 one 401 (double-use safe) » (Promise.all, statuses [200, 401]).
3. **Auth guard** : `api/tests/auth.test.ts` — GET /auth/me : sans token → 401 ; token wrong issuer → 401 ; token valide → 200.

---

## Phase 6 — Final cleanup ✓

- Aucun secret committé (.env dans .gitignore ; .env.example avec placeholders).
- Logs : pas de body Stripe complet, pas de tokens ; webhook outcome avec ids métier uniquement.
- Docker compose : build api/, healthcheck app (GET /ready), Postgres healthy.
- CI (.github/workflows/ci.yml) : checkout → cd api && npm ci && npm run lint && npm test.

---

## Livrables (déjà en place)

Les commits existants couvrent :

- Backend-first structure (api/ + demo)
- Stripe idempotence (event ledger + session/order)
- Auth refresh safe (rotation, anti race)
- Docs (README, .env.example, PROCEDURE_LANCEMENT, GO_LIVE_CHECKLIST, SMOKE_TEST)
- Tests golden (webhook, refresh, auth guard)

**Commandes de vérification :**

```bash
docker compose up --build    # API + Postgres
cd api && npm run db:migrate
cd api && npm test
# Smoke : GET /health, GET /ready, POST /auth/register, etc. (voir SMOKE_TEST.md)
```
