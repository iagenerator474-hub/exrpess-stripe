# Express Stripe Auth — API backend

Backend API pour paiements Stripe Checkout et auth JWT (cookies refresh). PostgreSQL + Prisma, webhook signé et idempotent, rotation des refresh tokens sécurisée (anti double-usage).

**Pourquoi fiable :** Webhook Stripe vérifié par signature, **durable** (persist PaymentEvent puis ACK 200, jamais 2xx avant écriture DB) ; idempotence par `stripe_event_id` ; refresh token consommé en transaction (un seul usage). DB = source de vérité.

## Quickstart

1. **Créer le fichier d’env** (obligatoire) :
   ```powershell
   cd api
   copy .env.example .env
   ```
   Éditer `api\.env` si besoin (par ex. `DATABASE_URL` si Postgres n’est pas sur `localhost:5432`).

2. **Lancer Postgres** (Docker) :
   ```powershell
   docker compose up -d postgres
   ```
   Si l’erreur « pipe dockerDesktopLinuxEngine » apparaît : Docker n’est pas démarré ou pas installé. Utilise la procédure **Sans Docker** ci-dessous.

3. **Migrations et API** (depuis la racine du repo) :
   ```powershell
   npm run db:migrate
   npm run dev
   ```
   Ou depuis `api` : `npm run db:migrate` puis `npm run dev`.

- **API** : http://localhost:3000  
- **Demo** : http://localhost:3000/demo (HTML minimal)  
- **Frontend React** (optionnel) : `frontend/` — `cd frontend && npm run dev`

Ne jamais committer `.env`. En cas de fuite : rotation Stripe, JWT, DB.

### Sans Docker (PostgreSQL local Windows)

Si Docker n’est pas disponible (erreur `dockerDesktopLinuxEngine` / « Le fichier spécifié est introuvable ») :

1. **Installer PostgreSQL** : https://www.postgresql.org/download/windows/
2. **Créer la base** : ouvrir pgAdmin ou `psql`, puis exécuter :
   ```sql
   CREATE DATABASE app_db;
   ```
3. **Configurer `api\.env`** : adapter `DATABASE_URL` (utilisateur, mot de passe, port par défaut 5432) :
   ```env
   DATABASE_URL=postgresql://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/app_db
   ```
4. **Lancer** (sans `docker compose`) :
   ```powershell
   npm run db:migrate
   npm run dev
   ```

## Stripe (Checkout → webhook → order paid)

1. Client appelle `POST /payments/checkout-session` (auth) → API crée une Order (pending) et une session Stripe, stocke `session.id` dans Order, renvoie l’URL Checkout.
2. Utilisateur paie sur Stripe ; Stripe envoie `checkout.session.completed` au webhook.
3. Webhook : signature vérifiée → persist PaymentEvent → si doublon (P2002) ACK 200 ; sinon mise à jour Order puis ACK 200. En cas d’erreur DB → 500 (Stripe retente). Rejeu du même event = 200 sans retraitement. **Seules les sessions avec `payment_status === "paid"`** déclenchent le passage de la commande en paid ; `unpaid` / `no_payment_required` sont enregistrées en orphan (audit) et la commande reste dans son statut actuel (ex. `created`).

**Local** : `stripe listen --forward-to http://localhost:3000/stripe/webhook` ; mettre le `whsec_…` dans `.env` (secret local ≠ prod).  
**Prod** : Dashboard → Webhooks → URL HTTPS, événements `checkout.session.completed` (et `charge.refunded` / `payment_intent.refunded` pour les remboursements). ENABLE_DEMO doit rester false en prod (sinon crash au démarrage). Checklist détaillée : [api/DEPLOYMENT_CHECKLIST.md](api/DEPLOYMENT_CHECKLIST.md). Voir aussi [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).

**Réconciliation manuelle** : si un webhook a pu être manqué après une longue indisponibilité, lancer le script de réconciliation (usage ops uniquement, pas exposé en route) : `ORDER_ID=order_xxx npx tsx api/src/scripts/reconcileOrder.ts` (ou en passant l’ID en argument). Le script récupère la session Stripe, vérifie `payment_status` / `amount_total`, et met à jour l’Order en `paid` dans une transaction si applicable.

## Security notes

### Sécurité Stripe

- **Rate limit** : `POST /payments/checkout-session` limité par **IP** (config `RATE_LIMIT_CHECKOUT_*`, défaut 30/min). `POST /stripe/webhook` limité par **IP** avec un seuil élevé (défaut 1000/min) pour ne pas bloquer les retries Stripe ; pas de whitelist d’IP (seuil raisonnable suffit).
- **Logs** : en cas de dépassement (429), un log sans PII est émis (`Checkout rate limit exceeded` / `Webhook rate limit exceeded`) avec uniquement le `requestId` pour corrélation.
- **Proxy** : en prod derrière reverse proxy, définir `TRUST_PROXY=1` pour que l’IP client (et donc le rate-limit) soit correcte.
- **Webhook** : body brut pour la signature ; pas de log du payload complet.
- **Idempotence** : ledger Stripe (PaymentEvent) + mise à jour Order conditionnelle (`status != 'paid'`).
- **Refresh token** : un seul usage ; consommation en transaction (`replacedByTokenId` / `revokedAt`). Double appel = un 200, un 401.
- **Cookies** : httpOnly, SameSite configurable (`COOKIE_SAMESITE=lax|none|strict`), Secure quand SameSite=none ou en prod.

