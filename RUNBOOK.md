# Runbook — Opérations et support

Guide opérationnel pour l’API Stripe (webhooks, DB, observabilité, support client).

---

## Paiement réussi côté Stripe mais pas reflété en base

**Symptôme** : le client a payé sur Stripe mais l’ordre reste `pending` ou absent en base.

1. **Logs**  
   Filtrer par `requestId` (présent dans les réponses d’erreur et les logs). Chercher les requêtes vers `POST /stripe/webhook` autour de l’heure du paiement.

2. **Ledger PaymentEvent**  
   En base, table des événements Stripe (ex. `PaymentEvent`) : rechercher par `stripe_event_id` (id de l’event Stripe) ou par `stripeSessionId` / `order_id`.  
   - Si l’event **existe** : le webhook a été reçu et persisté ; vérifier si l’ordre a bien été mis à jour (champ `status`, `paid_at`).  
   - Si l’event **n’existe pas** : le webhook n’a pas été reçu, a échoué (500) ou a été rejeté (400). Consulter les logs et Stripe Dashboard (livraisons webhook).

3. **Order**  
   Rechercher l’ordre par `stripe_session_id` (id de session Checkout) ou par id commande. Vérifier `status` et `paid_at`.

4. **Rejouer l’event**  
   - Stripe Dashboard : Webhooks → endpoint → choisir l’event → “Resend” (ou équivalent).  
   - Stripe CLI : `stripe events resend <evt_xxx>`.  
   L’API traite l’event en idempotence : si l’event est déjà en base (même `stripe_event_id`), réponse 200 sans nouveau traitement. Sinon, création PaymentEvent + mise à jour Order.

---

## Webhook failures

### Signature invalide (400)

- **Causes** : mauvais `STRIPE_WEBHOOK_SECRET`, body modifié (middleware JSON qui parse le body avant le webhook), mauvais endpoint (test vs prod).  
- **Actions** : vérifier que le secret utilisé correspond à l’endpoint (Dashboard Stripe) ; s’assurer que le body du webhook est lu en **raw** pour la signature (pas de `express.json()` sur la route webhook).

### 500 (erreur serveur)

- **Cause typique** : base indisponible ou erreur lors de la persistance (création `PaymentEvent` ou accès DB).  
- **Comportement** : l’API répond 500 ; Stripe retente selon sa politique.  
- **Actions** : corriger la cause (DB, migrations, quota) ; les retries Stripe reprocesseront l’event. Ne pas ACK en 200 tant que la persistance n’est pas garantie (comportement actuel : pas d’ACK avant écriture).

### Duplicates (P2002) → 200

- **Comportement attendu** : si l’event existe déjà en base (contrainte unique sur `stripe_event_id`), l’API répond **200** sans retraiter (idempotence).  
- Aucune action requise ; évite les doubles mises à jour d’ordre.

---

## Base de données / migrations

- **Appliquer les migrations** :  
  `cd api && npx prisma migrate deploy`  
  À lancer après déploiement d’une nouvelle version qui contient des migrations.

- **En cas d’échec** :  
  - Vérifier les logs Prisma et la connexion `DATABASE_URL`.  
  - Vérifier que la base est accessible et que le schéma n’a pas été modifié à la main de façon incompatible.  
  - Rollback : pas de rollback automatique fourni. En cas de migration problématique, procédure manuelle (restauration backup, correction de la migration, redéploiement) selon votre politique. Conserver les backups avant `migrate deploy` en prod.

---

## Observabilité

- **Logs** : émis par l’application (stdout/stderr ou logger configuré). Pas d’agrégation fournie ; à configurer côté hébergement (fichiers, syslog, service de log).
- **Corrélation** : chaque requête a un **requestId** (header ou champ de réponse). À utiliser pour tracer une requête dans les logs et les erreurs (ex. erreur 500 avec `requestId` dans le body).

---

## Support — Checklist à demander au client

Pour investiguer un incident (paiement, webhook, erreur) :

- **Stripe** : `event id` (ex. `evt_xxx`), `session id` (ex. `cs_xxx`) si pertinent.
- **Côté app** : `orderId` (si connu), timestamps (heure du paiement / de l’appel).
- **Environnement** : prod / staging, pas de secrets — uniquement env concernée (ex. “prod”) et éventuellement version déployée ou tag.
- **Comportement observé** : message d’erreur (sans token), code HTTP, et si possible `requestId` renvoyé par l’API.

---

*Runbook livraison client — pas de secret, pas de valeur réelle.*
