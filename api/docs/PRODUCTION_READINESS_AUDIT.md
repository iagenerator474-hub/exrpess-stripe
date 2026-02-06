# Audit readiness production (API)

Vérification : Docker, Health/Ready, migrations, validation config prod, logs.

---

## 1. Verdict : **GO PROD** (sous conditions)

La base est prête pour la prod : Docker multi-stage, health/ready, migrations dans l’entrypoint, validation config prod stricte, logs structurés avec requestId. Aucun blocant. Les hardenings listés ci-dessous sont des améliorations priorisées, pas des prérequis au GO.

---

## 2. Points vérifiés

| Critère | État | Détail |
|---------|------|--------|
| **Docker multi-stage** | OK | `Dockerfile` : base → deps → builder → runner. Build dans builder (prisma generate + npm run build), image finale avec dist + node_modules + prisma + entrypoint. User non-root (`USER node`), `curl` disponible pour healthchecks. |
| **Health / Ready** | OK | `GET /health` : SELECT 1 + status db (ok/degraded), 200 ou 503 ; `env` optionnel si `HEALTH_EXPOSE_ENV=true`. `GET /ready` : SELECT 1 + product.count(), 200 ou 503. Pas de fuite de secrets ni de versions. Routes après `requestId` → header `x-request-id` présent. |
| **Migrations automatiques** | OK | `entrypoint.sh` : `npx prisma migrate deploy` puis `exec node dist/index.js`. Migrations appliquées avant démarrage du process. En prod, boot check `stripe_payment_intent_id` → exit(1) si colonne manquante. |
| **Validation config prod** | OK | `validateProductionConfig()` : CORS ≠ * , clé Stripe live, webhook secret (format, longueur, anti-placeholder), ENABLE_DEMO false, JWT ≥ 32, TRUST_PROXY si REQUIRE_TRUST_PROXY_IN_PROD. DATABASE_URL validée (Postgres). LoadConfig au démarrage → crash si invalide. |
| **Logs exploitables** | OK | JSON structuré (level, message, timestamp) ; requestId sur les requêtes ; pas de PII/secrets (règle dans logger). ErrorHandler log requestId, statusCode, method, path ; stack uniquement en dev ou si LOG_STACK_IN_PROD. |

---

## 3. Hardening priorisé

| Priorité | Action | Risque si non fait |
|----------|--------|--------------------|
| **P1** | ~~Ajouter un **.dockerignore**~~ **Fait** : `api/.dockerignore` exclut `node_modules`, `dist`, `.env`, tests, coverage, `.git`. | — |
| **P2** | Healthcheck dans le Dockerfile : `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD curl -f http://localhost:3000/health \|\| exit 1`. | Orchestrateur (Kubernetes, ECS, etc.) ne détecte pas un process up mais DB down. |
| **P2** | Documenter en checklist : après déploiement, appeler `GET /ready` et vérifier 200. | Load balancer peut envoyer du trafic avant que le schéma soit prêt (rare si migrations dans entrypoint). |
| **P3** | Optionnel : exposer une métrique “migrations applied” (version ou hash) dans `/health` en lecture seule (sans secret). | Pas de blocant ; utile pour observabilité. |

---

## 4. Commandes de vérification

**Build et run local (simulation prod)**

```bash
cd api
docker build -t api:audit .
docker run --rm -e NODE_ENV=production -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e STRIPE_SECRET_KEY=sk_live_xxx -e STRIPE_WEBHOOK_SECRET=whsec_xxx -e STRIPE_SUCCESS_URL=https://... -e STRIPE_CANCEL_URL=https://... \
  -e CORS_ORIGINS=https://app.example.com -e JWT_ACCESS_SECRET=$(openssl rand -base64 32) -e TRUST_PROXY=1 \
  -p 3000:3000 api:audit
```

**Health / Ready**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health   # 200 ou 503
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ready     # 200 ou 503
curl -s http://localhost:3000/health | jq .
curl -s http://localhost:3000/ready | jq .
```

**Vérifier l’absence de fuites**

```bash
curl -s http://localhost:3000/health | jq .   # pas de clé Stripe, pas de version détaillée
curl -s http://localhost:3000/ready          # uniquement {"status":"ready"} ou "not ready"
```

**Config prod (crash attendu si invalide)**

```bash
# Sans CORS explicite en prod → crash au démarrage
docker run --rm -e NODE_ENV=production -e CORS_ORIGINS='*' ...   # doit échouer
# Sans TRUST_PROXY alors que REQUIRE_TRUST_PROXY_IN_PROD=true → crash
# Sans JWT_ACCESS_SECRET 32+ en prod → crash
```

**Migrations**

```bash
# Dans le container (ou sur la machine qui exécute entrypoint)
npx prisma migrate deploy
# Puis vérifier que l’app démarre (pas de log "Migration required: column Order.stripe_payment_intent_id is missing")
```

**Logs (requestId)**

```bash
# Une requête doit produire des lignes JSON avec le même requestId (et header x-request-id)
curl -v http://localhost:3000/health 2>&1 | grep -i x-request-id
```

---

## 5. Résumé

- **GO PROD** : oui, sous réserve du respect de la checklist déploiement (env, Stripe Dashboard, migrations, TRUST_PROXY, etc.).
- **Docker** : multi-stage OK ; ajouter `.dockerignore` (P1) et HEALTHCHECK (P2).
- **Health/Ready** : conformes, sans fuite ; utiliser pour sonde de vie et readiness.
- **Migrations** : automatiques dans l’entrypoint ; boot check colonne critique en prod.
- **Config** : validation prod stricte au démarrage.
- **Logs** : structurés, requestId, sans PII/secrets ; exploitables pour investigation et alerting.
