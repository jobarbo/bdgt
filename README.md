# Budget Local

Application locale pour suivre tes depenses mensuelles, categoriser tes transactions et visualiser ou va ton argent.

Le projet fonctionne sans cloud. Les donnees visibles dans l'app sont stockees localement dans IndexedDB via Dexie. Le backend Express sert uniquement a automatiser l'import PDF Wealthsimple.

## Fonctionnalites

- Import CSV Wealthsimple
- Import PDF Wealthsimple avec preview avant import
- Drag-and-drop pour CSV et PDF
- Saisie manuelle de transactions BMO
- Regles de categorisation automatiques
- Modification manuelle des categories dans le tableau
- Suppression d'une transaction ou effacement complet
- Dashboard mensuel avec graphiques et detail par marchand
- Objectif d'epargne mensuel
- Export CSV des transactions filtrees
- Reimport intelligent avec mise a jour des doublons

## Stack

- Frontend: Vite + TypeScript
- Stockage local: IndexedDB avec Dexie
- Graphiques: Chart.js
- CSV: PapaParse
- Backend local: Express + Multer
- Extraction PDF: script Python + `pdftotext`

## Prerequis

- Node.js
- npm
- Python 3
- `pdftotext`

Sur macOS, `pdftotext` peut etre installe via Poppler.

## Installation

```bash
npm install
```

## Lancement

Frontend seulements:

```bash
npm run dev
```

Backend PDF seulements:

```bash
npm run dev:server
```

Frontend + backend ensemble:

```bash
npm run dev:full
```

Build de verification:

```bash
npm run build
```

## Workflow recommande

1. Lancer l'application avec `npm run dev:full`.
2. Ouvrir l'interface Vite dans le navigateur.
3. Importer un CSV ou deposer un PDF Wealthsimple.
4. Dans le modal PDF:
   - rechercher des lignes
   - filtrer `Tous les montants`, `Montants negatifs` ou `Montants positifs`
   - corriger les categories
   - retirer certaines lignes
   - choisir un mode d'import:
     - `Import complet`
     - `Importer nouveaux seulement`
     - `Mettre a jour doublons seulement`
5. Verifier les graphiques et le tableau des transactions.

## Modes d'import PDF

Le modal de preview PDF permet trois comportements:

- `Import complet`: ajoute les nouvelles transactions et met a jour la categorie des doublons deja connus.
- `Importer nouveaux seulement`: ignore les doublons existants.
- `Mettre a jour doublons seulement`: ne cree rien de nouveau, mais met a jour les transactions deja presentes si la categorie a change.

## Stockage des donnees

Source de verite pour l'application:

- IndexedDB locale dans le navigateur

Fichiers de travail locaux generes par le backend:

- `data/pdfs/`: PDF importes
- `data/csv/extracted/`: CSV extraits depuis les PDF
- `data/csv/for-app/`: CSV prepares pour l'application
- `data/tmp/`: fichiers temporaires d'upload

## Structure du projet

```text
budget/
├── data/
│   ├── csv/
│   │   ├── extracted/
│   │   └── for-app/
│   ├── pdfs/
│   └── tmp/
├── scripts/
│   └── extract_pdf_to_csv.py
├── server/
│   └── index.js
├── src/
│   ├── domain/
│   ├── features/
│   ├── storage/
│   ├── main.ts
│   └── style.css
├── index.html
├── package.json
└── README.md
```

## Backend local

Le serveur Express expose notamment:

- `GET /api/health`
- `POST /api/import/pdf-preview`

Le endpoint PDF:

1. recoit un PDF
2. le sauvegarde dans `data/pdfs/`
3. lance `scripts/extract_pdf_to_csv.py`
4. parse le CSV extrait
5. renvoie une preview JSON au frontend

## Script d'extraction PDF

Le script [scripts/extract_pdf_to_csv.py](scripts/extract_pdf_to_csv.py) utilise `pdftotext -layout` pour extraire un tableau de transactions depuis un PDF Wealthsimple.

Utilisation manuelle:

```bash
python3 scripts/extract_pdf_to_csv.py chemin/vers/releve.pdf sortie.csv
```

Colonnes generees:

- `transaction_date`
- `posted_date`
- `description`
- `amount_cad`
- `balance_cad`

## Categories disponibles

- Logement
- Alimentation
- Epicerie
- Resto
- Depanneur
- Essence
- Transport
- Abonnements
- Sante
- Pharmacie
- Soins personnels
- Loisirs
- Numerique
- Shopping
- Frais bancaires
- Impots
- Transferts
- Epargne
- Revenu
- Non classe

## Notes utiles

- `Transferts` restent visibles dans le tableau mais sont exclus des KPIs budgetaires et des graphiques de depenses.
- Les doublons sont identifies avec un fingerprint base sur la date, la description, le montant et la source.
- L'app reste utilisable meme sans backend pour la saisie manuelle, l'import CSV et le mode texte PDF de secours.

## Limites actuelles

- L'extraction PDF depend du format de releve Wealthsimple et de `pdftotext`.
- Il n'y a pas encore de synchronisation bancaire automatique.
- Il n'y a pas de systeme d'authentification, car l'app est pensee pour un usage strictement local.
