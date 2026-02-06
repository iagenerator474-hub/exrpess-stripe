# Audit Flash Stripe / Node — 30 min (v2)

**Date:** 2026-02-06  
**Périmètre:** Checkout + webhooks, Node/Express/TypeScript (état après correctifs GO PROD).

---

## 1) Verdict

**GO PROD** (sous réserve de la checklist déploiement et des 5 actions ci‑dessous).

Le flux respecte les références attendues : prix 100 % serveur, webhook signé + idempotent, DB source of truth, `payment_status === "paid"` + contrôle amount/currency, logs sans PII. Les garde-fous prod (clé live, webhook secret, CORS) et le traitement des refunds sont en place. Aucun P0 bloquant.

---

## 2) Top 10 risques (P0 / P1 / P2)

| # | Sév. | Risque | Fichier / Contexte |
|---|------|--------|---------------------|
| 1 | **P1** | **ENABLE_DEMO en prod** : si activé, `/demo` est exposé (surface d’attaque, démo non contrôlée). Pas de refus au démarrage, seule la doc/checklist. | `app.ts` L99 ; `.env` |
| 2 | **P1** | **Webhook Stripe Dashboard** : si les events `charge.refunded` / `payment_intent.refunded` ne sont pas souscrits sur l’URL prod, les remboursements ne mettront pas à jour `Order.status`. | Dashboard Stripe → Webhooks → URL → events |
| 3 | **P2** | **TRUST_PROXY** : en prod derrière reverse proxy (Fly/Render/Nginx), si non défini, IP client et rate-limit sont incorrects. | `app.ts` L30–32 ; checklist |
| 4 | **P2** | **Rate limit webhook 100/min** : en cas de burst Stripe (replay, nombreux events), risque de 429 et retries. | `config` RATE_LIMIT_WEBHOOK_* |
| 5 | **P2** | **STRIPE_API_VERSION** : décalage avec la version du Dashboard peut provoquer des erreurs ou comportements inattendus. | `config` ; Dashboard |
| 6 | **P2** | **checkout.service** utilise encore `process.env.NODE_ENV` pour le message d’erreur client (L70) → cohérence avec `config.NODE_ENV`. | `checkout.service.ts` L70 |
| 7 | **P2** | **prisma.ts / logger.ts** : utilisation de `process.env.NODE_ENV` au lieu de `config` → divergence possible si env chargé différemment. | `lib/prisma.ts` ; `lib/logger.ts` |
| 8 | **P2** | **Health** : `GET /health` renvoie `env: config.NODE_ENV` → fuite d’info mineure (nom d’env). À éviter si health est public. | `health.routes.ts` L16 |
| 9 | **P2** | **Migration stripePaymentIntentId** : en prod, appliquer la migration avant déploiement ; sans quoi les refunds par `stripePaymentIntentId` échouent. | `prisma migrate deploy` |
| 10 | **P2** | **Secrets** : aucune vérification de longueur minimale sur `JWT_ACCESS_SECRET` au-delà de 16 (schema). En prod, renforcer par politique (ex. 32). | `config` JWT_ACCESS_SECRET |

**Points conformes (références respectées)**  
- **Prix serveur** : client envoie uniquement `productId` ; montant/devise depuis `Product` en DB → Order → Stripe (`checkout.validation.ts`, `checkout.service.ts`, `stripe.service.ts`).  
- **Webhook signé** : route avec `express.raw()`, `constructEvent(rawBody, sig, secret)` ; 400 si signature manquante/invalide.  
- **Idempotence** : ledger `PaymentEvent` avec `stripeEventId` unique ; P2002 → 200 ; rejeu sans double mise à jour.  
- **DB source of truth** : Order créée en DB avant Checkout ; passage en paid/refunded uniquement via webhook après persistance.  
- **payment_status === "paid"** : seul ce cas déclenche la mise à jour Order en paid ; contrôle amount/currency ; refunds gérés.  
- **Logs sans PII** : requestId, stripeEventId, sessionId, orderId, chargeId, paymentIntentId, codes d’erreur ; pas de payload complet ni de secrets ; en prod pas de détail d’erreur DB (code uniquement).

---

## 3) 5 actions immédiates (patch minimal)

| # | Action | Risque si non fait |
|---|--------|---------------------|
| 1 | **Checklist déploiement** : confirmer TRUST_PROXY=1 si proxy ; STRIPE_WEBHOOK_SECRET valide (≥20 car.) ; ENABLE_DEMO non activé ; migrations appliquées (`prisma migrate deploy`) ; Dashboard webhook avec events `checkout.session.completed` + `charge.refunded` / `payment_intent.refunded` si remboursements utilisés. | IP/rate-limit faux ; pas de paid ; /demo exposé ; refunds non appliqués. |
| 2 | **checkout.service.ts** : remplacer `process.env.NODE_ENV === "development"` par `config.NODE_ENV === "development"` pour le message d’erreur Stripe (L70). | Incohérence prod/dev si env non chargé comme prévu. |
| 3 | **Health** : si `/health` est exposé publiquement, retirer `env: config.NODE_ENV` du body ou le restreindre à un endpoint interne. | Fuite d’info sur l’environnement. |
| 4 | **Doc ENABLE_DEMO** : rappel dans README ou checklist : « En prod, ne jamais activer ENABLE_DEMO sauf démo contrôlée. » (déjà partiellement en place). | Activation accidentelle en prod. |
| 5 | **Monitoring** : alerting sur 4xx/5xx webhook (Dashboard Stripe ou logs) et sur 429 (rate limit) pour ajuster RATE_LIMIT_WEBHOOK_* si besoin. | Retries Stripe bloqués ou événements non traités sans visibilité. |

---

*Audit flash ; à coupler avec les tests automatisés et la checklist manuelle (PROD_VALIDATION.md, GO_LIVE_CHECKLIST.md).*
