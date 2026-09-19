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
3. Importez les données de lots, réparties en deux fichiers CSV distincts.
   Chacun dispose d'un bouton « Télécharger le modèle » qui produit un fichier
   aux bonnes colonnes, à remplir puis à réimporter.

   **Copropriétaires** — l'import courant, à chaque mutation :
   - N° de lot, N° Copropriétaire, Nom Copropriétaire

   **État de division** — la structure du bâtiment, à ne toucher qu'en cas de
   modification réelle de l'immeuble :
   - N° de lot, Type, Description, Cage, Étage, Façade
   - N° plan, Porte cave
   - Quote-part charges générales, Quote-part charges ascenseur, Description complète

   Chaque bloc propose deux téléchargements : **le modèle**, vide avec une ligne
   d'exemple, pour repartir de zéro ; et **les données actuelles**, export CSV du
   contenu réel de la feuille, à corriger puis réimporter tel quel. L'export est
   en lecture seule et lit la feuille directement, sans passer par le cache, pour
   qu'un fichier périmé ne puisse pas écraser des données plus récentes.

   Chaque import **remplace intégralement** la feuille correspondante. Celui de
   l'état de division exige en plus la saisie de `CONFIRMER`, contrôlée aussi
   côté serveur.
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
- **Ajouter un suivi** à un point existant : une note détaillée + un « À faire » court (50 caractères, tapé à la main — volontairement, ça force à identifier l'essentiel plutôt que de le générer automatiquement) + éventuellement un nouveau responsable, une nouvelle échéance, un nouveau statut, et un document (compte-rendu, devis, commande, courriel...).
- **Historique complet** : chaque ajout de suivi reste consultable dans l'ordre chronologique, avec sa date, sa note, et ce qui a changé à ce moment-là (statut, responsable, échéance...).
- **Fiche du point** : en cliquant sur un point dans la liste, on ouvre sa fiche avec son état actuel et tout son historique, sans avoir à chercher ailleurs.
- **Liste filtrable** : filtre par statut (En cours/Clos) au-dessus de la liste — le statut n'occupe plus de colonne dans le tableau —, par responsable, ou recherche par mot-clé dans le sujet. Triée par échéance par défaut (les plus proches/dépassées en premier), avec surlignage rouge et gras pour les échéances dépassées non closes.
- **Pièces jointes** : le fichier est envoyé (10 Mo maximum) vers un dossier Google Drive dédié,
  « Suivi copropriété - Pièces jointes (SANDBOX) », créé automatiquement au premier envoi. Le fichier y est
  nommé `[ID du point]_[date]_[nom d'origine]`, partagé en lecture par lien, et c'est ce lien qui est
  enregistré dans la colonne `Document` de l'entrée de suivi. Coller un lien à la main reste possible.
- **Renommer un sujet** : possible directement depuis la fiche du point (icône ✎), tracé dans l'historique.
- **Supprimer une entrée d'historique** : réservé aux administrateurs, en deux clics (le premier arme, le second exécute). La dernière entrée restante d'un point est refusée par le serveur — un point sans historique perdrait toute trace de son ouverture ; il faut alors supprimer le point entier. Après suppression, l'état affiché du point est recalculé depuis l'historique restant.
- **Fiche en plein écran** : la fiche d'un point porte trois boutons de fenêtre (agrandir, réduire, fermer). L'état agrandi ne survit pas à la fermeture.

## Prestataires

Onglet public listant les prestataires de la copropriété : **Prestation**, **Prestataire**, **Numéro de téléphone**. Rien d'autre n'est servi sans authentification.

- **Visibilité** : chaque prestataire est **Public** (visible dans la liste sans connexion) ou **Admin** (absent de la liste publique, visible seulement une fois connecté en administrateur). Le champ est réglable à la création comme en modification, par un administrateur. La valeur par défaut est **Public**, et une cellule vide — une ligne créée avant l'ajout de la colonne — vaut également **Public** : un masquage ne résulte jamais d'un oubli de saisie.
- **Fiche d'un prestataire** : réservée aux administrateurs. Société, prestation, téléphone, coordonnées postales, numéro de contrat, date d'échéance du contrat, note libre.
- **Contacts** : tableau de 10 lignes au maximum par prestataire (nom, téléphone, courriel, fonction), avec ajout, modification et suppression ligne par ligne. Le plafond de 10 est vérifié côté serveur, pas seulement dans l'interface.
- **Confidentialité** : les contacts sont des données nominatives. Le bouton « Fiche » est absent du DOM pour un visiteur non administrateur, mais surtout le serveur ne sert la fiche complète et les contacts qu'à un jeton administrateur (`requireAdmin_`) — la liste publique passe par une projection explicite (`PRESTA_PUBLIC`) qui ne peut pas laisser fuiter une colonne ajoutée plus tard. Le filtre de visibilité est appliqué dans cette même projection (`prestatairesPublics_`), et pas au rendu : un prestataire **Admin** est absent aussi bien du tableau affiché que du JSON de `?action=prestataires`, même appelé directement. La liste complète, lignes **Admin** comprises, n'est servie que par l'action `listPrestataires`, derrière `requireAdmin_`.
- **Numéros de téléphone** : stockés en dix chiffres bruts, dans une colonne forcée au format texte (`setNumberFormat('@')`) — sans quoi Google Sheets interprète `0612345678` comme le nombre 612345678 et perd le zéro initial. Le serveur refuse toute valeur qui n'est pas exactement dix chiffres une fois les espaces, points et tirets retirés ; un champ vide reste accepté. L'affichage les rend par paires (`06 12 34 56 78`) dans la liste publique, la fiche et le tableau de contacts. Une valeur stockée avant ce correctif s'affiche telle quelle, non formatée, pour rester repérable ; `reparerTelephones()` réinsère le zéro des numéros à neuf chiffres.
- **Colonnes de `Prestataires`** : `ID`, `Societe`, `Prestation`, `Telephone`, `Adresse`, `NumeroContrat`, `DateEcheanceContrat`, `Note`, `DateCreation`, `DateMAJ`, `Visibilite`. `Visibilite` a été ajoutée en fin de liste : `alignerEntetes_` la crée sur une feuille existante sans décaler les données déjà en place.
- **Feuilles** : `Prestataires` et `PrestatairesContacts`, cette dernière rattachant chaque contact à son prestataire par son ID.
- **Exports** : depuis Administration, « Télécharger le modèle » et « Télécharger les données actuelles » pour les deux feuilles. Ils passent par `doPost` derrière `requireAdmin_`, et non par les routes publiques `?modele` / `?donnees` utilisées pour l'état de division et les copropriétaires : exporter les contacts par une route publique republierait en CSV ce que la liste publique protège.
- **Pas d'import CSV**, à la différence de l'état de division et des copropriétaires : les contacts sont rattachés à leur prestataire par un ID généré par le serveur, qu'un réimport écraserait en détachant silencieusement les lignes.

### Architecture technique

- **Stockage** : une Google Sheet dédiée avec cinq onglets :
  - `Points` : une ligne par point, toujours l'état courant (cache du dernier suivi connu).
  - `Historique` : une ligne par ajout de suivi, jamais modifiée ni supprimée (journal complet), avec l'auteur horodaté par le serveur.
  - `Utilisateurs` : Email, Prenom, Nom, MotDePasseHash, EstAdmin.
  - `Sessions` : jetons de session et de réinitialisation, stockés hachés, avec leur expiration.
  - `EtatDivision` : la structure du bâtiment (lots, description, tantièmes), quasi jamais modifiée.
  - `Coproprietaires` : qui possède quel lot, mis à jour à chaque mutation.

  Les deux sont jointes sur le numéro de lot pour produire la liste affichée.
  La jointure part d'`EtatDivision` : tout lot structurel apparaît, avec un
  copropriétaire vide si aucune ligne ne lui correspond ; une ligne de
  `Coproprietaires` visant un lot inconnu est signalée à l'import plutôt que
  perdue en silence. La date du dernier import de `Coproprietaires` est
  affichée sur la liste des lots, accessible sans connexion — une correction
  faite directement dans la Google Sheet ne la met pas à jour.
- **Performance de la liste des lots** : la jointure des deux feuilles coûte une
  quinzaine d'allers-retours vers l'API Sheets, soit 2 à 4 secondes. Le résultat
  est donc mis en cache côté serveur (`CacheService`) pendant 10 minutes, et ce
  cache est **vidé par les deux imports** — une donnée importée depuis
  l'application apparaît immédiatement. En revanche, une correction faite
  directement dans la Google Sheet peut mettre jusqu'à 10 minutes à s'afficher.
- **Robustesse des lectures** : `/exec` redirige vers `script.googleusercontent.com`,
  et ce second saut renvoie parfois une page HTML alors que le script s'est bien
  exécuté — d'où des échecs côté navigateur avec un journal serveur impeccable.
  Les lectures publiques sont donc réessayées deux fois avec un délai croissant,
  et tout échec nomme sa cause réelle (code HTTP, réponse non-JSON, panne réseau)
  à l'écran comme dans la console, préfixée `[API]`. Les écritures ne sont
  jamais réessayées, pour ne pas risquer un double import.
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
5. Rien à importer : `setup()` scinde automatiquement l'ancienne feuille `Lots`
   en `EtatDivision` et `Coproprietaires`. La feuille `Lots` est **conservée
   intacte** comme sauvegarde et n'est plus lue ; supprimez-la vous-même une
   fois la migration vérifiée. La date de fraîcheur des copropriétaires reste
   volontairement vide jusqu'au premier import réel.

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
