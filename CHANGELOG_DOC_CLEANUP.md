# Nettoyage doc livraison client

## Fichiers supprimés

- `DELIVERY_AUDIT.md`
- `docs/AUDIT_BACKEND.md`
- `docs/AUDIT_HARDENING_LIVRABLE.md`
- `docs/AUDIT_LIVRAISON_FINALE.md`
- `docs/DEMARRER_POSTGRES_WINDOWS.md`
- `docs/GO_LIVE_LIVRABLE.md`
- `docs/PROCEDURE_LANCEMENT_TEST_DEMO.md`
- `docs/PROCEDURE_VALIDATION_SMOKE.md`
- `docs/PROD_READY_LIVRABLES.md`
- `docs/PROD_READY_PLAN.md`
- `docs/ZIP_RELEASE_CHECKLIST.md`

## Fichiers modifiés

- **README.md** — Refonte courte : Project, Quickstart, Env vars (table), Stripe (local vs prod), DB, Commands, liens SMOKE_TEST / GO_LIVE_CHECKLIST, Deploy.
- **SMOKE_TEST.md** — Remplacé par version courte (~12 lignes).
- **GO_LIVE_CHECKLIST.md** — Remplacé par checklist 14 items.
- **package.json** — Scripts : `dev`, `build`, `start`, `test`, `lint`, `db:migrate`, `db:seed`, `postinstall`. Supprimés : `test:watch`, `lint:fix`, `prisma:generate`, `prisma:migrate`, `prisma:migrate:deploy`, `prisma:studio`.
- **src/app.ts** — Commentaires tuto supprimés ; ajout commentaire trust proxy.
- **src/config/index.ts** — Commentaire Stripe API version supprimé.
- **src/modules/auth/auth.cookies.ts** — Commentaire raccourci (cookie ms, httpOnly, secure).
- **src/modules/health/health.routes.ts** — Commentaire dans catch supprimé.
- **src/modules/stripe/stripe.routes.ts** — Commentaire réduit (raw body pour signature).
- **src/modules/stripe/stripe.webhook.ts** — Commentaires réduits (signature, idempotence, ACK, snapshot, P2002).
- **src/middleware/errorHandler.ts** — Commentaire 404 supprimé.
- **src/middleware/roleGuard.ts** — Commentaire factory supprimé.

Logique métier inchangée (Stripe, Auth, DB).
