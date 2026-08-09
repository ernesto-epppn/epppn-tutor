# Ernesto v14.5 — parcours pédagogique suivi

## Objectif

Transformer le plan d’action en outil de suivi du dossier, faciliter la comparaison avant/après et permettre à l’EPPPN d’élargir elle-même la connaissance officielle d’Ernesto.

## Diagramme interactif

Chaque contrôle d’un plan peut être marqué `✓ Conforme` ou `↺ À reprendre`. L’état est conservé immédiatement dans le navigateur et synchronisé dans `ernesto_action_plan_progress` pour suivre le dossier entre appareils.

Lorsqu’une information manque et change réellement le plan, Ernesto formule une seule question décisive avec deux ou trois réponses brèves. Le choix régénère un diagramme ajusté en conservant les étapes encore pertinentes.

## Bilan du dossier

Le bouton **Bilan du dossier** présente une synthèse compacte : objectif, résumé, repères mémorisés et prochains contrôles. Le bilan peut être actualisé et copié. Sur mobile, il reste accessible depuis la barre des dossiers.

## Comparaison photographique

Le composeur accepte jusqu’à deux images, identifiées comme **Avant** et **Après**. Ernesto doit décrire uniquement les différences visibles, les relier prudemment à la correction testée et signaler ce qu’une photographie ne permet pas de conclure.

## Base de connaissances officielle

L’administration accepte des PDF, fichiers texte, fichiers Markdown ou du texte collé. Trois garde-fous sont obligatoires :

- session administrateur Ernesto valide ;
- titre et source explicites ;
- confirmation que le contenu est officiel ou validé par l’EPPPN.

Le texte est extrait, découpé en fragments chevauchants et indexé avec `text-embedding-3-small`. Le fichier original n’est pas conservé par cette fonction. Un document peut être retiré ; ses fragments sont alors supprimés par cascade.

Le dépôt ne contient pas de nouveaux contenus pédagogiques officiels. L’interface d’administration est prête, mais aucun document ne doit être inventé ou importé sans validation EPPPN.

## Indicateurs administrateur

Le tableau de bord regroupe désormais : réponses marquées utiles, feedbacks des sept derniers jours, dossiers mémorisés, plans suivis et terminés, documents officiels et fragments indexés.

## Migration

`supabase/migrations/20260809_ernesto_v14_5_workflow.sql` crée la persistance des plans, optimise les politiques RLS existantes, fixe le `search_path` des fonctions, ajoute l’index de clé étrangère manquant et retire un index redondant.

La protection Supabase contre les mots de passe compromis reste un réglage Auth à activer dans le tableau de bord ; elle ne doit pas être simulée par une migration SQL.
