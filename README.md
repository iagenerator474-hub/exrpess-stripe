# Express Stripe Auth

Backend Node.js/Express (TypeScript) : PostgreSQL (Prisma), Stripe Checkout + webhooks idempotents, auth JWT (access + refresh cookie).

## Quickstart

```bash
npm install
cp .env.example .env   # puis remplir les secrets
docker compose up -d postgres
npm run db:migrate
npm run dev
```

- **Demo** : http://localhost:3000/demo (register, login, checkout)
- **Frontend React** : `frontend/` — `cd frontend && cp .env.example .env && npm run dev` ; définir `VITE_API_URL=http://localhost:3000`

Ne jamais committer `.env`. En cas de fuite : rotation Stripe, JWT, DB.

## Env vars (minimal)

| Variable | Requis | Description |
|----------|--------|-------------|
| `DATABASE_URL` | Oui | URL PostgreSQL |
| `JWT_ACCESS_SECRET` | Oui | Min 16 car. |
| `JWT_REFRESH_SECRET` | Oui | Min 16 car. |
| `STRIPE_SECRET_KEY` | Oui | sk_… |
| `STRIPE_WEBHOOK_SECRET` | Oui | whsec_… |
| `STRIPE_SUCCESS_URL` | Oui | URL après paiement |
| `STRIPE_CANCEL_URL` | Oui | URL après annulation |
| `CORS_ORIGINS` | Oui (prod) | Origines séparées par des virgules (pas `*`) |
| `TRUST_PROXY` | Si proxy | `1` derrière Nginx/Render/Fly |

Voir `.env.example` pour les options (COOKIE_DOMAIN, STRIPE_API_VERSION, etc.).

## Stripe

- **Local** : `stripe listen --forward-to http://localhost:3000/stripe/webhook` ; copier le `whsec_…` dans `.env` → `STRIPE_WEBHOOK_SECRET`. Secret local ≠ prod.
- **Prod** : Dashboard → Webhooks → Add endpoint (URL HTTPS) → événement `checkout.session.completed` → récupérer le signing secret en env.

Webhook : signature vérifiée, ACK 200 puis traitement ; idempotence via `PaymentEvent.stripe_event_id` unique.

## DB

- **Dev** : `npm run db:migrate` (ou `npx prisma migrate dev`)
- **Prod** : l’entrypoint Docker exécute `prisma migrate deploy` au démarrage
- **Seed** : `npm run db:seed` (utilisateur demo : voir `prisma/seed.ts`)

## Commands

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev (watch) |
| `npm run build` | Build |
| `npm start` | Prod |
| `npm test` | Tests |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Migrations dev |
| `npm run db:seed` | Seed DB |

## Links

- **[SMOKE_TEST.md](SMOKE_TEST.md)** — Tests manuels reproductibles (health, auth, checkout, webhook)
- **[GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md)** — Checklist avant mise en prod

## Deploy

Docker : `docker compose up --build`. En prod, définir toutes les variables (tableau ci-dessus), `NODE_ENV=production`, healthcheck sur `GET /ready`. Rollback : redéployer le tag/image précédent ; attention aux migrations irréversibles.
