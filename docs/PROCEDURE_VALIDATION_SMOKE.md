# Procédure de validation (smoke test) — reproductible

Objectif : valider en quelques minutes que le backend est opérationnel (santé, auth, Stripe, DB, webhook idempotence) sans refactor ni environnement complexe.

## Prérequis

- Node.js >= 18, npm
- PostgreSQL accessible (local ou Docker sur 5433)
- Fichier `.env` complet : `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `CORS_ORIGINS`
- (Optionnel) Stripe CLI pour test webhook local

## 1. Base de données et migrations

```bash
npx prisma migrate deploy
# ou en dev : npx prisma migrate dev
```

Vérifier : pas d’erreur, message type « X migration(s) applied ».

## 2. Démarrage de l’application

```bash
npm run build && npm start
# ou : docker compose up --build
```

Vérifier : logs sans crash, écoute sur le port configuré (ex. 3000).

## 3. Health et readiness

```bash
curl -s http://localhost:3000/health
# Attendu : 200, JSON avec "status":"ok", "db":"up"

curl -s http://localhost:3000/ready
# Attendu : 200
```

Si DB down (Postgres arrêté) : `GET /health` doit retourner 503 avec `"db":"down"`, `"status":"degraded"`.

## 4. Auth (register + login)

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"TestPass123!"}'
# Attendu : 201 ou 200

curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"TestPass123!"}'
# Attendu : 200, JSON avec "accessToken" et "user"
```

Conserver l’`accessToken` pour l’étape 5.

## 5. Checkout (création session Stripe)

```bash
export TOKEN="<accessToken_obtenu_ci-dessus>"
curl -s -X POST http://localhost:3000/payments/checkout-session \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"amount":1000,"currency":"eur"}'
# Attendu : 200, JSON avec "url" (lien Stripe Checkout)
```

Ouvrir l’URL dans un navigateur, effectuer un paiement test (carte 4242…). Après retour sur le site : vérifier en base que la commande correspondante a `status = 'paid'` (Prisma Studio ou `npx prisma studio`).

## 6. Webhook — idempotence (optionnel, si Stripe CLI installé)

```bash
stripe listen --forward-to http://localhost:3000/stripe/webhook
# Dans un autre terminal : déclencher un paiement (demo ou curl checkout-session + payer)
```

Vérifier dans les logs de l’app : un événement `checkout.session.completed` traité, un enregistrement `PaymentEvent` avec le bon `stripe_event_id`. Rejouer le même événement (Stripe CLI ou replay Dashboard) : les logs doivent indiquer que l’événement a déjà été traité ; un seul update de la commande en DB.

## 7. Cookie refresh (navigateur)

1. Ouvrir http://localhost:3000/demo
2. Register / Login
3. DevTools → Application → Cookies → localhost
4. Vérifier cookie `refreshToken` : HttpOnly, Secure (si HTTPS), SameSite=Lax, Max-Age cohérent (ex. ~30 jours).

## Résumé des critères de succès

| Étape | Critère |
|-------|--------|
| 1 | Migrations appliquées sans erreur |
| 2 | App démarre et écoute sur le port configuré |
| 3 | `/health` 200 + db up ; `/ready` 200 |
| 4 | Register + login retournent un accessToken |
| 5 | Checkout-session retourne une URL ; après paiement test, Order.status = paid |
| 6 | Webhook traité une fois par event.id ; rejeu ignoré (idempotence) |
| 7 | Cookie refresh présent avec attributs sécurisés |

En cas d’échec : consulter la section **Support** du README (logs, `/ready`, Stripe Dashboard → Developers → Webhooks / Logs).
