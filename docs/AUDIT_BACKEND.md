# Audit backend – Express Stripe Auth

**Rapport d’audit profond** – Mission courte freelance.  
Destinataires : client non-tech + tech lead.  
Référence : codebase actuelle (Node.js / Express, PostgreSQL Prisma, Stripe Checkout + Webhooks, auth JWT + refresh).

---

## 1) Résumé exécutif (NON-TECH – 10 lignes max)

- **Problème principal** : Risque de **paiements incohérents** (1 paiement = 1 effet) et **sécurité / stabilité** en production.
- **État actuel** : Le backend a été **renforcé** : idempotence des webhooks Stripe (un même événement ne peut plus être traité deux fois), CORS strict en prod, JWT avec émetteur (et optionnellement audience), logs sans stack en prod, limite de taille des requêtes, endpoint de readiness (`/ready`). Les **risques restants** prioritaires : (1) en cas de crash serveur entre l’enregistrement de l’événement Stripe et la mise à jour de la commande, une commande peut rester « en attente » sans correction automatique ; (2) aucun contrôle par rôle (admin) sur les endpoints sensibles.
- **Risques business** : Litiges clients (« j’ai payé mais ma commande n’est pas passée »), exposition de l’API si CORS ou secrets mal configurés en prod.
- **Priorité de correction** : Sécuriser la **cohérence paiement/commande** (transaction ou réconciliation), puis valider la config prod (CORS, secrets, monitoring).
- **Recommandation globale** : **Sécuriser sans casser** : ajouter une transaction (ou un job de réconciliation) pour garantir qu’une commande passée en « payée » ne reste jamais bloquée en « pending » après traitement du webhook ; documenter les choix (rôles, autres événements Stripe) et maintenir les tests actuels.

---

## 2) Tableau des risques

| Priorité | Domaine | Risque | Impact business | Preuve (fichier) | Recommandation |
|----------|--------|--------|-----------------|------------------|----------------|
| **P0** | Paiements | Crash entre enregistrement de l’événement Stripe et mise à jour de la commande → commande restée `pending` sans retry qui la corrige. | Client a payé, commande non activée ; litiges, perte de confiance. | `src/modules/stripe/stripe.webhook.ts` : `processEvent()` fait `paymentEvent.create` puis `order.updateMany` en chaîne de promesses ; pas de transaction. Si le processus crash après le `create` et avant le `updateMany`, au retry Stripe on a conflit unique (P2002) et on ne réexécute pas l’`updateMany`. | Regrouper `paymentEvent.create` et `order.updateMany` dans une **transaction Prisma** ; ou mettre en place un **job de réconciliation** (periodiquement : PaymentEvent sans Order à jour → mise à jour Order). |
| **P1** | Auth / API | `roleGuard` (RBAC) présent mais **non utilisé** : aucun endpoint restreint par rôle (ex. admin). | Si besoin futur d’actions réservées admin, oubli de protection. | `src/middleware/roleGuard.ts` exporté ; aucun `router.get(..., roleGuard("admin"), ...)` dans `auth.routes.ts` ni `payments.routes.ts`. | Documenter que le RBAC est prêt mais non utilisé ; ou brancher `roleGuard` sur les routes sensibles dès qu’un rôle admin est requis. |
| **P1** | Paiements | Seul l’événement `checkout.session.completed` est traité. Aucun traitement pour `charge.refunded`, `payment_intent.payment_failed`, etc. | Remboursements ou échecs non reflétés en base si besoin métier. | `src/modules/stripe/stripe.webhook.ts` : uniquement `if (event.type === "checkout.session.completed")` avec mise à jour Order en `paid`. | Valider avec le métier si d’autres événements doivent mettre à jour le statut (ex. `refunded`, `failed`) ; si oui, les traiter de façon idempotente (même logique PaymentEvent). |
| **P2** | DB | Création de commande + appel Stripe + mise à jour `stripeSessionId` **sans transaction** globale. | En cas de crash entre création Order et mise à jour, order sans `stripeSessionId` ; récupérable mais incohérence temporaire. | `src/modules/payments/checkout.service.ts` : `order.create` puis `stripeService.createCheckoutSession` puis `order.update` ; pas de `prisma.$transaction`. | Optionnel : envelopper create + update dans une transaction pour atomicité (ou accepter le risque et documenter). |
| **P2** | Observabilité | Pas de **requestId** dans tous les logs applicatifs (certains appels le passent, d’autres non). | Corrélation des logs plus difficile en incident. | `src/modules/stripe/stripe.webhook.ts` : `processEvent(event, req.requestId)` ; ailleurs `logger.info(..., { requestId })` parfois absent. | S’assurer que tout log métier inclut `requestId` quand disponible (déjà le cas dans errorHandler, health, webhook). |

