# Audit final de validation production

**Date :** 2026-02-04  
**Périmètre :** Création Checkout Session, pricing & anti-tampering, webhook Stripe, DB source de vérité, paiement & refunds, logs & observabilité, garde-fous prod & déploiement.  
**Référence :** Invariants 1 à 10 ci-dessous.

---

## A) Verdict final

**GO PROD**

Version gelée. Aucun correctif obligatoire.

---

## B) Checklist de conformité (invariants)

| # | Invariant | PASS / FAIL |
|---|-----------|-------------|
| 1 | Le client n'envoie jamais le prix | **PASS** — Schéma Zod `checkoutSessionBodySchema` : champ unique `productId` ; `.strict()` rejette toute clé supplémentaire (amountCents, currency, etc.). Réponse 400 "Invalid request body" si body invalide. |
| 2 | Le serveur lit le prix depuis la DB | **PASS** — `checkout.service.ts` : `prisma.product.findUnique({ id: productId })` ; `amountCents` et `currency` proviennent exclusivement de `product`. |
| 3 | L'Order est créée AVANT Stripe | **PASS** — `checkout.service.ts` : `prisma.order.create(...)` puis `stripeService.createCheckoutSession(...)`. |
| 4 | metadata.orderId présente | **PASS** — `stripe.service.ts` : `metadata: { orderId: params.orderId }` et `client_reference_id: params.orderId` sur la session Checkout. |
| 5 | Webhook signé avec raw body | **PASS** — Route `/stripe/webhook` montée avant `express.json()` ; `express.raw({ type: "application/json" })` sur la route ; `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)` ; 400 si signature manquante ou invalide. |
| 6 | Idempotence via ledger DB | **PASS** — `PaymentEvent` avec `stripeEventId` (event.id) unique ; persistance avant tout ACK 200 ; P2002 géré (200 + re-application conditionnelle de l'update Order). |
| 7 | payment_status === "paid" requis | **PASS** — Webhook `checkout.session.completed` : si `paymentStatus !== "paid"` → event orphelin, Order non mise à jour. Passage en paid uniquement lorsque `payment_status === "paid"`. |
| 8 | Vérification amount / currency au webhook | **PASS** — Order chargée par `orderId` ; `session.amount_total === orderRow.amountCents` et `session.currency` comparé à `orderRow.currency` ; en cas de mismatch → event orphelin, Order non marquée paid. |
| 9 | Logs exploitables sans PII | **PASS** — Logs JSON structurés ; `requestId` sur les requêtes ; champs loggés : requestId, stripeEventId, orderId, stripeSessionId, outcome, codes d'erreur. Règle explicite dans `logger.ts` : pas de PII ni de secrets. Pas d'email, token, body ni headers d'auth. |
| 10 | Aucun secret exposé | **PASS** — Aucune clé Stripe, JWT ni webhook secret dans les logs ; au démarrage uniquement `stripeKeyMode: "test" | "live"`. `/health` et `/ready` n'exposent pas de secret ni de version détaillée ; `env` optionnel et limité à NODE_ENV si `HEALTH_EXPOSE_ENV=true`. |

---

## C) Risques résiduels (P2 uniquement)

Risques acceptés et documentés. Aucun défaut de logique ou de sécurité du code.

| Risque | Niveau | Nature | Mitigation |
|--------|--------|--------|------------|
| Secret webhook révoqué ou erroné → webhooks 400 | Moyen | Opérationnelle | Vérifier secret Dashboard ; mettre à jour `STRIPE_WEBHOOK_SECRET` ; redémarrer. Procédure : OPS_RUNBOOK § Rotation / révocation webhook secret. |
| 429 rate limit webhook en cas de burst Stripe | Moyen | Opérationnelle | Surveillance du message de log 429 ; ajuster `RATE_LIMIT_WEBHOOK_MAX` ou exclusions IP si besoin ; documenter. OPS_RUNBOOK § 429. |
| Events refunds non souscrits dans le Dashboard Stripe | Moyen | Opérationnelle | Souscrire à `charge.refunded` et/ou `payment_intent.refunded` sur l'endpoint webhook PROD. DEPLOYMENT_CHECKLIST § 2 ; test refund post go-live. |
| Ordre de traitement en cas de P2002 (doublon) | Faible | Attendue | Aucune : reprise updateMany dans la branche P2002 ; comportement idempotent. |
| Absence de rejeu explicite du body (signature invalide → 400) | Faible | Attendue | Aucune : body non vérifié rejeté par échec de signature ; pas d'utilisation du body non vérifié. |

Aucun autre risque résiduel introduit dans le périmètre de cet audit.

---

## D) Correctifs

**Correctifs obligatoires :** AUCUN.

**Correctifs optionnels :** Aucun durcissement supplémentaire requis pour figer l'état GO PROD. (OPTIONNEL : HEALTHCHECK dans le Dockerfile pour les orchestrateurs — déjà documenté dans PRODUCTION_READINESS_AUDIT ; non bloquant.)

---

## E) Conclusion de clôture

- Tous les invariants critiques (1 à 10) sont **PASS**.
- Aucun **P0** ; aucun **P1**.
- Les risques **P2** sont acceptés et documentés (STRIPE_WEBHOOK_RESIDUAL_RISKS.md, OPS_RUNBOOK.md, DEPLOYMENT_CHECKLIST.md).
- Toute évolution ultérieure relève d'un **nouveau scope** et ne fait pas partie du présent audit.

**Document de clôture — version gelée GO PROD.**
