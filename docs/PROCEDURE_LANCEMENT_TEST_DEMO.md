# Procédure de lancement et tests (demo)

## 1. Prérequis

- **Node.js** >= 18
- **PostgreSQL** (local ou via Docker)
- **Compte Stripe** (mode test) pour les clés et le webhook

---

## 2. Lancer les tests automatisés (sans démo)

Les tests Vitest ne nécessitent **pas** de base de données réelle (mocks). Ils vérifient health, auth, payments, webhook, idempotence, rate limit.

```bash
# À la racine du projet
npm ci
npm test
```

**Résultat attendu** : tous les tests passent (ex. `Test Files 5 passed`, `Tests 26 passed`).

```bash
# Lint (optionnel)
npm run lint
```

---

## 3. Lancer la démo (frontend + backend)

### 3.1 Configuration

1. **Copier l’exemple d’environnement**
   ```bash
   cp .env.example .env
   ```

2. **Éditer `.env`** avec des valeurs valides :
   - `DATABASE_URL` : URL PostgreSQL (ex. `postgresql://postgres:postgres@localhost:5432/app_db`)
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` : au moins 16 caractères
   - `STRIPE_SECRET_KEY` : clé test Stripe (`sk_test_...`)
   - `STRIPE_WEBHOOK_SECRET` : secret du webhook (`whsec_...`, ex. fourni par `stripe listen`)
   - `STRIPE_SUCCESS_URL=http://localhost:3000/demo`
   - `STRIPE_CANCEL_URL=http://localhost:3000/demo`

3. **Base de données**
   ```bash
   npx prisma migrate dev
   ```

4. **Utilisateur démo (optionnel)**  
   Pour te connecter sans passer par l’écran Register, crée un compte de test :
   ```bash
   npx prisma db seed
   ```
   Identifiants créés : **demo@example.com** / **DemoPassword12**

### 3.2 Démarrer le backend

```bash
npm run dev
```

Le serveur écoute sur **http://localhost:3000** (ou le `PORT` défini dans `.env`).

### 3.3 Tester la démo dans le navigateur

1. Ouvrir **http://localhost:3000/demo** (ou http://localhost:3000/demo/index.html).
2. **Connexion** :  
   - Soit utiliser l’utilisateur démo (après `npx prisma db seed`) : **demo@example.com** / **DemoPassword12**.  
   - Soit **Inscription** d’abord : email + mot de passe (min. 10 caractères) → « Register », puis « Login » avec les mêmes identifiants.
3. **Profil** : « Charger /me » → les infos utilisateur s’affichent.
4. **Paiement** : « Payer » → redirection vers Stripe Checkout (mode test) ; après paiement ou annulation, retour sur la démo.

### 3.4 Webhook Stripe (optionnel, pour valider le flux complet)

En local, Stripe ne peut pas appeler directement localhost. Utiliser le **Stripe CLI** :

```bash
stripe listen --forward-to localhost:3000/stripe/webhook
```

Dans la sortie du CLI, récupérer le **webhook signing secret** (ex. `whsec_...`) et le mettre dans `.env` comme `STRIPE_WEBHOOK_SECRET`, puis redémarrer `npm run dev`. Les événements (ex. `checkout.session.completed`) seront reçus et la commande passera en « payée ».

---

## 4. Résumé des commandes

| Objectif              | Commande(s) |
|-----------------------|------------|
| Tests automatisés     | `npm ci` puis `npm test` |
| Lint                  | `npm run lint` |
| Démarrer la démo      | `npx prisma migrate dev` puis `npm run dev` |
| Ouvrir la démo        | http://localhost:3000/demo |
| Webhook en local      | `stripe listen --forward-to localhost:3000/stripe/webhook` |

---

## 5. Vérifications rapides

- **Backend vivant** : http://localhost:3000/health → JSON avec `"status":"ok"`.
- **Readiness** : http://localhost:3000/ready → 200 si la DB est joignable, 503 sinon.
- **Démo** : formulaire Register/Login visible sur http://localhost:3000/demo.