---

## 3) Synthèse globale

### A) Architecture

- **Qualité / clarté** : Structure modulaire (`src/modules/{auth, health, payments, stripe}`), services séparés (auth, refreshToken, token, checkout, stripe), erreurs centralisées (`AppError` + `errorHandler`). Code lisible et cohérent.
- **Dette visible** : Pas de refonte nécessaire ; dette limitée (transaction webhook, usage optionnel de `roleGuard`).
- **Niveau de maturité** : **Pré-prod / prod** : idempotence, CORS, JWT iss/aud, rate limits, body limit, health/ready. Manque un renfort sur la cohérence paiement/commande (transaction ou réconciliation).

### B) Paiements Stripe & Webhooks (état actuel – P0 traité sauf cohérence crash)

- **Création des paiements**  
  - Mapping : Order en base, `stripeSessionId` stocké après création de la session Stripe (`checkout.service.ts` : `order.create` puis `stripeService.createCheckoutSession` puis `order.update` avec `stripeSessionId`).  
  - `metadata.orderId` et `client_reference_id` renseignés dans `stripe.service.ts` (l.44–45).  
  - Preuve : `src/modules/stripe/stripe.service.ts`, `src/modules/payments/checkout.service.ts`.

- **Webhook Stripe**  
  - Raw body : route montée avec `express.raw({ type: "application/json", limit: config.WEBHOOK_BODY_LIMIT })` dans `stripe.routes.ts` ; handler reçoit `req.body` en Buffer.  
  - Signature : `verifyWebhookEvent(rawBody, sig, webhookSecret)` → `stripe.webhooks.constructEvent` ; en cas d’échec, 400 et pas de traitement.  
  - ACK : réponse `200` + `{ received: true }` immédiatement après vérification de signature ; traitement dans `setImmediate(() => processEvent(...))`.  
  - Retries Stripe : comportement correct (200 rapide, traitement asynchrone ; idempotence par `event.id`).

- **Idempotence**  
  - Clé : `event.id` (Stripe) stocké dans `PaymentEvent.stripeEventId` (contrainte `@unique` dans `prisma/schema.prisma`).  
  - Ledger : `PaymentEvent` créé avant toute mise à jour métier dans `stripe.webhook.ts` (l.47–54).  
  - Comportement replay : deuxième réception du même `event.id` → `paymentEvent.create` en conflit (P2002) → catch → log « already processed », pas d’`order.updateMany`.  
  - Preuve : `src/modules/stripe/stripe.webhook.ts`, `prisma/schema.prisma` (modèle `PaymentEvent`).

- **Effets métier**  
  - DB comme source de vérité : oui (Order.status = `paid` après webhook).  
  - Règle « 1 paiement = 1 effet » : respectée **sauf** en cas de crash entre `paymentEvent.create` et `order.updateMany` (risque P0 ci-dessus).  
  - Cas limites : paiement annulé (non géré côté webhook, seulement Checkout cancel URL) ; doublon (géré par idempotence) ; webhook tardif (traité une fois, idempotent).

### C) Authentification & Autorisation (état actuel)

- **Mécanisme** : JWT access (15 min par défaut) + refresh token en cookie HttpOnly (ou body). Refresh stocké en DB (hash SHA-256), rotation à chaque refresh, révocation (logout, logout-all).  
  - Preuve : `token.service.ts`, `refreshToken.service.ts`, `auth.cookies.ts`, `auth.routes.ts`.

- **Sécurité** : Rate limit sur `/auth` (login/register) et sur `/auth/refresh` ; bcrypt (bcryptjs) pour le mot de passe ; cookie HttpOnly, SameSite=Lax, Secure en prod (`getCookieSecure()`). JWT : `exp`, `iss` (config.JWT_ISSUER), `aud` optionnel (config.JWT_AUDIENCE), vérifiés dans `authGuard`.  
  - Preuve : `config/index.ts`, `authGuard.ts`, `auth.service.ts`, `auth.cookies.ts`, `app.ts`.

