# Audit Flash Stripe / Node — 30 min (état post-patches GO PROD)

**Date:** 2026-02-06  
**Périmètre:** Checkout + webhooks, Node/Express/TypeScript (après correctifs ENABLE_DEMO, JWT 32, refunds, config.NODE_ENV, health, migrations, 429 log).

---

## 1) Verdict

**GO PROD** (sous réserve du respect de la checklist déploiement).

Les références attendues sont en place : prix 100 % serveur, webhook signé + idempotent, DB source of truth, `payment_status === "paid"` + contrôle amount/currency, logs sans PII. Garde-fous prod actifs (clé live, webhook secret, CORS, ENABLE_DEMO, JWT 32). Refunds, 429 log, migration check et doc sont en place. Aucun P0.

---

## 2) Top 10 risques (P0 / P1 / P2)

| # | Sév. | Risque | Contexte |
|---|------|--------|----------|
| 1 | **P1** | **Stripe Dashboard** : si les events `charge.refunded` / `payment_intent.refunded` ne sont pas souscrits sur l’URL prod, les Order ne passent jamais à "refunded". | Ops / checklist |
| 2 | **P2** | **TRUST_PROXY** : en prod derrière reverse proxy, si non défini → IP client et rate-limit incorrects. Documenté ; pas de blocage au démarrage. | app.ts, checklist |
| 3 | **P2** | **Rate limit 100/min** : burst Stripe peut générer des 429 ; les 429 sont loggés, à surveiller pour ajuster si besoin. | config, app.ts handler |
| 4 | **P2** | **STRIPE_API_VERSION** : décalage avec le Dashboard peut provoquer des erreurs. Doc + checklist ; pas de check auto. | config, DEPLOYMENT_CHECKLIST |
| 5 | **P2** | **Migration stripePaymentIntentId** : si non appliquée en prod, refunds par `stripePaymentIntentId` échouent ; un log d’erreur au boot alerte. | index.ts, checklist |
| 6 | **P2** | **DATABASE_URL** : pas de validation de force (ex. format). Erreur au premier accès Prisma. | config |
| 7 | **P2** | **Health /ready** : pas de vérification de la présence des tables ou colonnes critiques ; seul `SELECT 1` est fait. | health.routes.ts |
| 8 | **P2** | **Secrets en mémoire** : clés Stripe/JWT chargées en config ; pas de rotation automatique (comportement standard). | — |
| 9 | **P2** | **Replay webhook** : idempotence OK ; en cas de très gros retard de livraison Stripe, ordre des events à considérer (rare). | stripe.webhook.ts |
| 10 | **P2** | **Logs debug** : `logger.debug` actif hors prod ; s’assurer qu’aucun PII n’y est ajouté. | logger.ts |

**Conformité aux références**

- **Prix serveur** : client envoie uniquement `productId` ; montant/devise depuis Product → Order → Stripe.
- **Webhook signé** : `express.raw()` sur la route, `constructEvent(rawBody, sig, secret)` ; 400 si signature manquante/invalide.
- **Idempotence** : ledger PaymentEvent (`stripeEventId` unique) ; P2002 → 200 ; rejeu sans double mise à jour.
- **DB source of truth** : Order créée avant Checkout ; paid/refunded uniquement via webhook après persistance.
- **payment_status === "paid"** : seul ce cas déclenche le passage en paid ; contrôle amount/currency ; refunds gérés.
- **Logs sans PII** : requestId, stripeEventId, sessionId, orderId, codes ; pas de payload complet ni de secrets ; en prod pas de détail DB.

---

## 3) 5 actions immédiates (patch minimal)

| # | Action | Risque si non fait |
|---|--------|--------------------|
| 1 | **Checklist déploiement** : valider TRUST_PROXY=1 si proxy ; webhook secret valide ; migrations appliquées (`prisma migrate deploy`) ; Dashboard webhook avec `checkout.session.completed` + `charge.refunded` / `payment_intent.refunded`. | IP/rate-limit faux ; pas de paid ; refunds non appliqués. |
| 2 | **Monitoring** : alerting sur 4xx/5xx webhook (Stripe Dashboard ou logs) et sur le log « Webhook rate limit exceeded (429) » pour ajuster la limite si besoin. | Retries Stripe bloqués ou non visibles. |
| 3 | **Vérifier le log au démarrage** : en prod après déploiement, confirmer l’absence du message « Migration required: column Order.stripe_payment_intent_id is missing ». | Refunds inopérants si migration oubliée. |
| 4 | **STRIPE_API_VERSION** : après toute mise à jour Stripe, aligner la valeur avec le Dashboard et redéployer si nécessaire. | Erreurs ou comportements inattendus. |
| 5 | **Rétention logs** : configurer côté hébergeur (ex. 14–30 jours) et s’assurer que les logs contenant requestId sont exploitables pour l’investigation. | Difficulté à tracer un incident. |

---

*Référence : [api/DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md), [GO_LIVE_CHECKLIST.md](../GO_LIVE_CHECKLIST.md).*