## Logs & rétention

- **Champs safe à logger** (corrélation / investigation) : `requestId`, `stripeEventId`, `stripeSessionId`, `orderId` (référence), type d’event, codes d’erreur en prod (`persist_failed`, `processing_failed`). Pas de payload complet ni de body webhook.
- **Champs interdits** : email, nom, cookies, tokens (JWT/refresh), headers d’auth, body des requêtes, clés Stripe, toute donnée permettant d’identifier une personne ou une session.
- **Corrélation** : chaque requête a un `requestId` (UUID) ; envoyé au client via le header `x-request-id` et, pour les erreurs API, dans le body JSON. Utiliser ce `requestId` pour l’investigation (filtrer les logs par requestId).
- **Rétention** : configurer côté hébergeur ou centralisation logs une rétention de **14–30 jours** ; conserver les logs contenant `requestId` pour permettre le suivi des incidents. Détails ops : [api/OPS_RUNBOOK.md](api/OPS_RUNBOOK.md) § Ops logs. Voir [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) section Privacy & retention.

## Env vars

Voir **`api/.env.example`**. Obligatoires : `DATABASE_URL`, `JWT_ACCESS_SECRET` (prod : min 32 car.), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `CORS_ORIGINS` (prod : liste explicite). Optionnel : `COOKIE_DOMAIN`, `COOKIE_SAMESITE`, `STRIPE_API_VERSION` (doit être alignée avec le Stripe Dashboard), `ENABLE_DEMO` (prod : doit rester false), `HEALTH_EXPOSE_ENV` (défaut false : ne pas renvoyer env dans GET /health).

**STRIPE_PRICING_MODE** : `strict` (défaut) ⇒ `amount_total === order.amountCents` ; `flex` ⇒ `amount_total >= order.amountCents` (autorise taxes/frais). En `flex`, la devise et l’orderId doivent correspondre et le paiement doit être `paid`.

### Front sur autre domaine (cross-site)

Si le front tourne sur un domaine différent de l’API (ex. front `https://app.example.com`, API `https://api.example.com`), le cookie refresh doit être envoyé en requêtes cross-site. Définir **`COOKIE_SAMESITE=none`** et **`COOKIE_SECURE=true`** (obligatoire avec `none`). Optionnel : **`COOKIE_DOMAIN=.example.com`** pour partager le cookie entre sous-domaines. CORS doit autoriser l’origine du front (`CORS_ORIGINS=https://app.example.com`).

**Production derrière un reverse proxy (Nginx, Render, Fly, etc.) :** définir **`TRUST_PROXY=1`** pour que l’API utilise la bonne IP client et les cookies (X-Forwarded-*). Sans cela, l’auth par cookie et le rate-limit peuvent être incorrects. Voir [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).

## API & tests

- **Endpoints** : `openapi.yaml` dans `api/`.
- **Procédure de lancement** : [PROCEDURE_LANCEMENT.md](PROCEDURE_LANCEMENT.md).
- **Smoke test** : [SMOKE_TEST.md](SMOKE_TEST.md).
- **Go-live** : [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).

## Production validation

Checklist manuelle avant livraison : **[api/PROD_VALIDATION.md](api/PROD_VALIDATION.md)** (migrations, PaymentEvent audit-proof, idempotence webhook, 500 sanitized, rate limit, graceful shutdown).  
Lancement prod avec Docker : `docker compose up -d` (`.env` avec `NODE_ENV=production`, `CORS_ORIGINS`, et les secrets). Appliquer les migrations : `cd api && npm run db:migrate:deploy`.

```bash
cd api && npm test    # tests Vitest (webhook idempotent, refresh, auth guard)
cd api && npm run lint
```

## Structure

- **`api/`** — Backend (Express, Prisma, Stripe, auth). Toutes les commandes backend : `cd api && npm run …`.
- **`api/demo/`** — Demo HTML minimale servie par l’API à `/demo`.
- **`frontend/`** — App React/Vite optionnelle (auth + checkout), hors scope backend-first.

`docker compose up` build l’image depuis `api/` et lance l’API + Postgres. Les secrets (JWT, Stripe, `DATABASE_URL`) ne sont **jamais** inclus dans l’image : ils sont fournis au runtime via variables d’environnement (fichier `.env` à la racine ou config plateforme).
