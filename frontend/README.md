# Frontend Démo — React + Vite + TypeScript

Application de démo minimaliste qui consomme le backend Express (auth cookies + Stripe Checkout).

## Prérequis

- Node.js >= 18
- Backend Express démarré (voir le README à la racine du repo)

## Installation

```bash
npm install
cp .env.example .env
```

Éditer `.env` et définir `VITE_API_URL` si le backend n’est pas sur `http://localhost:3000`.

## Lancer en dev

```bash
npm run dev
```

Ouvre l’app sur le port indiqué (souvent 5173). Les appels API partent vers `VITE_API_URL` avec `withCredentials: true` (cookies).

## Variables d’environnement

| Variable        | Description                          | Défaut              |
|----------------|--------------------------------------|---------------------|
| `VITE_API_URL` | URL de base du backend (sans slash final) | `http://localhost:3000` |

## CORS

Le backend doit être configuré pour accepter l’origine du frontend avec **credentials** :

- `CORS_ORIGINS` doit contenir l’URL du front (ex. `http://localhost:5173` en dev).
- Les cookies (refresh token) ne sont envoyés que si `credentials: true` côté client et origine explicite côté serveur (pas `*`).

## Scripts

- `npm run dev` — serveur de dev (Vite)
- `npm run build` — build production
- `npm run preview` — prévisualisation du build
- `npm run lint` — ESLint

## Structure

- `src/lib/api.ts` — client axios (baseURL, withCredentials, interceptors)
- `src/auth/` — AuthContext, ProtectedRoute
- `src/pages/` — Home, Login, Dashboard, Checkout, Success, Cancel
- `src/components/` — NavBar, Field, Notice
