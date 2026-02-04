# Audit — Production readiness & client deliverability

**Date:** 2026-02  
**Scope:** Backend API (Express, Stripe Checkout, PostgreSQL, Prisma, Docker). No frontend.  
**Target:** Non-technical client + internal dev handover.

---

## Executive summary

The API is **structurally sound** for production: Stripe webhooks are signature-verified and idempotent, payments are recorded in the database as the source of truth, and auth uses single-use refresh tokens with secure cookies. No critical security or payment-risk blockers were found. **One important gap:** the Docker setup does not define a healthcheck for the app, which can cause issues when deploying behind a load balancer or on platforms (Render, Fly, etc.). With a small fix (add app healthcheck and optional production tweaks below), the repository is **deliverable**. Delivering as-is is acceptable if the client runs the app in an environment that does not rely on HTTP healthchecks.

---

## Blockers

- **None.** No issues that would prevent a safe, correct production deployment from a security, data loss, or payment-integrity perspective.

---

## Important (non-blocking)

1. **Docker: no healthcheck on app service**  
   Postgres has a healthcheck; the API service does not. Platforms and reverse proxies often use a readiness endpoint to know when to send traffic. **Action:** Add a healthcheck to the `app` service in `docker-compose.yml` (e.g. `GET /ready` every 10–30s). See “Delivery checklist” below.

2. **TRUST_PROXY not in docker-compose env**  
   When the API runs behind Nginx/Render/Fly, `TRUST_PROXY=1` is required for correct client IP and cookies. It is documented in README and GO_LIVE_CHECKLIST but not listed in the compose env. **Action:** Document that production deployments behind a proxy must set `TRUST_PROXY=1` (or add it to the compose `environment` section with a comment).

3. **Stripe key prefix logged at startup**  
   `api/src/index.ts` logs a masked Stripe key (e.g. `sk_test_51…xyz1`) on every startup. In production this can appear in logs. **Action:** Log this only when `NODE_ENV !== "production"` (nice-to-have, low risk).

---

## Nice-to-have

- **README:** One sentence stating that secrets are never baked into the Docker image (they come from env at runtime).
- **Rate limit on checkout:** Optional rate limit on `POST /payments/checkout-session` (auth is already required; limits would further reduce abuse).
- **PROCEDURE_LANCEMENT.md / README:** Already clear; ensure the client has the link and knows to use GO_LIVE_CHECKLIST before go-live.

---

## Delivery checklist (fix before sending to client)

- [ ] **Add app healthcheck** in `docker-compose.yml` for the `app` service. Example (Node, no extra deps):
  ```yaml
  healthcheck:
    test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/ready', (r) => { let b = ''; r.on('data', c => b += c); r.on('end', () => process.exit(r.statusCode === 200 ? 0 : 1)); }).on('error', () => process.exit(1));"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 10s
  ```
  Or install `curl` in the Dockerfile and use `curl -f http://localhost:3000/ready`.
- [ ] **Document TRUST_PROXY** for production (in README or GO_LIVE_CHECKLIST): “If the API is behind a reverse proxy (Nginx, Render, Fly), set `TRUST_PROXY=1` in the environment.”
- [ ] **Optional:** In `api/src/index.ts`, log the Stripe key prefix only when `config.NODE_ENV !== "production"`.
- [ ] **Final check:** No `.env` or real secrets in the repo or in any delivery ZIP; README and PROCEDURE_LANCEMENT point to GO_LIVE_CHECKLIST for go-live.

---

## Verification summary

| Area | Status | Notes |
|------|--------|------|
| **Secrets** | OK | `.env` in `.gitignore`; not copied into Dockerfile; config validated at startup (Zod). |
| **.env / config** | OK | `api/.env.example` complete; production rejects `CORS_ORIGINS=*`. |
| **node_modules / build** | OK | Ignored; Docker multi-stage builds in `api/`; no artifacts committed. |
| **README / setup** | OK | Quickstart, PROCEDURE_LANCEMENT, SMOKE_TEST, GO_LIVE_CHECKLIST; reproducible local and Docker setup. |
| **Webhook signature** | OK | Raw body + `stripe.webhooks.constructEvent`; invalid signature → 400. |
| **Idempotency** | OK | `PaymentEvent.stripeEventId` unique (P2002 handled); Order updated only when `status != 'paid'`. |
| **DB as source of truth** | OK | Order status and payment state in DB; Stripe events recorded in `PaymentEvent`. |
| **ACK strategy** | OK | 200 returned immediately; `setImmediate(processEvent)` for async work. |
| **Docker image** | OK | Multi-stage; runs as non-root `node`; entrypoint runs `prisma migrate deploy` then `node dist/index.js`. |
| **Migrations** | OK | `entrypoint.sh` runs `prisma migrate deploy` before starting the app. |
| **Docker app healthcheck** | Missing | Add `GET /ready` healthcheck for the app service (see checklist). |

---

## Final verdict

**Deliverable with fixes**

- **Not deliverable as-is** only if the client’s deployment relies on HTTP healthchecks (e.g. cloud PaaS, load balancer). In that case, add the app healthcheck and the small items in the delivery checklist, then deliver.
- **Deliverable as-is** if the client runs the app in a context where healthchecks are not used (e.g. single instance, manual ops). The codebase is production-ready from a security and payment-reliability standpoint; remaining items are operational and documentation improvements.

Recommendation: **implement the healthcheck and TRUST_PROXY documentation**, then hand over with README + PROCEDURE_LANCEMENT + GO_LIVE_CHECKLIST so the client and the next dev can run and deploy safely.
