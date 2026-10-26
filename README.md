# SIGP · Système Intégré de Gestion du Patrimoine (lots 1 et 2)

Application web de gestion du patrimoine pour les entreprises et les administrations publiques :
entrée en patrimoine, immatriculation, mouvements, inventaire physique, amortissements, écritures comptables,
réformes et sorties, comptabilité-matières, tableau de bord et journal d'audit inaltérable ;
immobilier et foncier, parc automobile, maintenance et contrats, révisions et dépréciations,
rapprochement comptable et clôture d'exercice, plan de renouvellement et gestion électronique des documents.
Conforme au cahier des charges SIGP et à la maquette validée (charte SIGP, IBM Plex).

## Démarrage rapide (Docker)

```bash
docker compose up --build
```

Ouvrez http://localhost:8080. Un jeu de démonstration est chargé au premier démarrage (`SEED_DEMO=1`).
Pour un environnement réel, lancez avec `SEED_DEMO=0` et un `JWT_SECRET` fort.

### Comptes de démonstration (mot de passe `Sigp2026!`)

| Compte | Profil | À essayer |
|---|---|---|
| konan.a@sigp.ci | Directeur du patrimoine | Tableau de bord, validation du transfert en attente, commission de réforme, plan de renouvellement |
| yao.k@sigp.ci | Gestionnaire du patrimoine | Réceptions, mouvements, réformes ; immobilier (Tour B), parc automobile, ordres de mission à valider, maintenance (OT du serveur 811), contrats |
| kone.d@sigp.ci | Comptable-matières | Visa de la réception des climatiseurs, écarts d'inventaire, comptabilité-matières (compte de gestion) |
| coulibaly.n@sigp.ci | Direction financière | Dotations d'octobre, écritures, révision de durée des groupes électrogènes à valider, rapprochement au 30/09, clôture d'exercice |
| diallo.f@sigp.ci | Contrôleur financier | Avis du contrôle financier, journal d'audit |
| bamba.s@sigp.ci | Chef d'équipe d'inventaire | Comptage à l'aveugle d'une zone |
| traore.m@sigp.ci | Détenteur | Portail : mes biens, demandes, attestation de détention ; demande de véhicule (ordre de mission) |
| admin@sigp.ci | Administrateur | Paramétrage, circuits de validation (réception déjà personnalisée), utilisateurs et droits |

## Développement local

