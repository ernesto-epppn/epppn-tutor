# Ernesto v14.4 — mémoire de dossier, suivi intelligent et feedback

## Objectif

Faire évoluer Ernesto d’un tuteur qui répond bien à une question isolée vers un tuteur qui conserve la continuité d’un dossier et permet à l’EPPPN de mesurer la qualité réelle des réponses pendant le pilote.

## 1. Mémoire intelligente du dossier

La conversation complète reste locale au navigateur comme dans la version actuelle. En parallèle, Ernesto construit une mémoire serveur compacte :

- titre et objectif du dossier ;
- synthèse durable de 4 à 7 phrases ;
- 5 à 10 faits utiles maximum ;
- jusqu’à 3 informations manquantes qui changeraient réellement le diagnostic ;
- aucun stockage du transcript complet dans la table de mémoire.

La synthèse est recalculée environ toutes les deux réponses Ernesto. Les dernières interactions locales sont aussi ajoutées au contexte de la question suivante afin d’améliorer immédiatement les follow-ups.

Les dossiers mémorisés peuvent être recréés comme dossiers légers sur un autre appareil. L’historique local n’est pas copié, mais la synthèse durable suit le compte.

## 2. Actions sous les réponses

Chaque réponse Ernesto reçoit deux actions :

- **Approfondir** : relance la réponse en mode Analyse avec la réponse précédente comme contexte interne ;
- **Plan d’action** : transforme la réponse précédente en séquence opérationnelle en mode Action.

Le texte complet de la réponse précédente n’est pas recopié dans le message visible : il est transmis comme contexte interne.

## 3. Feedback stagiaire

Chaque réponse propose :

- 👍 Réponse utile ;
- 👎 Réponse à améliorer.

En cas de retour négatif, trois motifs rapides sont proposés :

- Trop vague ;
- Incorrect ;
- Pas assez pratique.

Les feedbacks stockent le dossier, la question, la réponse, le mode et le nombre de chunks RAG utilisés lorsqu’ils sont disponibles. Si la table Supabase n’est pas encore disponible, le feedback est mis en file locale et sera renvoyé plus tard.

## Sécurité et données

Deux nouvelles tables sont protégées par RLS :

- `ernesto_dossier_memory` ;
- `ernesto_answer_feedback`.

Les API `/api/dossier-memory` et `/api/feedback` exigent une session Supabase valide. L’authentification v14.2, Stripe et le mécanisme RAG du tutor ne sont pas modifiés.

## Déploiement

Appliquer la migration `supabase/migrations/20260808_ernesto_v14_4_memory_feedback.sql` dans Supabase avant d’attendre la persistance multi-appareil. Sans cette migration, Ernesto continue de fonctionner : le contexte récent local et les boutons de suivi restent actifs, tandis que mémoire distante et feedback serveur se désactivent silencieusement.