- **Autorisation** : Routes protégées par `authGuard` : `GET /auth/me`, `POST /auth/logout-all`, `POST /payments/checkout-session`. Aucun `roleGuard` utilisé.  
  - Preuve : `auth.routes.ts`, `payments.routes.ts`, `roleGuard.ts`.

### D) Base de données & cohérence

- **Contraintes uniques** : `User.email`, `RefreshToken.tokenHash`, `Order.stripeSessionId`, `PaymentEvent.stripeEventId` (schéma Prisma). Pas de contrainte manquante identifiée.
- **Transactions** : Aucune sur le flux critique webhook (PaymentEvent + Order) ni sur le flux checkout (Order + Stripe + Order). Recommandation : transaction sur le webhook (voir P0).
- **Migrations** : Prisma, dossiers sous `prisma/migrations/`. Cohérence environnements : à valider côté client (même schéma dev/staging/prod).

### E) Sécurité API

- **Validation** : Zod pour register, login, checkout-session (`auth.validation.ts`, `checkout.validation.ts`).  
- **CORS** : En production, `CORS_ORIGINS=*` refusé au démarrage (`config/index.ts` l.41–44).  
- **Helmet** : activé dans `app.ts`.  
- **Body size** : limite globale `express.json({ limit: "100kb" })` ; webhook `express.raw` avec `WEBHOOK_BODY_LIMIT` (défaut 1mb).  
- **Secrets** : chargés via `dotenv` et `config` (Zod) ; `.env` dans `.gitignore`. Pas de secret en dur dans le code.

### F) Observabilité

- **Logs** : Logger structuré JSON (`lib/logger.ts`), `requestId` dans errorHandler et dans le webhook.  
- **Stack** : Non loguée en production (`errorHandler.ts` l.32–34) ; non exposée dans la réponse JSON en prod (uniquement en `development`).  
- **Endpoints** : `GET /health` (toujours 200, champs `status`, `env`, `db`) ; `GET /ready` (200 si DB OK, 503 sinon).

### G) Tests

- **Présents** : Vitest ; health, ready, auth (register, login, /me, wrong issuer), auth refresh & logout, payments checkout (401, 400, succès, échec Stripe), stripe webhook (400 signature, 200, checkout.session.completed, **replay idempotence** 5× même event → 1 PaymentEvent + 1 Order update), **rate limit auth** (429 après dépassement).  
- **Couverture** : Replay webhook, auth invalide (wrong password, wrong issuer), routes protégées (401 sans token sur /me et checkout-session).  
- **CI** : Non vérifiée dans le dépôt ; à confirmer avec le client.

---

## 4) Plan d’action par lots (mission courte)

### Lot 1 – Cohérence webhook (P0)  
**Objectif** : Garantir qu’une commande ne reste jamais en `pending` alors qu’un événement Stripe a été enregistré (crash entre ledger et mise à jour).

- **Livrables**  
  - Dans `src/modules/stripe/stripe.webhook.ts`, exécuter `paymentEvent.create` et `order.updateMany` dans une **transaction Prisma** (`prisma.$transaction([create, updateMany])`). En cas d’échec, tout est annulé ; au retry Stripe, soit l’event n’est pas encore en base (on refait tout), soit il l’est (P2002 → NOOP).  
  - Alternative si transaction jugée lourde : job de réconciliation (ex. cron) qui sélectionne les `PaymentEvent` pour lesquels l’`Order` est encore `pending` et applique la mise à jour `paid` (avec prudence : vérifier que la session Stripe est bien complétée si besoin).

- **Critères de succès**  
  - Aucune commande ne reste `pending` alors qu’un `PaymentEvent` existe pour le même order/event.  
  - Tests existants (dont replay idempotence) toujours verts.

- **Estimation** : 4–8 h.  
- **Valeur métier** : Élimination du risque « j’ai payé mais ma commande n’est pas passée » en cas de crash.

---

### Lot 2 – RBAC & événements Stripe (P1)  
**Objectif** : Clarifier l’usage des rôles et des autres événements Stripe.

- **Livrables**  
  - Documenter (README ou doc interne) : `roleGuard` disponible, non branché ; liste des routes protégées et par quoi (authGuard).  
  - Si le métier exige des statuts `refunded` / `failed` : traiter `charge.refunded` (et/ou autres) de façon idempotente (PaymentEvent + mise à jour Order.status), avec les mêmes garde-fous que pour `checkout.session.completed`.

