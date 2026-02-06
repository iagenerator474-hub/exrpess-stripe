# Audit Flash Stripe / Node — 30 min

**Date:** 2026-02-06  
**Périmètre:** Checkout + webhooks, Node/Express/TypeScript.

---

## 1) Verdict

**GO PROD** (sous réserve des 5 actions ci‑dessous et de la checklist déploiement).

Le flux respecte la baseline : prix serveur, signature webhook, raw body, idempotence (PaymentEvent + stripeEventId), ACK policy, `payment_status === "paid"`, validation amount/currency, logs sans PII. Aucun P0 bloquant. Les P1 restants sont traitables par patch minimal ou par procédure (checklist + monitoring).

---

## 2) Top 10 findings (P0 / P1 / P2)

| # | Sév. | Finding | Fichier / Ligne |
|---|------|--------|------------------|
| 1 | **P1** | **Refunds non gérés** : aucun handler pour `charge.refunded` / `payment_intent.refunded`. Les commandes remboursées restent `status: "paid"` → incohérence compta / support. | `api/src/modules/stripe/stripe.webhook.ts` (seul `checkout.session.completed` traité) |
| 2 | **P1** | **Webhook secret en prod** : si `STRIPE_WEBHOOK_SECRET` invalide ou ancien (ex. secret révoqué), tous les webhooks renvoient 400 → aucun paiement enregistré. Pas de contrôle au démarrage hormis le préfixe `whsec_`. | `api/src/config/index.ts` (schema) ; `stripe.webhook.ts` L49–54 |
| 3 | **P2** | **errorHandler** utilise `process.env.NODE_ENV` au lieu de `config.NODE_ENV` → risque de divergence (ordre de chargement, tests). | `api/src/middleware/errorHandler.ts` L45, L66 |
| 4 | **P2** | **ENABLE_DEMO en prod** : si activé, exposition de `/demo`. À documenter clairement « désactiver en prod sauf besoin explicite ». | `api/.env.example` ; `api/src/app.ts` L99–108 |
| 5 | **P2** | **WEBHOOK_BODY_LIMIT=1mb** : Stripe envoie des payloads typiquement < 100 kB. Réduire à 512 kB limite la surface DoS sans impact fonctionnel. | `api/src/config/index.ts` L44 ; `api/.env.example` |
| 6 | **P2** | **Stack en dev** : en non‑prod, `errorHandler` envoie `err.stack` dans le body JSON. S’assurer que `NODE_ENV=production` en prod (déjà le cas si checklist respectée). | `api/src/middleware/errorHandler.ts` L75 |
| 7 | **P2** | **Trust proxy** : si l’app est derrière Nginx/Render/Fly et `TRUST_PROXY` absent, IP client et rate‑limit sont incorrects. Déjà documenté ; à inclure dans la checklist déploiement. | `api/src/app.ts` L30–32 ; `api/.env.example` |
| 8 | **P2** | **Order status** : la création Order repose sur le défaut Prisma `"pending"`. Ajouter `status: "pending"` en explicite améliore la lisibilité et la cohérence avec le schéma. | `api/src/modules/payments/checkout.service.ts` L27–34 |
| 9 | **P2** | **Stripe API version** : `STRIPE_API_VERSION` doit être alignée avec le Dashboard Stripe. Déjà en env ; rappeler dans la doc déploiement. | `api/src/config/index.ts` L43 ; `api/.env.example` |
| 10 | **P2** | **Rate limit webhook** : 100 req/min. En cas de burst Stripe (replay, nombreux events), risque de 429. Rare ; à documenter (augmenter si besoin ou accepter le risque). | `api/src/config/index.ts` L53–54 |

**Points positifs (baseline respectée)**  
- Checkout : prix 100 % serveur (Product en DB → Order → Stripe), `metadata.orderId` + `client_reference_id`.  
- Webhook : `express.raw` sur la route dédiée (avant `express.json`), `constructEvent(rawBody, sig, secret)`, 400 si signature manquante/invalide.  
- Idempotence : PaymentEvent avec `stripeEventId` unique ; P2002 → 200, rejeu sans double `updateMany` (orphaned géré).  
- ACK : 2xx uniquement après persistance (ou doublon) ; 5xx en erreur temporaire ; 4xx signature/payload.  
- Paiement : `payment_status === "paid"` requis ; validation amount/currency ; pas de passage en paid si unpaid ou mismatch.  
- Logs : requestId, stripeEventId, sessionId, orderId, codes d’erreur en prod ; pas de payload complet ni de secrets.

---

## 3) 5 actions immédiates (patch minimal) + risque si non fait

| # | Action | Risque si non fait |
|---|--------|--------------------|
| 1 | **Refunds** : ajouter le traitement de `charge.refunded` (ou `payment_intent.refunded` selon le mode) → mettre à jour l’Order liée en `status: "refunded"` (idempotence via PaymentEvent inchangée). Patch minimal : un bloc `else if (event.type === "charge.refunded")` avec résolution order (payment_intent ou charge → order) et `updateMany` vers `refunded`. | Commandes remboursées restent « paid » → compta et support incorrects. |
| 2 | **errorHandler** : remplacer `process.env.NODE_ENV` par `config.NODE_ENV` (import config) aux endroits où le mode prod est testé. | Comportement client (message/stack) ou logs potentiellement incohérents si env non chargé comme prévu. |
| 3 | **WEBHOOK_BODY_LIMIT** : passer le défaut à `512kb` (ou 500kb) dans le schema et dans `.env.example`. | Risque DoS marginal (payloads Stripe restant petits). |
| 4 | **Checklist déploiement** : dans `PROD_VALIDATION.md` ou équivalent, ajouter explicitement : TRUST_PROXY=1 si reverse proxy ; STRIPE_WEBHOOK_SECRET valide (secret du Dashboard pour l’URL prod) ; ENABLE_DEMO non activé en prod. | Mauvais rate‑limit / IP ; aucun paiement enregistré ; exposition inutile de /demo. |
| 5 | **Doc ENABLE_DEMO** : dans README ou .env.example, préciser : « En prod, ne pas activer ENABLE_DEMO sauf besoin explicite (ex. démo contrôlée). » | Risque d’activation accidentelle et exposition de la démo. |

---

**Invariants à ne pas casser**  
- Webhook signé + raw body uniquement sur la route webhook.  
- 2xx uniquement après persistance (ou doublon idempotent).  
- Prix et passage en « paid » uniquement après vérification `payment_status === "paid"` + amount/currency.  
- Pas de refonte : patchs ciblés et tests associés (ex. test de refund si handler ajouté).
