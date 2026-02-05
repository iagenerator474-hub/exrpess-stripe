# Livraison client — API Stripe Checkout + Auth

Document de livraison pour l’API backend (Express, Prisma, PostgreSQL, Stripe). Scope : paiements Stripe Checkout, webhooks signés, auth JWT + refresh cookie, base de données comme source de vérité.

---

## Ce que fait le projet

- **Stripe Checkout** : création de session Checkout (ordre en base, redirection utilisateur vers Stripe).
- **Webhooks signés** : réception des événements Stripe (ex. `checkout.session.completed`) avec vérification de signature (raw body), **persistance puis ACK** (jamais 200 avant écriture en base).
- **Idempotence** : ledger `PaymentEvent` par `stripe_event_id` ; mise à jour `Order` (paid) une seule fois par session ; rejeu = 200 sans double traitement.
- **Auth** : JWT access token + refresh token (cookie HttpOnly, rotation single-use).
- **DB = source de vérité** : ordres, events, utilisateurs et tokens en PostgreSQL.

## Ce qu’il ne fait pas

- Pas un SaaS complet (pas multi-tenant, pas facturation récurrente native, pas dashboard admin).
- Pas de front de production fourni (demo HTML et front React optionnels pour dev/démo).
- Pas de features gadgets (pas de k8s, pas de microservices, pas de file d’attente externe).

---

## Prérequis

- **Node.js** 18+
- **PostgreSQL** (local ou hébergé)
- **Docker** (optionnel, pour Postgres et/ou run de l’API)
- Compte **Stripe** (clés API, webhook endpoint, signing secret)

---

## Installation (dev)

À la racine du dépôt :

```bash
npm install
cd api && npm install
```

Créer le fichier d’environnement :

```bash
cd api
cp .env.example .env
```

Éditer `api/.env` avec vos valeurs (voir **Configuration**). Ne jamais committer `.env`.

Migrations et vérification :

```bash
npm run db:migrate
npm test
```

---

## Configuration

Variables d’environnement attendues (noms uniquement ; valeurs à définir dans `api/.env` ou via la plateforme de déploiement). Référence complète : **`api/.env.example`**.

| Catégorie   | Variables |
|------------|-----------|
| App        | `NODE_ENV`, `PORT` |
| Base       | `DATABASE_URL` |
| JWT        | `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_ISSUER`, `JWT_AUDIENCE` (optionnel) |
| Refresh    | `REFRESH_TOKEN_TTL_DAYS` |
| Cookies    | `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` (optionnel) |
| Proxy      | `TRUST_PROXY` (prod derrière reverse proxy) |
| Stripe     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `STRIPE_API_VERSION`, `WEBHOOK_BODY_LIMIT` |
| CORS       | `CORS_ORIGINS` (liste explicite en prod, pas `*`) |
| Rate limit | `RATE_LIMIT_*` (auth, refresh, webhook, checkout) |
| Demo       | `ENABLE_DEMO` (optionnel, pour servir `/demo` en prod) |

Où les définir : **`api/.env`** en local ; en production : variables d’environnement de l’hébergeur (Render, Fly, VM, etc.) ou fichier chargé au démarrage, jamais dans le code.

---

## Démarrage

### Local (dev)

```bash
# Postgres déjà lancé (Docker ou local)
npm run db:migrate
npm run dev
```

API : `http://localhost:3000`. Demo : `http://localhost:3000/demo` (si dispo).

### Docker Compose

```bash
docker compose up -d
```

Prévoir un `.env` à la racine (ou variables) pour `DATABASE_URL`, `JWT_ACCESS_SECRET`, `STRIPE_*`, `CORS_ORIGINS`, etc. En prod : `NODE_ENV=production` et `CORS_ORIGINS` explicites.

---

## Contrat API

- **Spécification** : `api/openapi.yaml` (OpenAPI 3).
- **Checkout** : `POST /payments/checkout-session` (auth Bearer requise). Réponse 200 :
  - `checkoutUrl` : URL de redirection Stripe Checkout
  - `stripeSessionId` : id de session Stripe
  - `orderId` : id de l’ordre créé en base

Autres endpoints : auth (register, login, refresh, logout, me), health (`/health`, `/ready`), webhook Stripe `POST /stripe/webhook`.

---

## Go-live checklist (10–12 points)

1. `DATABASE_URL` prod configuré et accessible depuis l’app.
2. `NODE_ENV=production`.
3. `CORS_ORIGINS` défini (liste d’origines, pas `*`).
4. `JWT_ACCESS_SECRET` fort et unique, jamais commité.
5. `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` prod (webhook endpoint HTTPS configuré dans Stripe).
6. `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` pointent vers le front prod.
7. `TRUST_PROXY=1` si l’API est derrière Nginx / reverse proxy.
8. Migrations appliquées : `cd api && npx prisma migrate deploy`.
9. Aucun fichier `.env` ou secret dans le build/image.
10. Rate limits et timeouts cohérents avec la charge attendue.
11. Vérification manuelle : un paiement test Stripe → ordre en base en `paid`.
12. Vérification : rejeu webhook (même `stripe_event_id`) → 200 sans double mise à jour.

---

## Post-deploy smoke tests

- **Paiement test** : créer une session Checkout (POST avec Bearer), ouvrir `checkoutUrl`, payer avec une carte test Stripe ; vérifier en base que l’`Order` correspondante a `status = paid` et `paidAt` renseigné.
- **Webhook replay** : dans Stripe Dashboard (ou CLI), renvoyer un événement `checkout.session.completed` déjà traité ; l’API doit répondre 200 et ne pas modifier une seconde fois l’ordre (idempotence).

---

*Document livraison client — pas de secret, pas de valeur réelle d’env.*
