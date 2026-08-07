# Ernesto v14.2 — accès pilote EPPPN

## Objectif

Ernesto reste non public pendant la phase de test. Seuls les stagiaires dont l’adresse email a été validée à l’avance par l’EPPPN peuvent activer un compte personnel.

## Parcours prévu

1. Un administrateur connecté ouvre `/admin`.
2. Il saisit l’email, le nom et une durée de 3 à 6 mois, ou une date de fin fixe.
3. L’API `/api/admin/invite-user` ajoute l’adresse à `epppn_allowed_emails` et envoie une invitation Supabase.
4. Le stagiaire ouvre une seule fois le lien reçu et choisit son mot de passe sur `/auth/set-password`.
5. `/api/auth/activate-account` associe définitivement l’adresse autorisée au premier `user_id` Supabase.
6. Les connexions suivantes se font sur `/connexion` avec email et mot de passe.

## Protection contre le partage

- une adresse autorisée est liée au premier `user_id` qui l’active ;
- un autre `user_id` utilisant la même adresse est refusé et journalisé ;
- la table d’autorisation reste inaccessible aux rôles `anon` et `authenticated` ;
- l’administrateur peut bloquer une adresse avec `blocked_at` et `blocked_reason` ;
- la durée pédagogique ne se renouvelle pas à chaque connexion.

Cette protection limite fortement le partage d’une simple adresse email. Elle ne peut pas empêcher absolument un stagiaire de communiquer son mot de passe ; la limitation à une session et la détection d’usages simultanés constituent une étape ultérieure.

## Migration Supabase

Appliquer avant le déploiement :

`supabase/migrations/20260806_ernesto_v14_2_access.sql`

La migration :

- ajoute les champs d’invitation, de dernière connexion et d’événement de sécurité ;
- impose une durée comprise entre 1 et 6 mois ;
- impose une seule association par `activated_user_id` ;
- active RLS et réserve la table au `service_role`.

## Variables Vercel nécessaires

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL=https://ernesto.epppn.fr`
- `ERNESTO_ADMIN_EMAILS`

Les variables de Basic Authentication `ERNESTO_USER` et `ERNESTO_PASS` peuvent rester actives pendant le pilote comme seconde barrière temporaire.

## Réglages Supabase Auth

Dans Supabase Dashboard :

1. désactiver la création publique de comptes ;
2. conserver l’authentification email + mot de passe ;
3. ajouter `https://ernesto.epppn.fr/auth/set-password` aux Redirect URLs ;
4. personnaliser le modèle d’email d’invitation ;
5. configurer les limites d’envoi et le SMTP de production avant une invitation massive.

## Travail restant avant merge vers `main`

### 1. Remplacer le magic link dans `app/page.tsx`

La page principale historique contient encore le flux OTP/magic link. Elle doit :

- afficher email + mot de passe ;
- appeler `supabase.auth.signInWithPassword` ;
- appeler ensuite `/api/auth/activate-account` ;
- retirer tout bouton ou texte `Essai gratuit` et toute création libre de compte ;
- renvoyer vers `/connexion` lorsque l’utilisateur n’est pas connecté.

### 2. Corriger l’ordre des contrôles dans `app/api/tutor/route.ts`

L’ordre cible est :

1. administrateur actif ;
2. abonnement Stripe actif ;
3. accès pédagogique EPPPN actif et non expiré ;
4. sinon paywall ou refus.

Actuellement le contrôle fermé EPPPN intervient avant le contrôle Stripe. Un ancien stagiaire ayant payé pourrait donc rester bloqué.

### 3. Durcir la liaison historique

La fonction historique `ensureV14ClosedAccess` ne doit jamais remplacer `activated_user_id` lorsqu’il est déjà différent. Elle doit appliquer la même règle que `/api/auth/activate-account` : refus et événement de sécurité.

### 4. Session unique et contrôle d’abus

À ajouter après stabilisation :

- table de sessions actives ou option Supabase correspondante ;
- seuil de requêtes quotidiennes ;
- détection de requêtes simultanées anormales ;
- commandes administratives de blocage et déblocage.

## Validation manuelle minimale

- invitation d’une nouvelle adresse ;
- création du mot de passe ;
- première activation ;
- reconnexion email/mot de passe ;
- refus d’une adresse absente de la liste ;
- refus d’un second `user_id` pour la même adresse ;
- refus après `access_ends_at` ;
- accès maintenu pour un abonnement Stripe actif après expiration pédagogique, une fois l’ordre des contrôles corrigé.
