# Checklist Go-Live

## Env obligatoires et nouveaux

- [ ] Aucun `.env` committé ou dans le ZIP
- [ ] `DATABASE_URL`, `JWT_ACCESS_SECRET` définis (min 16 car.)
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

## Déploiement

- [ ] Webhook Stripe prod : URL HTTPS, événement `checkout.session.completed`, signing secret en env (distinct du local)
- [ ] Cookies : en prod HTTPS, `COOKIE_SECURE` true (défaut) ; `COOKIE_DOMAIN` si front sous-domaine
- [ ] Entrypoint / démarrage : `prisma migrate deploy` avant `node dist/index.js`
- [ ] Healthcheck plateforme sur `GET /ready` (200 = prêt)
- [ ] Paiement test de bout en bout : checkout avec `productId` → paiement → Order en DB en `paid`
- [ ] Rejeu webhook : idempotence OK (un seul traitement par event.id)
- [ ] Rollback documenté : redéployer tag/image précédent ; migrations peuvent être irréversibles
- [ ] Logs / Stripe Dashboard (Webhooks → Logs) connus pour le support
