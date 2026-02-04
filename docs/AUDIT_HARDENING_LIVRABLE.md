# Audit technique et hardening backend — livrable

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `.gitignore` | `.env.*.local`, commentaire rappelant de ne pas committer/zipper `.env` |
| `README.md` | Section « Secrets et fichier .env », variables minimales, Docker (Postgres seul + full), Stripe CLI vs Dashboard, `/health` 200/503 |
| `src/modules/auth/auth.cookies.ts` | `maxAge` en millisecondes (Express), calcul depuis `expiresAt` clampé ≥ 0, commentaire de garde |
| `docker-compose.yml` | `NODE_ENV` défaut `development`, `CORS_ORIGINS` défaut `http://localhost:3000`, suppression fallback vide `STRIPE_WEBHOOK_SECRET`, ajout `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` obligatoires |
| `src/modules/health/health.routes.ts` | `/health` retourne 503 + `status: "degraded"` quand la DB est down |
| `entrypoint.sh` | **Nouveau** : `prisma migrate deploy` puis `node dist/index.js` |
| `Dockerfile` | Copie `entrypoint.sh`, `ENTRYPOINT ["./entrypoint.sh"]` |
| `src/modules/stripe/stripe.service.ts` | Client Stripe avec `apiVersion: "2025-02-24.acacia"` (version pinnée) |
| `src/modules/stripe/stripe.webhook.ts` | Payload `PaymentEvent` : snapshot minimal (type, ids, amount_total, currency, payment_status) au lieu de tout `event.data.object` |
| `tests/health.test.ts` | Accepte 200 (DB up) ou 503 (DB down) avec `status` / `db` cohérents |

## Résumé des changements

### 1) Sécurité des secrets (CRITIQUE)
- `.env` déjà dans `.gitignore` ; renforcement avec `.env.*.local` et commentaire.
- README : section dédiée `.env.example` vs `.env`, interdiction de commit/zip, rotation en cas d’exposition.

### 2) Correction bug cookies auth (IMPORTANT)
- **Avant** : `maxAge` passé en secondes → cookie expirait trop tôt (Express attend des ms).
- **Après** : `maxAgeMs = max(0, expiresAt - now)`, `res.cookie(..., { maxAge: maxAgeMs })`, commentaire pour éviter régression.

### 3) Docker / environnement (COHÉRENCE)
- `NODE_ENV` par défaut `development` ; `CORS_ORIGINS` par défaut `http://localhost:3000`.
- Plus de fallback vide pour `STRIPE_WEBHOOK_SECRET` : si absent, la config (zod) fait échouer le démarrage avec un message clair.

### 4) Prisma / PostgreSQL (PROD-READY)
- **Entrypoint** : au démarrage du container, `prisma migrate deploy` puis `node dist/index.js`. En dev, `prisma migrate dev` reste inchangé.
- **`/health`** : 200 si DB up, 503 si DB down (body `status: "degraded"`, `db: "down"`).

### 5) Stripe hardening (SANS casser)
- **Version d’API** : client instancié avec `apiVersion: "2025-02-24.acacia"`.
- **Payload** : enregistrement d’un snapshot minimal (type, stripeEventId, orderId, stripeSessionId, amount_total, currency, payment_status) au lieu de tout l’objet Stripe. Signature, idempotence et comportement métier inchangés.

### 6) Documentation
- README : Stripe CLI (local) vs Dashboard (prod), variables requises, commande Docker pour Postgres seul.

---

## Procédure de validation

1. **Docker Compose (app + Postgres)**  
   Avec un `.env` complet (JWT, Stripe, `STRIPE_WEBHOOK_SECRET`, etc.) :
   ```bash
   docker compose up --build
   ```
   Vérifier : pas de crash au démarrage, logs « migrations applied » puis serveur à l’écoute.

2. **Checkout Stripe OK**  
   - Démarrer l’app (local ou Docker).
   - Login demo → « Payer » → redirection Stripe Checkout → paiement test → retour demo.
   - Vérifier en base : `Order.status = paid`.

3. **Webhook reçu sans doublon**  
   - En local : `stripe listen --forward-to localhost:3000/stripe/webhook`, déclencher un paiement.
   - Vérifier : un seul `PaymentEvent` par `stripe_event_id`, une seule mise à jour de la commande (idempotence).
   - Rejouer le même événement : logs « Stripe event already processed », pas de second update.

4. **Cookie refresh durée correcte**  
   - Login → inspecter le cookie `refreshToken` (DevTools → Application → Cookies).
   - Vérifier que `Max-Age` est cohérent avec la TTL (ex. ordre de grandeur 30 jours en secondes ≈ 2,5e6 s, donc en ms ≈ 2,5e9).

5. **`/health` retourne 200 ou 503**  
   - DB up : `curl -s http://localhost:3000/health` → 200, `"status":"ok"`, `"db":"up"`.
   - DB down (arrêter Postgres) : même URL → 503, `"status":"degraded"`, `"db":"down"`.

---

## Contenu du fichier `entrypoint.sh`

```sh
#!/bin/sh
set -e
# Apply migrations before starting the app (prod / Docker). Dev: use prisma migrate dev.
npx prisma migrate deploy
exec node dist/index.js
```
