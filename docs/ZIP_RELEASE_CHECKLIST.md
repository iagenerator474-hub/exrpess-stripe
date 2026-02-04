# Checklist release ZIP — safe to share

## Fichier généré

- **Nom :** `express-stripe-postgres-backend-v0.5.0.zip`
- **Emplacement :** à la racine du workspace parent (ex. `c:\dev\express-stripe-postgres-backend-v0.5.0.zip`)

## Confirmation de sécurité

- **Aucun secret inclus** : le fichier `.env` (et toute variante contenant des secrets) est exclu du ZIP. Seul `.env.example` (placeholders uniquement) est inclus.
- **Le ZIP peut être partagé publiquement** : pas de clés Stripe, JWT ou d’URL de base de données réelles dans le code, la doc ou l’archive.

## Fichiers / dossiers exclus du ZIP

| Exclu | Raison |
|-------|--------|
| `node_modules/` | Dépendances (à réinstaller avec `npm install`) |
| `dist/` | Build (à régénérer avec `npm run build`) |
| `.env` | **Secrets** — ne doit jamais être partagé |
| `.env.local` | Secrets locaux |
| `coverage/` | Rapport de couverture de tests |
| `.vitest/` | Cache Vitest |
| `.git/` | Historique Git |
| `*.log` | Fichiers de log |
| `.DS_Store` | Métadonnées macOS |
| `logs/` | Dossier de logs (si présent) |

## Fichiers inclus (exemples)

- Code source : `src/`, `demo/`, `tests/`
- Config : `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- Docker : `Dockerfile`, `docker-compose.yml`, `entrypoint.sh`
- Prisma : `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`
- Doc : `README.md`, `openapi.yaml`, `docs/`
- **`.env.example`** : modèle avec valeurs factices (sk_test_placeholder, whsec_placeholder, etc.)

## Vérifications effectuées

1. `.gitignore` contient `.env`, `.env.local`, `.env.*.local`.
2. `.env.example` ne contient que des placeholders (aucune clé réelle).
3. README décrit la procédure `cp .env.example .env`.
4. Aucune clé Stripe/JWT/DB réelle dans le code ou la documentation versionnée.

## Commande pour régénérer le ZIP (PowerShell)

Depuis la racine du repo :

```powershell
tar -a -c -f ..\express-stripe-postgres-backend-v0.5.0.zip `
  --exclude=node_modules --exclude=dist --exclude=.env --exclude=.env.local `
  --exclude=coverage --exclude=.vitest --exclude=.git --exclude="*.log" `
  --exclude=.DS_Store --exclude=logs .
```
