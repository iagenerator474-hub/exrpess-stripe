# Audit livraison finale — Backend Express + Stripe + Auth

**Périmètre :** backend Express/TS, Prisma/PostgreSQL, Stripe Checkout + webhooks, auth cookies/JWT, déploiement Docker.  
**Objectif :** fiabilité, sécurité, déploiement simple, doc client. Aucun refactor de style ; flow Stripe et DB inchangés.

---

## 1) Risques critiques (bloquants prod) + correctifs

| # | Risque | Statut | Correctif / Où |
|---|--------|--------|----------------|
| C1 | **Secrets committés ou dans ZIP** | ✅ Vérifié | `.gitignore` contient `.env`, `.env.*.local`. Aucune clé réelle dans code/README. Procédure ZIP : exclure `.env`. En cas de fuite : rotation immédiate (Stripe, JWT, DB). |
| C2 | **Webhook Stripe sans vérification de signature** | ✅ OK | `stripe.webhook.ts` : body brut (`express.raw`), `stripe.webhooks.constructEvent(body, sig, secret)` ; 400 si invalide. |
| C3 | **Webhook ACK lent → retries Stripe** | ✅ OK | Réponse 200 immédiate après validation signature ; traitement en `setImmediate(processEvent)`. |
| C4 | **Pas d’idempotence webhook → doublons** | ✅ OK | `PaymentEvent` avec contrainte unique `stripe_event_id` ; insert puis update Order en transaction ; rejeu ignoré. |
| C5 | **CORS `*` avec credentials** | ✅ OK | `CORS_ORIGINS` requis en prod (Zod), pas de `*` si cookies ; `credentials: true` avec origines explicites. |
| C6 | **Cookies refresh non sécurisés** | ✅ OK | HttpOnly, Secure (prod), SameSite=Lax, `maxAge` en ms. |
| C7 | **Migrations non appliquées en prod** | ✅ OK | `entrypoint.sh` exécute `prisma migrate deploy` avant `node dist/index.js`. |
| C8 | **Pas de /ready pour orchestrateur** | ✅ OK | `GET /ready` → 200 si DB OK, 503 sinon. |
| C9 | **Variables critiques manquantes au démarrage** | ✅ OK | Config Zod : fail-fast si `DATABASE_URL`, Stripe, JWT, `CORS_ORIGINS` manquants. |

**Aucun correctif bloquant restant à appliquer** — déjà en place.

---

## 2) Risques importants (à faire avant livraison) + correctifs

| # | Risque | Statut | Correctif / Où |
|---|--------|--------|----------------|
| I1 | **Trust proxy absent derrière Nginx/Render/Fly** | ✅ OK | `app.set('trust proxy', 1)` si `TRUST_PROXY=1` (config). |
| I2 | **Rate limit login/refresh/webhook** | ✅ OK | Middlewares rate-limit sur `/auth/login`, `/auth/refresh`, `/stripe/webhook` (configurables via env). |
| I3 | **Logs avec tokens ou PII** | ✅ OK | Logger structuré ; pas de tokens dans les logs ; payload webhook stocké en snapshot minimal (pas d’objet complet PII). |
| I4 | **Version API Stripe non pinnée** | ✅ OK | `STRIPE_API_VERSION` (défaut `2025-02-24.acacia`) ; doc README pour alignement Dashboard. |
| I5 | **Documentation client insuffisante** | ✅ Traité | README : prérequis, table variables env, procédure déploiement, Stripe local vs prod, rollback, **Checklist Go-Live**, **Support** (où regarder en cas d’erreur). |
| I6 | **Docker tourne en root** | ✅ Traité | Dockerfile : `USER node` en phase runner (image Alpine fournit l’utilisateur `node`). |

---

## 3) Améliorations optionnelles (nice-to-have) + estimations

| # | Amélioration | Estimation | Commentaire |
|---|--------------|------------|-------------|
| O1 | Backup DB automatisé (cron + pg_dump) | 0,5 j | Documenter dans README ; script exemple ou note pour Render/Fly/VPS. |
| O2 | Alerting (ex. healthcheck failing → notification) | 0,5 j | Dépend de l’hébergeur (Render/Fly ont des options). |
| O3 | Tests d’intégration avec vraie DB + Stripe test | 1 j | Actuellement mocks ; optionnel pour livraison minimale. |
| O4 | Limite de taille body webhook (DoS) | Déjà | `WEBHOOK_BODY_LIMIT` (défaut 1mb) configuré. |
| O5 | HTTPS redirect (si app expose direct) | 0,25 j | Souvent géré par Nginx/Render/Fly ; documenter si VPS nu. |

---

## 4) Checklist Go-Live client (10–20 items)

Voir **README.md**, section « Checklist Go-Live client ».

Résumé : prérequis Node/Postgres/Stripe, `.env` sans secrets versionnés, variables obligatoires remplies, CORS et cookies prod, Stripe webhook prod (Dashboard + secret), Docker/entrypoint migrations, health/ready, rollback et support documentés.

---

## 5) Fichiers modifiés (patchs appliqués pour cet audit)

| Fichier | Modification |
|---------|--------------|
| `README.md` | Ajout section **Checklist Go-Live client** (items numérotés) et section **Support** (logs, /ready, Stripe events). |
| `Dockerfile` | Ajout `USER node` en phase runner pour exécution non-root. |
| `docs/AUDIT_LIVRAISON_FINALE.md` | **Nouveau** : rapport d’audit (ce document). |
| `docs/PROCEDURE_VALIDATION_SMOKE.md` | **Nouveau** : procédure de validation reproductible (smoke test). |

Aucun changement sur : Stripe (webhook, checkout), auth (cookies, JWT), Prisma (migrations, schéma), routes métier.

---

## 6) Procédure de validation (smoke test) reproductible

Voir **docs/PROCEDURE_VALIDATION_SMOKE.md** pour la procédure détaillée.

**Résumé rapide :**

1. **Environnement** : `.env` complet (DB, JWT, Stripe, `STRIPE_WEBHOOK_SECRET`, `CORS_ORIGINS`).
2. **Démarrage** : `docker compose up --build` ou `npm run build && npm start` ; pas d’erreur au démarrage.
3. **Health** : `GET /health` → 200, `db: "up"` ; `GET /ready` → 200.
4. **Auth** : `POST /auth/register` puis `POST /auth/login` → 200, `accessToken` présent.
5. **Checkout** : avec token, `POST /payments/checkout-session` → 200, redirection Stripe ; paiement test → Order en DB en `paid`.
6. **Webhook idempotence** : rejouer le même `event.id` → un seul `PaymentEvent`, un seul update Order (logs « already processed »).
7. **Cookie** : après login, cookie `refreshToken` HttpOnly, Secure (en prod), Max-Age cohérent.

---

*Document généré dans le cadre de l’audit livraison finale. À conserver ou copier dans README/Notion selon besoin client.*
