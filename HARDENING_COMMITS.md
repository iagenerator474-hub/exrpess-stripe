# Plan de commits — hardening client-ready prod

Un commit par item, dans l’ordre ci-dessous.

---

1. **Sécurité des erreurs (errorHandler)**  
   - Fichiers : `api/src/middleware/errorHandler.ts`, `api/tests/errorHandler.test.ts`  
   - Message suggéré :  
   `fix(errors): sanitize 500 in prod, always log stack+requestId+route`

2. **Stripe webhook ledger robuste (PaymentEvent orphaned)**  
   - Fichiers : `api/prisma/schema.prisma`, `api/prisma/migrations/20260205000000_payment_event_orphaned/migration.sql`, `api/src/modules/stripe/stripe.webhook.ts`, `api/tests/stripe.webhook.test.ts`  
   - Message suggéré :  
   `feat(stripe): PaymentEvent orderId nullable + orphaned, ledger even when order missing`

3. **Graceful shutdown**  
   - Fichiers : `api/src/index.ts`  
   - Message suggéré :  
   `feat(server): graceful shutdown on SIGTERM/SIGINT, server.close + prisma disconnect`

4. **CORS sans fallback**  
   - Fichiers : `api/src/app.ts`  
   - Message suggéré :  
   `fix(cors): no fallback list[0], refuse unknown origin, allow missing origin`

5. **Rate limit checkout**  
   - Fichiers : `api/src/config/index.ts`, `api/src/modules/payments/payments.routes.ts`, `api/.env.example`, `api/vitest.config.ts`  
   - Message suggéré :  
   `feat(payments): rate limit POST /payments/checkout-session (30/min)`

6. **Docs validation**  
   - Fichiers : `HARDENING_VALIDATION.md`, `HARDENING_COMMITS.md`  
   - Message suggéré :  
   `docs: hardening validation checklist and commit plan`