- **Critères de succès**  
  - Doc à jour ; si nouveaux événements traités, tests idempotence adaptés.

- **Estimation** : 2–6 h selon périmètre.  
- **Valeur métier** : Éviter les oublis de protection (admin) et aligner le statut commande avec les remboursements/échecs si requis.

---

### Lot 3 – Config prod & CI (P1/P2)  
**Objectif** : Valider la configuration production et la qualité continue.

- **Livrables**  
  - Checklist déploiement : CORS (liste d’origines), secrets (JWT, Stripe webhook), `NODE_ENV=production`.  
  - Intégration des tests (et lint) en CI (GitHub Actions, GitLab CI, ou autre) sur chaque push/PR.

- **Critères de succès**  
  - Prod démarre uniquement avec CORS explicites ; CI exécute `npm test` (et optionnellement `npm run lint`).

- **Estimation** : 2–4 h.  
- **Valeur métier** : Moins d’incidents de config et régressions détectées en amont.

---

### Lot 4 (optionnel) – Monitoring & réconciliation  
**Objectif** : Renforcer l’exploitabilité en prod.

- **Livrables**  
  - Si monitoring (Sentry, Datadog, etc.) : envoyer les erreurs 5xx (sans stack en prod si politique stricte).  
  - Optionnel : dashboard ou log pour suivre les écarts entre PaymentEvent et Order (détection d’anomalies).

- **Estimation** : 2–4 h.  
- **Valeur métier** : Détection plus rapide des incidents et incohérences.

---

## 5) Quick wins (≤ 2 h)

1. **Transaction webhook** : Regrouper `paymentEvent.create` et `order.updateMany` dans `prisma.$transaction` dans `stripe.webhook.ts`. Temps : ~1 h.  
2. **Documentation** : Ajouter dans le README la liste des routes protégées (GET /auth/me, POST /auth/logout-all, POST /payments/checkout-session) et rappeler que `roleGuard` est disponible pour un usage futur. Temps : ~20 min.  
3. **CI** : Fichier de pipeline (ex. `.github/workflows/test.yml`) qui lance `npm ci` et `npm test` (et éventuellement `npm run lint`). Temps : ~30 min.

---

## 6) Questions / besoins client

- **Stripe** : Un seul endpoint webhook par environnement ? Secret webhook distinct dev / staging / prod ?  
- **CORS** : Liste exacte des origines autorisées en production (URLs du front).  
- **JWT** : Valeurs souhaitées pour `JWT_ISSUER` et `JWT_AUDIENCE` en prod.  
- **Secrets** : Où sont stockés les secrets en prod (vault, variables d’env) ? Rotation prévue pour `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STRIPE_WEBHOOK_SECRET` ?  
- **CI** : Outil actuel (GitHub Actions, GitLab CI, autre) pour y intégrer `npm test` et lint.  
- **Monitoring** : Présence de Sentry, Datadog ou équivalent ; envoi des erreurs 5xx souhaité (et politique sur les stacks) ?  
- **Métier** : Faut-il refléter les remboursements ou échecs de paiement dans le statut des commandes (événements Stripe autres que `checkout.session.completed`) ?

---

## Références code (checklist audit)

- **Architecture** : `src/modules/{auth, health, payments, stripe}`, services dédiés, `AppError` + `errorHandler`.  
- **Stripe** : `stripe.service.ts` (metadata, client_reference_id), `checkout.service.ts` (Order + stripeSessionId), `stripe.webhook.ts` (raw body, signature, ACK 200, setImmediate, PaymentEvent + Order, P2002).  
- **Auth** : `token.service.ts` (access + iss/aud), `refreshToken.service.ts` (hash, rotation, révocation), `auth.cookies.ts` (HttpOnly, SameSite, Secure), `authGuard.ts` (verify iss/aud).  
- **Config** : `config/index.ts` (CORS refus de `*` en prod, JWT_ISSUER, JWT_AUDIENCE).  
- **Sécurité** : Helmet, CORS, rate limit auth/refresh/webhook, body limit 100kb + webhook, pas de stack en prod (logs et réponse).  
- **Health** : `health.routes.ts` : `/health`, `/ready`.  
- **Tests** : `tests/*.test.ts` (health, ready, auth, auth.refresh, payments.checkout, stripe.webhook dont replay idempotence et rate limit).