Prérequis : Node.js 22, PostgreSQL 16.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # ajustez DATABASE_URL
npm run db:migrate                           # applique les migrations SQL
SEED_RESET=1 npm run db:seed                 # (re)charge le jeu de démonstration
npm run dev:api                              # API sur http://localhost:3000/api
npm run dev:web                              # interface sur http://localhost:5173
```

Tests : `npm test` (base `sigp_test` requise : `createdb sigp_test`, ou `TEST_DATABASE_URL`).

## Architecture

Monolithe modulaire, API-first, conformément à la fiche technique de réalisation.

```
apps/
  api/    NestJS 10 · Drizzle ORM · PostgreSQL 16 · JWT · Zod · ExcelJS · PDFKit
    src/common/        audit chaîné, numérotation des pièces, droits, notifications
    src/modules/       un module par domaine métier (voir ci-dessous)
    drizzle/           migrations SQL versionnées (dont les triggers d'inaltérabilité)
    test/              tests de bout en bout (parcours métier complets)
  web/    React 18 · TypeScript · Vite · TanStack Query · React Router
deploy/   images Docker (API, nginx) ; docker-compose.yml à la racine
```

| Module | Contenu |
|---|---|
| auth | Connexion, profils et droits (8 profils, 23 droits) |
| workflow | Circuits de validation génériques, séparation des tâches, relances |
| referentials | Nomenclature SYSCOHADA, structure, localisations, utilisateurs |
| assets | Registre, fiche bien, plan d'amortissement, historique, étiquettes et QR codes |
| receptions | PV de réception, réserves, visa, immatriculation, ordre d'entrée, écriture |
| movements | Affectation, transfert (avec transit), prêt, restitution ; gel pendant l'inventaire |
| inventory | Campagnes, zones, comptage à l'aveugle, rapprochement, écarts et décisions, clôture |
| depreciation | Moteur linéaire / dégressif (30/360, prorata), simulation, définitif, clôture de période |
| journal | Lots d'écritures équilibrés, export CSV pour l'ERP, accusés d'intégration |
| disposals | Réforme : contrôle financier, commission, ordonnateur, sortie et écriture de cession |
| dashboard / reports | Indicateurs de pilotage et de contrôle interne ; états Excel et PDF |
| portal | Portail détenteur : mes biens, demandes, attestation de détention |
| property | Immobilier et foncier : titres (TF, ACD…), composants, occupations et baux, travaux, contentieux, échéances |
| fleet | Parc automobile : véhicules, carburant, consommation anormale, échéances, sinistres, ordres de mission, coût de possession |
| maintenance | Ordres de travail (kanban), couverture contrat ou garantie, plans préventifs, contrats et assurances |
| revaluation | Révision de durée (prospective), dépréciation et reprise avec écritures, sous circuit de validation |
| closing | Rapprochement registre / balance de l'ERP, explications d'écarts, contrôle et clôture d'exercice |
| cmat / renewal | Comptabilité-matières (livre-journal, grand livre, compte de gestion) ; plan pluriannuel de renouvellement |
| documents | GED : pièces jointes avec empreinte SHA-256, téléchargement contrôlé, vérification d'intégrité |
| workflow / circuits | Circuits de validation paramétrables par entité (étapes, valideur, délai, seuil de montant), circuits réglementaires intégrés par défaut |
| report-builder | Générateur d'états : sources en liste blanche, colonnes, filtres, regroupements, totaux ; états enregistrés et partagés ; export Excel, CSV, PDF |

### Choix techniques notables

- **Backend en TypeScript (NestJS) plutôt que Laravel** : dans l'environnement de réalisation, le dépôt de paquets PHP
  n'était pas accessible ; NestJS reprend la même architecture (monolithe modulaire, services par domaine, API REST).
- **Drizzle ORM** : SQL explicite, migrations versionnées, aucun moteur binaire à télécharger.
- **Montants en FCFA entiers** (bigint) ; aucun calcul en virgule flottante persisté.
- **Journal d'audit inaltérable** : ajout seul (triggers PostgreSQL), chaînage SHA-256 vérifiable depuis l'interface.
- **Un bien ne se supprime jamais** (trigger) : il sort du patrimoine par une pièce ; son code n'est jamais réattribué.
- **Numérotation continue des pièces** par entité, préfixe et année : `PVR-ENT01-2026-000001`, `MEF-INF-2026-001501`.

## Périmètre

Lot 1 livré : référentiels, biens, entrées en patrimoine, étiquetage, mouvements, inventaire, valorisation,
écritures, réformes et sorties, états, tableau de bord, audit, portail détenteur.

Lot 2 livré : immobilier et foncier, parc automobile et ordres de mission, maintenance et contrats, révisions
et dépréciations, rapprochement comptable et clôture d'exercice assistée (une pièce datée d'un exercice clôturé
est refusée), comptabilité-matières, plan de renouvellement, gestion électronique des documents.

Paramétrage avancé livré : éditeur de circuits de validation (une modification ne s'applique qu'aux pièces soumises
ensuite ; au moins une étape systématique est exigée ; un valideur nommé ne peut pas être l'auteur de la pièce) et
générateur d'états personnalisés (seuls les champs du catalogue sont interrogeables, les droits s'appliquent par source).

Reste à réaliser : application mobile d'inventaire hors ligne (React Native).

Les pièces jointes sont stockées dans `STORAGE_DIR` (par défaut `apps/api/storage`) : prévoyez un volume persistant.
