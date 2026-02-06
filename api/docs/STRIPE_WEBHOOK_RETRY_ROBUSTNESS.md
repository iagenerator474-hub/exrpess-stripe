# Robustesse face aux retries Stripe (webhook)

Analyse de la résilience du traitement webhook aux retries Stripe (crash, timeout, 500).

---

## 1. Niveau de robustesse

**Niveau : Élevé.**

- **Ledger** : contrainte unique sur `stripe_event_id` (PaymentEvent), persistance avant tout ACK 200.
- **Idempotence** : P2002 (doublon) → 200 après re-application conditionnelle de l’update Order.
- **Ordre des opérations** : 1) Persist PaymentEvent, 2) updateMany Order (si applicable), 3) 200. Jamais 200 avant persist (sauf doublon).
- **États Order** : `updateMany` avec `status: { not: "paid" }` (checkout) ou `status: "paid"` (refund) → pas de double application, états clairs (pending | paid | failed | refunded).
- **Transactions** : pas de transaction unique “create + updateMany”. Choix volontaire : le ledger est persistant en premier ; en cas d’échec après create, le retry (P2002) ré-applique l’update. Cohérence assurée par la reprise sur P2002.

---

## 2. Scénarios d’échec et comportement

| Scénario | Comportement | Résultat |
|----------|--------------|----------|
| **Crash avant create** | Aucun enregistrement. Stripe retente. | Retry : create réussit, updateMany, 200. |
| **Crash après create, avant updateMany** | Event en DB, Order inchangée. Retry : create → P2002. | Branche P2002 : findUnique(existing), updateMany(where status ≠ paid), 200. Order passée en paid au retry. |
| **updateMany échoue (timeout, DB)** | create déjà fait. Handler renvoie 500 (catch externe). | Retry : P2002 → updateMany dans la branche P2002 → 200. Order corrigée. |
| **Crash après updateMany, avant 200** | Event + Order à jour. Stripe retente. | Retry : P2002 → updateMany (0 lignes car déjà paid) → 200. Idempotent. |
| **Rejeu volontaire (même event)** | create → P2002. | P2002 → updateMany conditionnel → 200. Pas de double mise à jour (where status ≠ paid). |
| **create échoue (hors P2002)** | Pas de persist. | 500, pas de 200. Stripe retente ; pas de doublon, create retenté. |

Aucun scénario ne laisse une Order définitivement dans un état incohérent : soit l’event n’est pas persisté (retry propre), soit il est persisté et l’update est (re)jouée au premier appel ou au retry.

---

## 3. Points vérifiés (checklist)

| Point | Statut |
|-------|--------|
| Ledger DB avec contrainte unique | Oui : `PaymentEvent.stripeEventId` @unique (schema.prisma). |
| Traitement idempotent | Oui : P2002 → 200 ; updateMany avec condition `status` (not paid / paid). |
| Pas de 200 avant persist | Oui : 200 uniquement après create (ou P2002). Erreur create (hors P2002) → 500. |
| Reprise sur P2002 (checkout) | Oui : findUnique par stripeEventId, si !orphaned → updateMany(id, status ≠ paid). |
| Reprise sur P2002 (refunds) | Oui : findUnique, si orderId et !orphaned et full refund → updateMany(paid → refunded). |
| États Order clairs | Oui : pending, paid, failed, refunded ; transitions uniquement via webhook et updateMany conditionnel. |

---

## 4. Corrections appliquées

Aucune correction nécessaire : le design “persist first, then update, 500 on persist failure, on P2002 re-apply update” est déjà robuste aux retries.

Option (non requise) : envelopper create + updateMany dans une transaction Prisma réduirait la fenêtre “event présent, order pas encore mise à jour” mais compliquerait la gestion du retry (rollback du create → retry refait create). Le comportement actuel est préférable pour la durabilité du ledger.

---

## 5. Tests

- **Existant** : `durable: create PaymentEvent then updateMany Order before ACK 200` ; replay 5× (P2002, 200 sans double update) ; `returns 500 when paymentEvent.create fails (non-P2002)`.
- **Ajout** : `retry after create succeeds and updateMany fails: P2002 branch applies updateMany and returns 200` — simule première requête (create OK, updateMany KO → 500), deuxième requête (create → P2002, updateMany appliqué → 200).

Voir `api/tests/stripe.webhook.test.ts`.
