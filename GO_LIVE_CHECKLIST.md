# Checklist Go-Live

## Go Live Stripe

- [ ] **Webhook endpoint** : URL HTTPS de l’API (ex. `https://api.example.com/stripe/webhook`). Route montée **avant** `express.json()` pour garder le body brut (signature Stripe).
- [ ] **Événements Stripe** : au minimum `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Pour les remboursements : `charge.refunded` et/ou `payment_intent.refunded`.
- [ ] **STRIPE_WEBHOOK_SECRET (whsec_…)** : secret de signature du Dashboard (Webhooks → [endpoint] → Signing secret). En prod, pas de placeholder (crash au démarrage).
- [ ] **STRIPE_SECRET_KEY** : clé live `sk_live_...` en prod (Stripe Dashboard → API keys). En dev/test : `sk_test_...`.
- [ ] **STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL** : URLs HTTPS en prod (redirection après paiement / annulation).
- [ ] **TRUST_PROXY=1** si l’API est derrière un reverse proxy (Nginx, Render, Fly). Sinon le rate-limit webhook peut voir une seule IP (proxy) et renvoyer 429 à tort ; en cas de 429 webhook, vérifier TRUST_PROXY.

## Env obligatoires et nouveaux

- [ ] Aucun `.env` committé ou dans le ZIP
- [ ] `DATABASE_URL`, `JWT_ACCESS_SECRET` définis (min 16 car. ; **en prod min 32 car.**, sinon crash au démarrage)
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (prod), `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` définis
- [ ] `CORS_ORIGINS` = liste explicite (pas `*`)
- [ ] `NODE_ENV=production`
- [ ] **`TRUST_PROXY=1`** si l’API est derrière Nginx, Render, Fly ou tout reverse proxy (obligatoire pour IP client et cookies corrects). À définir dans le `.env` à la racine (docker compose) ou dans la config de la plateforme.
- [ ] **`LOG_STACK_IN_PROD`** : `false` par défaut (ne pas logger les stacks en prod). Mettre `true` uniquement pour debug temporaire.
- [ ] **`PAYMENT_EVENT_RETENTION_MODE`** : `retain` (défaut) ou `erase`. Voir section Privacy & retention.
- [ ] **`PAYMENT_EVENT_RETENTION_DAYS`** : en mode `retain`, nombre de jours de conservation (défaut 365).

## Security

- [ ] **TRUST_PROXY** : impact sur le rate-limit (comptage par IP client) et sur les cookies. Sans TRUST_PROXY derrière un proxy, l’IP peut être celle du proxy.
- [ ] **SameSite cookie** : si `COOKIE_SAMESITE=none` (front sur autre domaine), exiger une stratégie CSRF côté front (token CSRF ou double submit cookie). Documenter clairement pour le client.
- [ ] **Webhook Stripe** : body brut obligatoire pour la signature (pas de `express.json()` sur la route webhook).
- [ ] **Checkout server-priced** : le client envoie uniquement `productId` ; les montants viennent de la table `Product` en base (pas d’amount/currency envoyés par le client).

## Privacy & retention

- [ ] **Logs** : rétention recommandée 14–30 jours (à configurer côté hébergeur ou centralisation logs). Ne pas logger headers/cookies/body.
- [ ] **PaymentEvent** : rétention par défaut 365 jours (mode `retain`) pour audit paiement. Script `npm run purge:payment-events` en mode retain supprime les events plus vieux que `PAYMENT_EVENT_RETENTION_DAYS`. En mode `erase`, le script peut purger par userId (pour droit à l’effacement). Voir section **Purge PaymentEvents** ci-dessous.
- [ ] **Droit à l’effacement** : supprimer un utilisateur implique de décider quoi faire des Order et PaymentEvent liés. Les PaymentEvent peuvent être purgés par userId (script erase). Les Order peuvent être anonymisées ou supprimées selon la politique métier. Documenter ce qui est supprimé vs conservé et pourquoi (ex. conservation pour preuve de paiement / comptabilité).

## Purge PaymentEvents

- **Retain** (par âge) : supprime les PaymentEvent plus vieux que `PAYMENT_EVENT_RETENTION_DAYS`.
  - Commande : `npm run purge:payment-events` ou `npx tsx src/scripts/purgePaymentEvents.ts retain`
- **Erase** (par utilisateur) : supprime les PaymentEvent liés aux commandes d’un utilisateur (droit à l’effacement). Destiné à un flux admin sécurisé, **non exposé publiquement**.
  - **Obligatoire** : définir `PURGE_CONFIRM=YES` dans l’environnement pour confirmer l’action (sécurité “freelance-safe”).
  - Commande : `PURGE_CONFIRM=YES npx tsx src/scripts/purgePaymentEvents.ts erase <userId>`
  - Exemple : `PURGE_CONFIRM=YES npm run purge:payment-events -- erase user_abc123`

## Déploiement (checklist GO-LIVE)

- [ ] **TRUST_PROXY=1** si l’API est derrière un reverse proxy (Fly.io, Render, Nginx, etc.) — requis pour IP client et rate-limit corrects.
- [ ] **STRIPE_WEBHOOK_SECRET** : valeur valide (secret du Dashboard Stripe pour l’URL prod). En prod, un placeholder ou valeur vide empêche le démarrage.
- [ ] **ENABLE_DEMO** : désactivé en prod (doit rester false ; en prod, ENABLE_DEMO=true fait crasher l’app au démarrage).
- [ ] **STRIPE_API_VERSION** : alignée avec la version configurée dans le Stripe Dashboard (éviter erreurs de version d’API).
- [ ] **Rate limit webhook** : 100 req/min par défaut ; en cas de burst Stripe, surveiller les 429 (log « Webhook rate limit exceeded ») et ajuster si besoin. Voir api/DEPLOYMENT_CHECKLIST.md.
- [ ] Webhook Stripe prod : URL HTTPS. Événements obligatoires : `checkout.session.completed`. Refunds : `charge.refunded` et/ou `payment_intent.refunded` (sinon Order ne passe jamais à "refunded"). Signing secret en env (distinct du local).
- [ ] Cookies : en prod HTTPS, `COOKIE_SECURE` true (défaut) ; `COOKIE_DOMAIN` si front sous-domaine
- [ ] Entrypoint / démarrage : **`npx prisma migrate deploy`** avant `node dist/index.js`. La migration **stripePaymentIntentId** (colonne `Order.stripe_payment_intent_id`) doit être appliquée pour les refunds.
- [ ] Healthcheck plateforme sur `GET /ready` (200 = prêt)
- [ ] Paiement test de bout en bout : checkout avec `productId` → paiement → Order en DB en `paid`
- [ ] Rejeu webhook : idempotence OK (un seul traitement par event.id)
- [ ] Rollback documenté : redéployer tag/image précédent ; migrations peuvent être irréversibles
- [ ] Logs / Stripe Dashboard (Webhooks → Logs) connus pour le support
