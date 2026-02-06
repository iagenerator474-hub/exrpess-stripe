# Checklist déploiement GO PROD (Stripe + Node)

À valider avant mise en production. Complément à [GO_LIVE_CHECKLIST.md](../GO_LIVE_CHECKLIST.md).

---

## 1. Env et garde-fous

- [ ] **ENABLE_DEMO** : doit rester désactivé en prod (non défini ou `false`). En prod, `ENABLE_DEMO=true` fait crasher l’app au démarrage.
- [ ] **JWT_ACCESS_SECRET** : en prod, minimum 32 caractères (sinon crash au démarrage).
- [ ] **TRUST_PROXY** : **Mettre `TRUST_PROXY=1` si l’API est derrière un reverse proxy** (Nginx, Render, Fly, Heroku, etc.). Comment savoir : hébergement type PaaS (Render, Fly, Heroku) ou Nginx/load balancer devant l’app = oui ; app exposée directement sur IP publique = non. En prod, par défaut `REQUIRE_TRUST_PROXY_IN_PROD=true` → si TRUST_PROXY n’est pas défini, l’app **crash au démarrage**. Si l’app n’est pas derrière un proxy, définir `REQUIRE_TRUST_PROXY_IN_PROD=false`. Sans TRUST_PROXY derrière un proxy : IP client et rate-limit incorrects.
- [ ] **STRIPE_WEBHOOK_SECRET** : en prod, secret **réel** (Dashboard Stripe → Webhooks → signing secret). Format `whsec_` + alphanumerics, longueur ≥ 26 caractères. Placeholder (`whsec_placeholder`, `whsec_123`, `whsec_test`, etc.) ou valeur vide → **crash au démarrage**.
- [ ] **STRIPE_API_VERSION** : doit être **alignée avec la version du Stripe Dashboard** (éviter erreurs d’API). Valeur par défaut dans la config ; **à revalider après chaque upgrade Stripe** (Dashboard ou SDK). Voir [OPS_RUNBOOK.md](OPS_RUNBOOK.md) § STRIPE_API_VERSION.

---

## 2. Stripe Dashboard – Webhook

Souscrire aux events **refunds** sur l’endpoint webhook PROD ; sinon les Order ne passent jamais à `refunded`.

- [ ] **URL** : endpoint HTTPS de prod (ex. `https://api.example.com/stripe/webhook`).
- [ ] **Événements souscrits** — sur l’endpoint webhook **PROD** Stripe, souscrire à :
  - **Checkout (obligatoire)** : `checkout.session.completed` (passage Order → paid).
  - **Refunds (obligatoire pour cohérence)** : `charge.refunded` et/ou `payment_intent.refunded`. **Impact si absent :** les Order ne peuvent **jamais** passer à `"refunded"` ; les remboursements effectués côté Stripe ne sont pas reflétés en base (incohérence compta / support).
- [ ] **Signing secret** : copié dans `STRIPE_WEBHOOK_SECRET` (secret distinct du local).
- [ ] **Post go-live** : effectuer un **test de remboursement** (un paiement test puis refund dans le Dashboard) et vérifier en base que l’Order concernée passe à `refunded`.

---

## 3. Rate limit webhook (429)

- [ ] **Par défaut** : 100 req/min sur `/stripe/webhook`. En cas de burst Stripe (replay, nombreux events), des 429 sont possibles.
- [ ] **Surveillance logs** : surveiller les réponses **400** (signature) et **429** (rate limit) sur le webhook. Chaque 429 produit le message de log exact : `"Webhook rate limit exceeded (429)"` (+ `requestId`). Créer des alertes sur : (1) réponses 4xx/5xx du webhook, (2) ce message 429. Voir [OPS_RUNBOOK.md](OPS_RUNBOOK.md) § Alertes webhook et § Incident runbook.
- [ ] **Action si 429 observés** : augmenter `RATE_LIMIT_WEBHOOK_MAX` après analyse (burst légitime vs abus) ; ou exclusions IP Stripe si hébergeur le permet ; documenter la décision. Ne pas augmenter la limite sans justification.

---

## 4. Migrations Prisma

- [ ] **Avant démarrage** : exécuter **`npx prisma migrate deploy`** (dans l’entrypoint ou la procédure de déploiement).
- [ ] **Fail-fast prod** : la colonne critique `Order.stripe_payment_intent_id` est vérifiée au boot ; **en prod**, si elle manque → **exit(1)** avec le message exact : `"Migration required: column Order.stripe_payment_intent_id is missing"`. En dev, seul un log est émis.
- [ ] **Après déploiement** : vérifier l’**absence** de ce log (ou en prod que l’app a bien démarré) ; si présent, exécuter `npx prisma migrate deploy` puis redémarrer.

---

## 5. Health / env

- [ ] **GET /health** : par défaut, `env` n’est pas renvoyé (config `HEALTH_EXPOSE_ENV=false`). Pour exposer un indicateur minimal (`env: "production" | "development"`), définir `HEALTH_EXPOSE_ENV=true` (à réserver aux environnements internes si besoin). Aucune version, secret ni détail sensible n’est exposé. **GET /ready** : renvoie uniquement `{ status: "ready" }` ou `"not ready"` (pas d’infos sensibles).

---

## 6. Logs & alertes (Ops logs)

- [ ] **Rétention** : configurer **14–30 jours** côté hébergeur ou centralisation logs ; les logs contiennent `requestId` pour l’investigation (filtrer par requestId pour tracer une requête).
- [ ] **Alertes** : 4xx/5xx sur le webhook Stripe ; message exact `"Webhook rate limit exceeded (429)"` pour les 429. Champs safe vs interdits : voir README « Logs & rétention » et [OPS_RUNBOOK.md](OPS_RUNBOOK.md) § Ops logs.
- [ ] **Champs autorisés en logs** : `requestId`, `orderId`, `stripeSessionId`, `stripeEventId`, `status`, codes d’erreur. **Champs interdits** : email, cookies, token, headers d’auth, body.

---

*Référence : [OPS_RUNBOOK.md](OPS_RUNBOOK.md), [STRIPE_WEBHOOK_RESIDUAL_RISKS.md](STRIPE_WEBHOOK_RESIDUAL_RISKS.md), [PROD_ACCEPTED_RISKS.md](PROD_ACCEPTED_RISKS.md), [GO_LIVE_CHECKLIST.md](../GO_LIVE_CHECKLIST.md), README « Logs & rétention ».*
