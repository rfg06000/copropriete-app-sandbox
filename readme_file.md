# Application de Gestion de Copropriété - La Résidence du Parc

Une application web pour la gestion des lots, le calcul des quotes-parts de travaux, et le suivi des points en cours d'une copropriété.

## 🏢 Fonctionnalités

### Pour tous les utilisateurs
- **Liste des lots** : Consultation de tous les lots avec filtrage et tri
- **Calcul de quotes-parts** : Calcul automatique des montants de travaux par copropriétaire

### Pour les utilisateurs autorisés (mot de passe requis)
- **Administration** : Import CSV des lots, mise à jour des données
- **Points de suivi** : Suivi des sujets en cours (fuites, devis, mises aux normes, contentieux, etc.)

## 🔧 Utilisation

### Configuration initiale (Administrateur)
1. Accédez à la page "Administration"
2. Saisissez le mot de passe administrateur
3. Importez votre fichier CSV avec les colonnes :
   - N° cop, Copropriétaire, Type, Description, N° lot
   - Escalier, Etage, Façade, Porte cave, N° plan
   - Clé 1 : charges générales, Clé 3 : ascenceurs, Description complète

### Utilisation quotidienne
1. **Liste des lots** : Consultez, filtrez et triez les lots
2. **Calcul QP** : Sélectionnez un copropriétaire, saisissez le montant des travaux et la clé de répartition
3. **Points de suivi** : Suivez l'avancement des sujets en cours (voir ci-dessous)

## 📊 Format du fichier CSV

Le fichier CSV doit être au format suivant (séparateur : point-virgule) :

```csv
N° cop;Copropriétaire;Type;Description;N° lot;Escalier;Etage;Façade;Porte cave;N° plan;Clé 1 : charges générales;Clé 3 : ascenceurs;Description complète
1;Dupont Jean;Appartement;T3;15;A;2; ;;101;125;90;
2;Martin Sophie;Appartement;T2;22;B;1; ;;102;90;60;
```

## 📋 Module Points de suivi

### Principe

Chaque **point** (un sujet : fuite, devis, mise aux normes, contentieux...) est l'**ancre centrale** à laquelle se rattachent, au fil du temps, toutes les mises à jour : nouvelles informations, devis reçus, rendez-vous pris, courriers envoyés, etc. Rien n'est jamais écrasé — chaque ajout devient une ligne permanente de l'historique du point, et le point affiche toujours son état le plus récent (statut, responsable, échéance).

### Fonctionnalités

- **Ouvrir un point** : sujet, description initiale, date d'ouverture, statut (Ouvert/Clos), responsable, échéance, priorité, document.
- **Ajouter un suivi** à un point existant : une note détaillée + un résumé court (20 caractères, tapé à la main — volontairement, ça force à identifier l'essentiel plutôt que de le générer automatiquement) + éventuellement un nouveau responsable, une nouvelle échéance, un nouveau statut, et un document (compte-rendu, devis, commande, courriel...).
- **Historique complet** : chaque ajout de suivi reste consultable dans l'ordre chronologique, avec sa date, sa note, et ce qui a changé à ce moment-là (statut, responsable, échéance...).
- **Fiche du point** : en cliquant sur un point dans la liste, on ouvre sa fiche avec son état actuel et tout son historique, sans avoir à chercher ailleurs.
- **Liste filtrable** : filtre par statut (Ouvert/Clos), par responsable, ou recherche par mot-clé dans le sujet. Triée par échéance par défaut (les plus proches/dépassées en premier), avec surlignage rouge et gras pour les échéances dépassées non closes.
- **Pièces jointes** : pas d'upload de fichier — on colle un lien (Google Drive, OneDrive...) vers le document concerné, rattaché à l'entrée de suivi correspondante.
- **Renommer un sujet** : possible directement depuis la fiche du point (icône ✎), tracé dans l'historique.

### Architecture technique

- **Stockage** : une Google Sheet dédiée avec deux onglets :
  - `Points` : une ligne par point, toujours l'état courant (cache du dernier suivi connu).
  - `Historique` : une ligne par ajout de suivi, jamais modifiée ni supprimée (journal complet).
- **Backend** : un Google Apps Script déployé en Application Web, exposant une API JSON (lecture via `GET ?action=list`, écriture via `POST` avec les actions `create`, `ajoutSuivi`, `renamePoint`).
- **Accès** : protégé par le même mot de passe que l'onglet Administration (protection basique côté client, cohérente avec le reste de l'application).
- **Environnements séparés** : la prod (`copropriete-app`) et le sandbox (`copropriete-app-sandbox`) ont chacun leur propre Google Sheet et leur propre déploiement Apps Script — aucune donnée de test ne peut se mélanger avec les données réelles.

## 🚀 Déploiement

Cette application est déployée sur Vercel et accessible à l'adresse : https://residence-du-parc.vercel.app

Un environnement de test (sandbox) existe séparément sur le même modèle, déployé depuis le dépôt `copropriete-app-sandbox`.

## 🛠️ Technologies utilisées

- HTML5 / CSS3 / JavaScript ES6 (aucun framework, aucune étape de build)
- PapaParse pour le traitement des fichiers CSV
- Google Sheets + Google Apps Script pour le stockage et l'API du module Points de suivi
- Design responsive avec la police Aptos

## 📝 Licence

Application développée pour La Résidence du Parc.
