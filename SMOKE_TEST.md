# Smoke test (manuel)

1. **Démarrer** : `docker compose up -d postgres` puis `npm run db:migrate && npm run dev`
2. **Health** : `curl -s http://localhost:3000/health` → 200, `"db":"up"` ; `curl -s http://localhost:3000/ready` → 200
3. **Auth** : `curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"demo@example.com","password":"DemoPassword12"}'` → 200 + `accessToken` (après `npm run db:seed` si besoin)
4. **Checkout** : avec le token, `POST /payments/checkout-session` body `{"amount":1000,"currency":"eur"}` → 200 + `checkoutUrl` ; ouvrir l’URL, payer (carte test 4242…), revenir
5. **DB** : la commande créée passe en `status = paid` après réception du webhook
6. **Webhook idempotence** (optionnel) : `stripe listen --forward-to http://localhost:3000/stripe/webhook` ; rejouer le même event → logs « already processed », un seul update en DB
