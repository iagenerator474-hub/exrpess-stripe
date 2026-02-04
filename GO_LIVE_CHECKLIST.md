# Checklist Go-Live

- [ ] Aucun `.env` committé ou dans le ZIP
- [ ] `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` définis (min 16 car.)
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (prod), `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` définis
- [ ] `CORS_ORIGINS` = liste explicite (pas `*`)
- [ ] `NODE_ENV=production`
- [ ] `TRUST_PROXY=1` si app derrière Nginx/Render/Fly
- [ ] Webhook Stripe prod : URL HTTPS, événement `checkout.session.completed`, signing secret en env (distinct du local)
- [ ] Cookies : en prod HTTPS, `COOKIE_SECURE` true (défaut) ; `COOKIE_DOMAIN` si front sous-domaine
- [ ] Entrypoint / démarrage : `prisma migrate deploy` avant `node dist/index.js`
- [ ] Healthcheck plateforme sur `GET /ready` (200 = prêt)
- [ ] Paiement test de bout en bout : checkout → paiement → Order en DB en `paid`
- [ ] Rejeu webhook : idempotence OK (un seul traitement par event.id)
- [ ] Rollback documenté : redéployer tag/image précédent ; migrations peuvent être irréversibles
- [ ] Logs / Stripe Dashboard (Webhooks → Logs) connus pour le support
