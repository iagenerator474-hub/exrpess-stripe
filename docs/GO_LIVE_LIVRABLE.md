# Livrable Go-live (minimal)

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `src/config/index.ts` | `STRIPE_API_VERSION` (env, défaut 2025-02-24.acacia), `COOKIE_DOMAIN`, `TRUST_PROXY` ; `getCookieDomain()`, `getTrustProxy()` |
| `src/modules/stripe/stripe.service.ts` | Version Stripe lue depuis `config.STRIPE_API_VERSION` |
| `src/app.ts` | `trust proxy` si `TRUST_PROXY=1` ; CORS `credentials: true` quand origins explicites |
| `src/modules/auth/auth.cookies.ts` | Option `domain` cookie depuis `getCookieDomain()` |
| `.env.example` | `STRIPE_API_VERSION`, `COOKIE_DOMAIN`, `TRUST_PROXY` |
| `README.md` | Section **Go-live**, **Stripe webhook** (local vs prod, secrets distincts), **Rollback** ; variables `STRIPE_API_VERSION`, `COOKIE_DOMAIN`, `TRUST_PROXY` |

Aucun nouveau fichier créé (entrypoint et /health /ready déjà en place).

## Comportement

- **Config** : En prod, aucune variable critique n’a de fallback vide (Zod exige `min(1)` ou `startsWith(...)`). Si une variable manque → crash au boot avec message Zod.
- **Stripe** : Version d’API configurable via `STRIPE_API_VERSION` ; défaut = version actuelle du code.
- **CORS** : `CORS_ORIGINS` en liste (virgules) ; en prod `*` refusé. Si origins explicites, `credentials: true` pour les cookies.
- **Trust proxy** : Si `TRUST_PROXY=1` ou `true`, `app.set("trust proxy", 1)` pour X-Forwarded-*.
- **Cookies** : `COOKIE_SECURE` déjà déduit en prod ; `COOKIE_DOMAIN` optionnel pour sous-domaines.

## Instructions de validation

1. **Docker**
   ```bash
   docker compose up --build
   ```
   → L’app et Postgres démarrent ; pas de crash (fournir un `.env` complet).

2. **Ready**
   ```bash
   curl -s http://localhost:3000/ready
   ```
   → 200 et `{"status":"ready"}` si la DB répond.

3. **Paiement test**
   - Login sur la demo (ex. demo@example.com / DemoPassword12).
   - Créer une session checkout (Payer).
   - Compléter le paiement test Stripe.
   → Webhook reçu, Order en DB en `paid`.

4. **Cookies secure en prod**
   - En HTTPS avec `NODE_ENV=production`, le cookie refresh doit avoir l’attribut `Secure`.
   - Vérification manuelle : DevTools → Application → Cookies sur l’URL de l’API.

## Rollback (README)

- Redéployer le tag/image précédent.
- Les migrations Prisma peuvent être irréversibles : tester en staging, éviter les migrations destructives sans sauvegarde DB.
