# Plan prod-ready – Inventaire et lots (Phase 0)

## 10 points les plus risqués / fragiles (P0/P1/P2)

| # | Priorité | Point | Preuve (fichier) |
|---|----------|--------|-------------------|
| 1 | **P0** | Crash entre `PaymentEvent.create` et `order.updateMany` → commande restée `pending` sans retry qui la corrige | `src/modules/stripe/stripe.webhook.ts` L47–62 : chaîne `.then()` sans transaction |
| 2 | P0 (déjà traité) | Idempotence webhook (même event.id traité 2×) | PaymentEvent + P2002 NOOP déjà en place |
| 3 | P1 (déjà traité) | CORS `*` en prod | `src/config/index.ts` L41–44 : fail fast si prod + CORS_ORIGINS=* |
| 4 | P1 (déjà traité) | JWT sans iss/aud | `token.service.ts` + `authGuard.ts` : issuer et audience utilisés |
| 5 | P1 (déjà traité) | Stack trace en prod | `errorHandler.ts` L32–34 : stack seulement si NODE_ENV !== production |
| 6 | P1 (déjà traité) | Body size illimité | `app.ts` L48 : `express.json({ limit: "100kb" })` ; webhook raw limit dans stripe.routes |
| 7 | P1 (déjà traité) | Cookies refresh non sécurisés | `auth.cookies.ts` : HttpOnly, SameSite=lax, Secure selon config |
| 8 | P1 (déjà traité) | Rate limit login/refresh | `app.ts` authLimiter ; `auth.routes.ts` refreshLimiter |
| 9 | P2 | Pas de CI (lint + test) | Aucun dossier `.github/workflows` ou équivalent |
| 10 | P2 (déjà traité) | Pas de /ready | `health.routes.ts` : GET /ready présent |

## Plan en 4 lots (estimations)

| Lot | Objectif | Estimation |
|-----|----------|------------|
| **Lot 1** | P0 Webhook crash-safe : transaction Prisma (PaymentEvent + Order) + P2002 => NOOP + tests (replay, happy path) | 2–3 h |
| **Lot 2** | P0/P1 Auth : vérifier JWT exp/iss/aud, cookies, rate limit ; tests 401 + rate limit (déjà en place, vérif + doc) | 0,5 h |
| **Lot 3** | P1 Sécurité prod : CORS, Helmet, body limits, pas de stack en prod, validation env au boot ; test config (CORS * prod => throw) | 1 h |
| **Lot 4** | P1/P2 Observabilité + qualité : requestId dans réponses erreur (déjà), logs Stripe eventId/sessionId (déjà), format erreurs cohérent, CI lint+test, /ready (déjà) | 1–2 h |

**Total estimé : 4,5–6,5 h** (dans la cible 1–2 jours).
