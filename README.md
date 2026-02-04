# Express Stripe Auth Skeleton

Backend squelette Node.js/Express en TypeScript : PostgreSQL (Prisma), Stripe Checkout + webhooks idempotents, auth JWT (access + refresh), sécurité minimale.

## Prérequis

- Node.js >= 18
- PostgreSQL (local ou Docker)
- Compte Stripe (clés test)

## Installation

```bash
npm install
cp .env.example .env
# Éditer .env avec vos valeurs (DATABASE_URL, JWT_*, STRIPE_*)
npx prisma migrate dev
npm run dev
```

## Demo (frontend minimal)

Une démo statique (HTML/CSS/JS, sans framework) permet de tester register, login, /me et le flux Checkout.

1. Démarrer le backend : `npm run dev`
2. Ouvrir dans le navigateur : **http://localhost:3000/demo** (ou http://localhost:3000/demo/index.html)
3. Tester : Register → Login → « Charger /me » → « Payer » (création de session Stripe + redirection)

**Stripe Checkout – retours après paiement**  
Pour que Stripe renvoie vers la demo après paiement ou annulation, configurer dans `.env` :

- `STRIPE_SUCCESS_URL=http://localhost:3000/demo`
- `STRIPE_CANCEL_URL=http://localhost:3000/demo`

(En production, remplacer par les URLs de votre front.)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Démarrage en watch (tsx) |
| `npm run build` | Compilation TypeScript → `dist/` |
| `npm start` | Démarrage production (`node dist/index.js`) |
| `npm test` | Tests Vitest (dont smoke /health) |
| `npm run lint` | ESLint sur `src` et `tests` |
| `npm run prisma:generate` | Génère le client Prisma |
| `npm run prisma:migrate` | Migrations dev |
| `npm run prisma:migrate:deploy` | Migrations production |
| `npm run prisma:studio` | UI Prisma Studio |

## Variables d’environnement

Voir `.env.example`. Principales :

- `PORT` – port du serveur (défaut 3000)
- `DATABASE_URL` – URL PostgreSQL
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` – secrets JWT (min 16 caractères)
- `JWT_ISSUER` – émetteur des tokens (défaut `express-stripe-auth`) ; vérifié à la validation
- `JWT_AUDIENCE` – (optionnel) audience des tokens ; si défini, vérifié à la validation
- `REFRESH_TOKEN_TTL_DAYS` – durée de vie des refresh tokens en DB (défaut 30)
- `COOKIE_SECURE` – cookie refresh en Secure (défaut: `true` si `NODE_ENV=production`)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` – Stripe
- `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` – URLs de redirection Checkout (requises)
- `CORS_ORIGINS` – origines CORS (séparées par des virgules, ou `*`)

## Docker

```bash
# Build + démarrage app + Postgres
docker compose up --build

# En arrière-plan
docker compose up -d --build
```

L’app écoute sur le port 3000, Postgres sur 5432. Les secrets (JWT, Stripe) doivent être fournis via un fichier `.env` à la racine ou des variables d’environnement.

## Endpoints

- `GET /health` – Santé (status, env, db) ; toujours 200
- `GET /ready` – Readiness (DB) ; 200 si DB OK, 503 sinon (pour sonde K8s/orchestrateur)
- `POST /auth/register` – Inscription
- `POST /auth/login` – Connexion (retourne `accessToken` + `user`, envoie le refresh token en cookie HttpOnly)
- `POST /auth/refresh` – Rotation du refresh token (cookie ou body `refreshToken`) → nouveau `accessToken` + nouveau cookie
- `POST /auth/logout` – Révoque le refresh token (cookie ou body) → 204
- `POST /auth/logout-all` – Révoque tous les refresh tokens de l’utilisateur (protégé)
- `GET /auth/me` – Profil courant (protégé)
- `POST /payments/checkout-session` – Créer une commande + session Stripe Checkout (protégé, body: `amount`, `currency`)
- `POST /stripe/webhook` – Webhook Stripe (signature vérifiée, ACK 200 puis traitement ; `checkout.session.completed` → Order.status = paid)

## Auth (login / refresh / logout)

- **Login** : après validation des identifiants, l’API émet un **access token** JWT (court, ex. 15 min) et un **refresh token** (long, ex. 30 jours). Le refresh token est stocké en DB sous forme **hashée** (SHA-256) et renvoyé dans un **cookie HttpOnly** (SameSite=Lax, Secure en production). La réponse JSON contient uniquement `accessToken` et `user`.
- **Refresh** : le client envoie le refresh token (cookie ou body `refreshToken`). L’API révoque l’ancien token, en crée un nouveau (rotation), renvoie un nouvel access token et met à jour le cookie.
- **Logout** : le client envoie le refresh token (cookie ou body) ; l’API le révoque en DB et efface le cookie.

Variables utiles : `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` (optionnel), `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE`.

## Stripe webhook (local)

Le webhook vérifie la signature avec `STRIPE_WEBHOOK_SECRET` (obligatoire au démarrage), répond 200 dès que la signature est valide (ACK), puis traite l’événement en arrière-plan. Pour `checkout.session.completed` avec `metadata.orderId`, la commande est passée en `paid`. **Idempotence** : chaque événement Stripe est enregistré dans `PaymentEvent` (clé unique `stripe_event_id`) avant mise à jour de la commande ; un même `event.id` rejoué est ignoré (une seule mise à jour effective).

- **Variables** : `STRIPE_WEBHOOK_SECRET` (requis), `WEBHOOK_BODY_LIMIT` (défaut 1mb), `RATE_LIMIT_WEBHOOK_*`.
- **Test en local** : utiliser [Stripe CLI](https://stripe.com/docs/stripe-cli) pour transférer les événements vers l’app (`stripe listen --forward-to localhost:3000/stripe/webhook`) et récupérer le secret temporaire dans la sortie du CLI.

## API (OpenAPI)

Spécification minimale : `openapi.yaml` à la racine.

## Tests

Choix : **Vitest** (rapide, bon support ESM/TypeScript, peu de config).

```bash
npm test
```

Les tests (health, auth, payments checkout, stripe webhook) utilisent des mocks. Aucune config supplémentaire : `npm test` suffit. En option, pour des tests d’intégration avec une vraie DB, définir `DATABASE_URL` vers une base de test et lancer les migrations dessus.
