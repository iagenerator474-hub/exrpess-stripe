# Procédure de lancement

## Prérequis

- Node.js >= 18
- npm
- **Soit** Docker Desktop (pour Postgres), **soit** PostgreSQL installé localement

---

## Premier lancement (une fois)

### 1. Fichier d’environnement

Depuis la racine du repo :

```powershell
cd api
copy .env.example .env
```

Ouvrir `api\.env` et adapter si besoin (notamment `DATABASE_URL` si Postgres n’est pas sur `localhost:5432` avec user `postgres` / mot de passe `postgres`).

### 2. Dépendances

Toujours dans `api` :

```powershell
npm install
```

### 3. Base de données

**Avec Docker** (Docker Desktop démarré) :

```powershell
cd ..
docker compose up -d postgres
```

Attendre quelques secondes que Postgres soit prêt.

**Sans Docker** : avoir PostgreSQL installé et une base `app_db` créée. Adapter `DATABASE_URL` dans `api\.env`.

### 4. Migrations

Depuis la racine :

```powershell
npm run db:migrate
```

(ou `cd api && npm run db:migrate`)

### 5. Compte démo (optionnel)

Pour tester avec un utilisateur prérempli :

```powershell
npm run db:seed
```

Identifiants : `demo@example.com` / `DemoPassword12`.

---

## Lancement au quotidien

Depuis la **racine** du repo :

```powershell
# Si Postgres est en Docker
docker compose up -d postgres

# Puis l’API
npm run dev
```

- **API** : http://localhost:3000  
- **Demo** : http://localhost:3000/demo  

Pour arrêter : `Ctrl+C` (API) ; `docker compose down` (Postgres si besoin).

---

## Tout en Docker (API + Postgres)

```powershell
docker compose up -d
```

L’API écoute sur le port 3000. Un **healthcheck** sur `GET /ready` permet aux orchestrateurs de savoir quand l’app est prête. Les variables d’environnement doivent être définies (fichier `.env` à la racine ou variables d’env exportées). Voir `README.md` pour la liste des variables.

**Production :** si l’API est derrière un reverse proxy (Nginx, Render, Fly), ajouter **`TRUST_PROXY=1`** dans le `.env` à la racine. Voir [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).

---

## Vérification rapide

- Health : http://localhost:3000/health → doit retourner 200 et `"db":"up"`
- Ready : http://localhost:3000/ready → 200

Détail des tests manuels : [SMOKE_TEST.md](SMOKE_TEST.md).
