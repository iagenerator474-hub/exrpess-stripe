# Audit Flash Stripe / Node — 30 min

**Date:** 2026-02-04  
**Périmètre:** Backend Node/Express/TypeScript — Stripe Checkout + webhooks.

---

## 1) Verdict

**GO** — Production autorisée sous réserve du respect de la checklist déploiement et des 5 actions ci‑dessous.

**Références attendues — conformes :**

| Référence | État |
|-----------|------|
| **Prix côté serveur (anti-tampering)** | Conforme : client envoie uniquement `productId` ; `amountCents` / `currency` viennent de `Product` en DB → Order → Stripe. |
| **Webhook signé et idempotent** | Conforme : route `express.raw`, `constructEvent(rawBody, sig, secret)` ; 400 si signature manquante/invalide ; ledger `PaymentEvent` avec `stripeEventId` unique ; P2002 → 200 + reprise `updateMany` pour checkout et refunds. |
| **DB source of truth** | Conforme : Order créée avant Checkout ; passage en `paid` / `refunded` uniquement via webhook après persistance. |
| **payment_status === "paid"** | Conforme : seul ce cas déclenche le passage en paid ; contrôle `amount_total` / `currency` vs Order ; unpaid / mismatch → event orphelin. |
| **Logs sans PII** | Conforme : règle dans `logger.ts` ; champs loggés = requestId, stripeEventId, orderId, sessionId, codes ; pas d’email, token, body, headers sensibles. |

**Garde-fous prod en place :** clé live, webhook secret (format + longueur + anti-placeholder), CORS non `*`, ENABLE_DEMO bloqué, JWT ≥ 32, TRUST_PROXY exigé (REQUIRE_TRUST_PROXY_IN_PROD), migration `stripe_payment_intent_id` fail-fast en prod. **Aucun P0.**

---

## 2) Top 10 risques (P0 / P1 / P2)

| # | Sév. | Risque | Contexte |
|---|------|--------|----------|
| 1 | **P2** | **Dashboard webhook** : si l’endpoint PROD n’est pas abonné à `charge.refunded` / `payment_intent.refunded`, les Order ne passent jamais à `refunded`. | Procédure uniquement (checklist section 2). |
| 2 | **P2** | **TRUST_PROXY** : si derrière proxy sans `TRUST_PROXY=1`, IP client et rate-limit incorrects. En prod l’app exige TRUST_PROXY sauf si `REQUIRE_TRUST_PROXY_IN_PROD=false`. | Vérifier checklist avant déploiement. |
| 3 | **P2** | **Alerting** : pas d’alertes sur 4xx/5xx webhook ni sur le message 429 → incidents non détectés. | Doc / monitoring (checklist section 3 et 6). |
| 4 | **P2** | **STRIPE_API_VERSION** : désalignement avec le Dashboard peut provoquer erreurs ou champs manquants. | Rappel checklist. |
| 5 | **P2** | **Log démarrage** : ~~préfixe/suffixe clé Stripe~~ → **corrigé** : seul `stripeKeyMode: "test" \| "live"` est loggé, aucune partie de la clé. | `index.ts`. |
| 6 | **P2** | **Rate limit webhook 429** : burst Stripe (replay, nombreux events) peut générer des 429 ; message stable déjà loggé. | Documenté ; surveiller et ajuster `RATE_LIMIT_WEBHOOK_MAX` si besoin. |
| 7 | **P2** | **Rétention logs** : rétention 14–30 j et usage du requestId pour investigation à configurer côté hébergeur. | Checklist section 6. |
| 8 | **P2** | **Health /ready** : déjà renforcé (SELECT 1 + product.count()). Pas d’exposition d’infos sensibles. | Conforme. |
| 9 | **P2** | **Secret webhook révoqué** : si le secret est révoqué côté Stripe sans mise à jour de `STRIPE_WEBHOOK_SECRET`, tous les webhooks passent en 400. | Procédure : mettre à jour l’env et redémarrer. |
| 10 | **P2** | **Migrations** : en prod, absence de la colonne `stripe_payment_intent_id` → exit(1) au boot. Avant premier démarrage, exécuter `prisma migrate deploy`. | Checklist section 4. |

---

## 3) 5 actions immédiates (patch minimal)

| # | Action | Risque si non fait |
|---|--------|--------------------|
| 1 | **Checklist déploiement** : valider avant chaque déploiement prod : TRUST_PROXY=1 si proxy ; STRIPE_WEBHOOK_SECRET réel (Dashboard) ; `prisma migrate deploy` avant démarrage ; webhook PROD abonné à `checkout.session.completed` + `charge.refunded` / `payment_intent.refunded`. | IP/rate-limit faux ; webhooks 400 ; refunds non appliqués. |
| 2 | **Alerting** : créer alertes sur (1) réponses 4xx/5xx du endpoint webhook Stripe, (2) message de log exact « Webhook rate limit exceeded (429) ». | Incidents ou saturation webhook non vus. |
| 3 | **Doc STRIPE_API_VERSION** : rappeler dans la checklist d’aligner la variable avec la version du Stripe Dashboard. | Erreurs ou champs manquants à l’API. |
| 4 | **Log démarrage** : fait — seul `stripeKeyMode` (test/live) est loggé, plus aucun préfixe/suffixe de clé. | — |
| 5 | **Runbook** : documenter la procédure si webhooks passent tous en 400 (vérifier secret, URL, version API ; mettre à jour env et redémarrer). | Délai de résolution en incident. |

---

**Invariants à ne pas modifier**  
- Prix 100 % serveur ; passage en paid uniquement après `payment_status === "paid"` + vérification amount/currency.  
- Webhook : signature obligatoire ; 2xx uniquement après persistance (ou doublon idempotent).  
- Pas de refonte : patchs ciblés et mise à jour doc/checklist uniquement.
