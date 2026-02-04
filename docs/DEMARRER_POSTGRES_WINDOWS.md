# Démarrer PostgreSQL sous Windows

## 1. Démarrer le service PostgreSQL

1. Appuie sur **Win + R**, tape **`services.msc`**, Entrée.
2. Dans la liste, cherche un service du type :
   - **PostgreSQL 16** ou **PostgreSQL 15**
   - ou **postgresql-x64-16**
3. **Clic droit** sur ce service → **Démarrer** (ou **Redémarrer**).
4. Vérifie que le **Statut** est **En cours d’exécution**.

## 2. Si tu ne vois aucun service PostgreSQL

- Soit PostgreSQL n’est pas installé : réinstalle-le depuis https://www.postgresql.org/download/windows/
- Soit il a été installé sans service : lance **pgAdmin** (fourni avec PostgreSQL) ; au premier lancement il peut démarrer le serveur. Sinon, réinstalle en cochant l’option **Service** / **Install as Windows service**.

## 3. Vérifier que le serveur écoute

Dans PowerShell :

```powershell
netstat -ano | findstr "5432"
```

Tu dois voir au moins une ligne avec **LISTENING**. Sinon, le service n’est pas démarré ou écoute sur un autre port.

## 4. Ensuite (migrations + seed + app)

Une fois PostgreSQL démarré :

```powershell
cd c:\dev\express-stripe-auth-skeleton
npx prisma migrate dev
npx prisma db seed
npm start
```

Si **npm start** affiche « port 3000 already in use », libère le port :

```powershell
netstat -ano | findstr ":3000"
```

Note le **PID** (dernier nombre de la ligne). Puis :

```powershell
taskkill /PID <PID> /F
```

Remplace `<PID>` par le numéro noté.
