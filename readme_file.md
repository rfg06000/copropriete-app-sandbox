# Application de Gestion de Copropriété - La Résidence du Parc

Une application web pour la gestion des lots, le calcul des quotes-parts de travaux, et le suivi des points en cours d'une copropriété.

## 🏢 Fonctionnalités

### Sans connexion (public)
- **Liste des lots** : Consultation de tous les lots avec filtrage et tri
- **Calcul de quotes-parts** : Calcul automatique des montants de travaux par copropriétaire
- **Points de suivi** : Consultation des points et de leur historique complet

### Pour tout utilisateur connecté
- **Ajout de suivi** : Commentaire, responsable, échéance, priorité, pièce jointe sur un point existant

### Pour les administrateurs
- **Création et suppression de points**, renommage du sujet, clôture et réouverture
- **Correction d'une entrée d'historique** déjà enregistrée
- **Administration** : import des lots dans Google Sheets, gestion des comptes utilisateurs

## 🔐 Comptes et droits

L'accès repose sur des comptes nominatifs (e-mail + mot de passe), stockés dans la feuille
`Utilisateurs` de la Google Sheet. **Tous les contrôles de droits sont faits côté Apps Script**,
jamais seulement dans le navigateur : l'application web est publique, donc ce que l'interface
masque n'est qu'un confort d'affichage — le serveur revalide chaque écriture.

| Action | Droit requis |
|---|---|
| Lire les lots, les points et l'historique | aucun (public) |
| Ajouter un suivi à un point existant | utilisateur connecté |
| Créer un point / le supprimer / le renommer | administrateur |
| Clôturer ou rouvrir un point | administrateur |
| Corriger une entrée d'historique déjà enregistrée | administrateur |
| Importer les lots, gérer les comptes | administrateur |

### Première connexion et mot de passe oublié

Les deux passent par le même mécanisme : on saisit son adresse, Apps Script envoie
(via `MailApp`) un lien valable **une heure et à usage unique** permettant de définir un
mot de passe. Aucun mot de passe ne peut être défini sans accès à la boîte e-mail du compte.

Les mots de passe sont stockés hachés en **PBKDF2-HMAC-SHA256** (sel aléatoire de 32 octets
par compte, poivre dans les propriétés du script, hors de la feuille), ne sont jamais
renvoyés au client et n'apparaissent nulle part en clair. Les jetons de session sont eux
aussi stockés hachés. La connexion est limitée à 5 tentatives par compte par quart d'heure,
et répond de manière indiscernable — même message, même temps de calcul — que l'adresse
existe ou non, afin de ne pas permettre d'énumérer les comptes.

## 🔧 Utilisation

### Configuration initiale (Administrateur)
1. Connectez-vous via le bouton "Se connecter" en haut de page
2. Accédez à l'onglet "Administration" (visible uniquement pour les administrateurs)
3. Importez votre fichier CSV avec les colonnes :
   - N° cop, Copropriétaire, Type, Description, N° lot
   - Escalier, Etage, Façade, Porte cave, N° plan
   - Clé 1 : charges générales, Clé 3 : ascenceurs, Description complète

   L'import **remplace intégralement** la feuille `Lots` de la Google Sheet (confirmation demandée).
4. Gérez les comptes dans la section "Comptes utilisateurs" : créer un compte envoie
   automatiquement l'invitation par e-mail.

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

- **Ouvrir un point** : sujet, description initiale, date d'ouverture, statut (En cours/Clos), responsable, échéance, priorité, document.
- **Ajouter un suivi** à un point existant : une note détaillée + un résumé court (20 caractères, tapé à la main — volontairement, ça force à identifier l'essentiel plutôt que de le générer automatiquement) + éventuellement un nouveau responsable, une nouvelle échéance, un nouveau statut, et un document (compte-rendu, devis, commande, courriel...).
- **Historique complet** : chaque ajout de suivi reste consultable dans l'ordre chronologique, avec sa date, sa note, et ce qui a changé à ce moment-là (statut, responsable, échéance...).
- **Fiche du point** : en cliquant sur un point dans la liste, on ouvre sa fiche avec son état actuel et tout son historique, sans avoir à chercher ailleurs.
- **Liste filtrable** : filtre par statut (En cours/Clos), par responsable, ou recherche par mot-clé dans le sujet. Triée par échéance par défaut (les plus proches/dépassées en premier), avec surlignage rouge et gras pour les échéances dépassées non closes.
- **Pièces jointes** : pas d'upload de fichier — on colle un lien (Google Drive, OneDrive...) vers le document concerné, rattaché à l'entrée de suivi correspondante.
- **Renommer un sujet** : possible directement depuis la fiche du point (icône ✎), tracé dans l'historique.

### Architecture technique

- **Stockage** : une Google Sheet dédiée avec cinq onglets :
  - `Points` : une ligne par point, toujours l'état courant (cache du dernier suivi connu).
  - `Historique` : une ligne par ajout de suivi, jamais modifiée ni supprimée (journal complet), avec l'auteur horodaté par le serveur.
  - `Utilisateurs` : Email, Prenom, Nom, MotDePasseHash, EstAdmin.
  - `Sessions` : jetons de session et de réinitialisation, stockés hachés, avec leur expiration.
  - `Lots` : les données de lots de la copropriété (ex-`data.csv`).
- **Backend** : un Google Apps Script déployé en Application Web (`apps-script/Code.gs` dans ce dépôt), exposant une API JSON. Lecture publique via `GET ?action=list` et `GET ?action=lots` ; écriture via `POST`, chaque action portant un jeton de session que le serveur revalide.
- **Accès** : comptes nominatifs, tous les droits vérifiés côté Apps Script (voir la section « Comptes et droits »).
- **Environnements séparés** : la prod (`copropriete-app`) et le sandbox (`copropriete-app-sandbox`) ont chacun leur propre Google Sheet et leur propre déploiement Apps Script — aucune donnée de test ne peut se mélanger avec les données réelles.

## ⚙️ Installation du backend

Le code Apps Script vit dans `apps-script/Code.gs`. Pour l'installer ou le mettre à jour :

1. Ouvrir le projet Apps Script lié à la Google Sheet, y coller le contenu de `apps-script/Code.gs`.
2. Renseigner `APP_URL_PAR_DEFAUT` en haut du fichier (URL publique de l'application, qui sert
   à construire les liens envoyés par e-mail) — ou définir la propriété de script `APP_URL`.
3. Exécuter la fonction `setup()` une fois depuis l'éditeur, et autoriser les scopes demandés
   (Sheets + envoi d'e-mail). Elle crée les feuilles manquantes, ajoute les comptes initiaux
   sans mot de passe, ajoute la colonne `Auteur` à l'historique existant et migre l'ancien
   statut « Ouvert » en « En cours ». Elle est rejouable sans risque.
4. Déployer : *Déployer > Gérer les déploiements > (crayon) > Nouvelle version*. L'URL `/exec`
   existante est conservée, il n'y a rien à changer dans `index.html`.
5. Dans l'application, onglet Administration, importer `data.csv` une fois pour peupler la feuille `Lots`.

`data.csv` reste dans le dépôt à titre de référence et de jeu de données initial, mais
l'application ne le lit plus : les lots viennent désormais de la Google Sheet.

La fonction `benchmarkHash()` mesure le coût réel du hachage, pour calibrer `PBKDF2_ITERATIONS`
si la connexion devenait trop lente.

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
