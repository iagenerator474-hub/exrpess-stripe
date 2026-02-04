# Livrables prod-ready – Modifications et validation

## 1) Modifications par lots (fichiers modifiés)

### Lot 1 – Webhook crash-safe (P0)
| Fichier | Modification |
|---------|--------------|
| `src/modules/stripe/stripe.webhook.ts` | Remplacement de la chaîne `paymentEvent.create` + `order.updateMany` par une **transaction Prisma** `$transaction(async (tx) => { create; return updateMany })`. P2002 => NOOP inchangé. Log d’erreur enrichi avec `stripeEventId`. |
| `tests/stripe.webhook.test.ts` | Mock de `prisma.$transaction` (factory avec `prismaInstance` pour hoisting). Test ajouté : **« uses transaction (create PaymentEvent + updateMany Order) for crash-safe processing »** (assertion que `$transaction` est appelé et que create + updateMany sont appelés). |

### Lot 2 – Auth (P0/P1) – Vérification uniquement
- Aucune modification de code : JWT exp/iss/aud, cookies HttpOnly/Secure/SameSite, rate limit login et refresh déjà en place. Tests existants (401 wrong password, 429 rate limit, 401 wrong issuer) conservés.

### Lot 3 – Sécurité prod (P1) – Vérification uniquement
- Aucune modification : CORS refusé en prod si `*`, Helmet, body limit 100kb, pas de stack en prod dans les logs, validation env au boot (Zod + fail fast CORS) déjà en place.

### Lot 4 – Observabilité + qualité (P1/P2)
| Fichier | Modification |
|---------|--------------|
| `.github/workflows/ci.yml` | **Création** : pipeline CI (lint sur `src` + test) sur push/PR (branches master, main). |
| `package.json` | Script lint : `eslint src` (tests hors projet TS, pas de changement tsconfig). |
| `src/middleware/errorHandler.ts` | Utilisation de `req` au lieu de `_req` pour éviter variable inutilisée (lint). |
| `src/modules/payments/checkout.service.ts` | `catch` sans variable inutilisée `err` (lint). |
| `docs/PROD_READY_PLAN.md` | **Création** : inventaire 10 points + plan 4 lots. |
| `docs/PROD_READY_LIVRABLES.md` | **Création** : ce document (checklist, changelog, non-fait). |

**requestId** : déjà présent dans `errorHandler`, header `x-request-id`, et webhook (processEvent).  
**Logs Stripe** : eventId/sessionId déjà logués sans payload complet en prod.  
**Format erreurs** : déjà cohérent `{ error, requestId? }`.  
**GET /ready** : déjà présent (`health.routes.ts`).

---

## 2) Tests ajoutés / ajustés

| Test | Fichier | Description |
|------|---------|-------------|
| **uses transaction (create PaymentEvent + updateMany Order) for crash-safe processing** | `tests/stripe.webhook.test.ts` | Vérifie que le webhook appelle `prisma.$transaction` et que `paymentEvent.create` et `order.updateMany` sont invoqués (traitement crash-safe). |
| Ajustement mocks | `tests/stripe.webhook.test.ts` | Mock de `$transaction` en factory pour compatibilité hoisting Vitest ; `beforeEach` réinitialise `order.updateMany`, `paymentEvent.create`, `$transaction`. |

Les tests existants suivants restent en place et passent :  
replay 5× même event → 1 seul effet ; 400 signature manquante/invalide ; 200 valide ; checkout.session.completed avec metadata.orderId.

---

## 3) Checklist de validation locale

| Étape | Commande / action | Résultat attendu |
|-------|-------------------|------------------|
| 1. Install | `npm ci` | Dépendances installées sans erreur. |
| 2. Lint | `npm run lint` | Aucune erreur ESLint. |
| 3. Tests | `npm test` | Tous les tests passent (dont stripe webhook, auth, health, payments). |
| 4. Build | `npm run build` | Compilation TS sans erreur (`dist/` généré). |
| 5. Démarrer (sans DB) | `npm start` ou `node dist/index.js` | Avec `.env` valide (DATABASE_URL, JWT, Stripe) : app écoute sur le port configuré. |
| 6. CORS prod | `NODE_ENV=production CORS_ORIGINS=*` + démarrer | L’app **refuse de démarrer** (Invalid environment configuration). |
| 7. Health / Ready | `curl -s http://localhost:3000/health` et `curl -s http://localhost:3000/ready` | `/health` → 200 + JSON (status, env, db) ; `/ready` → 200 si DB OK, 503 si DB down. |
| 8. Docker (optionnel) | `docker compose up --build` | Conteneurs démarrent ; app répond sur le port configuré. |

---

## 4) Changelog client (10 lignes)

1. **Paiements Stripe** : Le traitement des webhooks est désormais **crash-safe** : enregistrement de l’événement et mise à jour de la commande sont effectués dans une seule transaction. En cas de crash, aucun état partiel (commande restée en attente alors que l’événement est enregistré).
2. **Idempotence** : Un même événement Stripe reçu plusieurs fois (retries) ne produit qu’**un seul** effet en base (déjà en place, renforcé par la transaction).
3. **Authentification** : Vérification des tokens JWT (expiration, émetteur, audience optionnelle), cookies de refresh sécurisés (HttpOnly, Secure en prod), limitation du nombre de tentatives de connexion et de refresh.
4. **Sécurité production** : En production, CORS doit être configuré avec une liste d’origines (pas de `*`) ; l’application refuse de démarrer sinon.
5. **Limite de taille des requêtes** : Corps des requêtes JSON limité à 100 Ko pour limiter les abus.
6. **Logs** : En production, les stack traces ne sont plus enregistrées dans les logs ; les erreurs restent tracées avec un identifiant de requête (`requestId`) pour le diagnostic.
7. **Disponibilité** : Endpoint **GET /ready** pour les sondes de type Kubernetes (200 si la base est joignable, 503 sinon).
8. **Qualité** : Pipeline CI (lint + tests) exécuté à chaque push/PR pour limiter les régressions.
9. **Aucun changement de contrat d’API** : Les routes et formats de réponse existants sont conservés.
10. **Documentation** : Plan et livrables prod-ready ajoutés dans `docs/` (PROD_READY_PLAN.md, PROD_READY_LIVRABLES.md).

---

## 5) Améliorations volontairement NON faites (éviter scope creep)

- **Refonte architecture** : Pas de passage en microservices, pas de changement de structure de dossiers.
- **Nouveaux événements Stripe** : Pas de traitement de `charge.refunded`, `payment_intent.payment_failed`, etc. (à traiter si besoin métier).
- **RBAC** : `roleGuard` reste disponible mais non branché sur des routes ; pas d’endpoints « admin » ajoutés.
- **Transaction sur le checkout** : Pas de transaction globale sur « création Order + appel Stripe + mise à jour Order » (risque restant limité, documenté dans l’audit).
- **Monitoring externe** : Pas d’intégration Sentry/Datadog (à ajouter côté déploiement si souhaité).
- **Tests E2E / intégration DB** : Pas de tests contre une base réelle ; les tests actuels utilisent des mocks.
- **Validation env en test** : Pas de test unitaire « CORS * en prod => throw » (vérification manuelle ou manuelle dans la checklist).
- **Rate limit webhook** : Limite déjà en place ; pas de changement.
- **Renommages / refactors cosmétiques** : Aucun renommage massif de fichiers ou de variables.
