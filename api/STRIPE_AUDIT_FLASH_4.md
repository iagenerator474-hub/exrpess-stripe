# Audit Flash Stripe / Node — 30 min (réaudit état actuel)

**Date:** 2026-02-04  
**Périmètre:** Backend Node/Express/TypeScript — Stripe Checkout + webhooks.

---

## 1) Verdict

**GO** (production autorisée sous réserve des 5 actions ci‑dessous et du respect de la checklist déploiement).

Références attendues **conformes** :
- **Prix côté serveur** : client envoie uniquement `productId` ; `amountCents` / `currency` viennent de `Product` en DB → Order → Stripe (anti-tampering).
- **Webhook signé et idempotent** : route avec `express.raw`, `constructEvent(rawBody, signature, secret)` ; 400 si signature manquante/invalide ; ledger `PaymentEvent` avec `stripeEventId` unique ; P2002 → 200 et reprise `updateMany` sur doublon pour checkout/refunds.
- **DB source de vérité** : Order créée avant Checkout ; passage en `paid` / `refunded` uniquement via webhook après persistance.
- **payment_status === "paid"** : seul ce cas déclenche le passage en paid ; contrôle `amount_total` / `currency` vs Order ; unpaid / mismatch → event orphelin, Order inchangée.
- **Logs sans PII** : règle dans `logger.ts` ; champs loggés = requestId, stripeEventId, orderId, sessionId, codes ; pas d’email, token, body, headers sensibles.

Aucun **P0** identifié. Risques restants = P1/P2 procéduraux ou durcissements mineurs.

---

## 2) Top 10 risques (P0 / P1 / P2)

| # | Sév. | Risque | Fichier / Contexte |
|---|------|--------|--------------------|
| 1 | **P1** | **TRUST_PROXY** : si l’app est derrière Nginx/Render/Fly et `TRUST_PROXY` n’est pas à 1, l’IP client et le rate-limit sont ceux du proxy → abus possible, logs trompeurs. | `app.ts` (trust proxy) ; checklist déploiement |
| 2 | **P1** | **Migration `Order.stripe_payment_intent_id`** : au boot, un seul log d’erreur si la colonne est absente ; pas d’`exit(1)`. L’app peut tourner sans la migration → refunds jamais appliqués. | `index.ts` `ensureMigrationStripePaymentIntentId()` |
| 3 | **P1** | **Dashboard Stripe** : si l’endpoint webhook PROD n’est pas abonné à `charge.refunded` et/ou `payment_intent.refunded`, les Order ne passent jamais à `refunded`. | Procédure / DEPLOYMENT_CHECKLIST |
| 4 | **P1** | **STRIPE_WEBHOOK_SECRET** : en prod, valeur courte ou placeholder → tous les webhooks en 400, aucun paiement enregistré. Validation actuelle : préfixe `whsec_` + longueur ≥ 20 en prod. | `config/index.ts` `validateProductionConfig()` |
| 5 | **P2** | **Log au démarrage** : en non-prod, préfixe/suffixe de `STRIPE_SECRET_KEY` est loggé → fuite partielle en staging si clé live utilisée par erreur. | `index.ts` L22–26 |
| 6 | **P2** | **Alerting webhook** : absence d’alertes sur 4xx/5xx et sur le message 429 « Webhook rate limit exceeded » → incidents non détectés. | Doc ops / DEPLOYMENT_CHECKLIST |
| 7 | **P2** | **Vérification post-déploiement** : ne pas confirmer l’absence du log « Migration required: column Order.stripe_payment_intent_id is missing » après déploiement. | Checklist |
| 8 | **P2** | **STRIPE_API_VERSION** : désalignement avec le Dashboard Stripe peut provoquer des erreurs ou champs manquants. À rappeler en checklist. | Config + doc |
| 9 | **P2** | **JWT_ACCESS_SECRET** : en prod, longueur &lt; 32 → rejet au boot (déjà en place). S’assurer que la checklist l’exige. | `validateProductionConfig()` |
| 10 | **P2** | **CORS / ENABLE_DEMO** : en prod, `CORS_ORIGINS=*` ou `ENABLE_DEMO=true` → rejet au boot. Déjà conformes ; rappel checklist. | Config + DEPLOYMENT_CHECKLIST |

**Points déjà conformes (aucune action code requise pour ceux-ci)**  
- Webhook : raw body sur `/stripe/webhook` uniquement ; signature obligatoire ; idempotence + reprise updateMany sur P2002 pour checkout et refunds.  
- Refunds : `charge.refunded` et `payment_intent.refunded` traités, passage Order en `refunded` (full refund).  
- Prod : clé live, webhook secret min 20, CORS non `*`, ENABLE_DEMO bloqué, JWT min 32.  
- Health : `/ready` avec `SELECT 1` + `product.count()` ; pas d’infos sensibles.  
- DATABASE_URL validée (Postgres) au boot.

---

## 3) 5 actions immédiates (patch minimal)

| # | Action | Risque si non fait |
|---|--------|--------------------|
| 1 | **Checklist déploiement** : confirmer dans `DEPLOYMENT_CHECKLIST.md` (ou équivalent) : (a) `TRUST_PROXY=1` si reverse proxy ; (b) sur l’endpoint webhook PROD Stripe, souscrire à `checkout.session.completed` et à `charge.refunded` / `payment_intent.refunded` ; (c) après déploiement, vérifier l’**absence** du log « Migration required: column Order.stripe_payment_intent_id is missing ». | IP/rate-limit faux ; refunds non appliqués ; app tourne sans migration. |
| 2 | **Boot check migration** : optionnel mais recommandé — si la colonne `Order.stripe_payment_intent_id` est absente, logger l’erreur **et** appeler `process.exit(1)` pour que le déploiement échoue tant que la migration n’est pas appliquée. Patch minimal dans `ensureMigrationStripePaymentIntentId()`. | Refunds inopérants sans signalement clair au déploiement. |
| 3 | **Doc alerting** : dans la checklist ou la doc ops, ajouter : créer des alertes sur les réponses 4xx/5xx du webhook Stripe et sur le message de log exact « Webhook rate limit exceeded (429) ». | Incidents webhook ou rate-limit non vus. |
| 4 | **Log démarrage** : en production, ne jamais logger aucune partie de `STRIPE_SECRET_KEY`. Déjà le cas (log seulement si `NODE_ENV !== "production"`). Optionnel : en staging, ne logger que « stripe key set » sans préfixe/suffixe pour éviter toute fuite. | Fuite partielle de clé en staging. |
| 5 | **Rappel STRIPE_WEBHOOK_SECRET** : dans la checklist, exiger un secret webhook **réel** (Dashboard → Webhooks → signing secret pour l’URL prod), non placeholder et ≥ 20 caractères. | Webhooks tous rejetés en prod. |

---

**Invariants à ne pas modifier**  
- Prix 100 % serveur ; passage en paid uniquement après `payment_status === "paid"` + vérification amount/currency.  
- Webhook : signature obligatoire ; 2xx uniquement après persistance (ou doublon idempotent).  
- Pas de refonte : uniquement patchs ciblés et mises à jour de doc/checklist.
