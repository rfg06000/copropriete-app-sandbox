/**
 * La Résidence du Parc — Apps Script Web App backend.
 *
 * Feuilles gérées dans le classeur lié :
 *   - "Points"       : état courant de chaque point de suivi (cache recalculé)
 *   - "Historique"   : journal des suivis, jamais écrasé
 *   - "Utilisateurs" : comptes autorisés (Email, Prenom, Nom, MotDePasseHash, EstAdmin)
 *   - "Sessions"     : jetons de session et de réinitialisation (hachés)
 *   - "Lots"         : données de lots de la copropriété (ex-data.csv)
 *
 * Statuts possibles : "En cours" ou "Clos" uniquement.
 *
 * SÉCURITÉ — principe directeur : la Web App est publique ("Tout le monde"),
 * donc AUCUNE décision de droit n'est prise côté client. Chaque écriture
 * revalide ici le jeton de session, retrouve l'utilisateur dans la feuille
 * "Utilisateurs" et vérifie EstAdmin. Tout ce que le client prétend être
 * (email, rôle, auteur) est ignoré.
 *
 * INSTALLATION (à faire une seule fois) :
 *   1. Renseigner APP_URL_PAR_DEFAUT ci-dessous (URL publique de l'application).
 *   2. Exécuter la fonction setup() depuis l'éditeur, et autoriser les scopes
 *      demandés (Sheets + envoi d'e-mail).
 *   3. Déployer : Déployer > Gérer les déploiements > (crayon) > Nouvelle version.
 *      L'URL /exec existante est conservée.
 *   4. Dans l'application, onglet Administration, importer data.csv une fois
 *      pour peupler la feuille "Lots".
 */

/* ============================ Configuration ============================ */

// URL publique de l'application (sert à construire les liens envoyés par e-mail).
// Peut aussi être fournie via la propriété de script "APP_URL", qui a priorité.
const APP_URL_PAR_DEFAUT = 'https://copropriete-app-sandbox-2.vercel.app';

const POINTS_SHEET_NAME = 'Points';
const HISTO_SHEET_NAME = 'Historique';
const USERS_SHEET_NAME = 'Utilisateurs';
const SESSIONS_SHEET_NAME = 'Sessions';
const ETAT_SHEET_NAME = 'EtatDivision';
const COPRO_SHEET_NAME = 'Coproprietaires';
const LOTS_SHEET_NAME = 'Lots';          // ancienne feuille fusionnée, migrée puis conservée

// Horodatage du dernier import de Coproprietaires, affiché publiquement sur la
// liste des lots. Une correction faite à la main dans la Google Sheet ne le met
// pas à jour : seul un import par l'application le renseigne.
const PROP_MAJ_COPRO = 'MAJ_COPROPRIETAIRES';

const POINTS_HEADERS = [
  'ID', 'DateOuverture', 'Sujet', 'Description', 'Statut',
  'Responsable', 'DateEcheance', 'Priorite',
  'DateCreation', 'DateMAJ'
];

const HISTO_HEADERS = [
  'HistoId', 'PointId', 'Date', 'Note', 'Resume',
  'Responsable', 'DateEcheance', 'Priorite', 'Document', 'Statut', 'Auteur'
];

const USERS_HEADERS = ['Email', 'Prenom', 'Nom', 'MotDePasseHash', 'EstAdmin'];

const SESSIONS_HEADERS = ['TokenHash', 'Email', 'Type', 'Expire', 'CreeLe', 'UtiliseLe'];

/*
 * Les lots vivent dans deux feuilles distinctes, aux rythmes de mise à jour
 * très différents :
 *   - EtatDivision   : la structure du bâtiment, quasi jamais modifiée.
 *   - Coproprietaires: qui possède quoi, change à chaque mutation.
 * La jointure se fait sur le numéro de lot.
 *
 * L'ancienne feuille "Lots" fusionnait les deux ; elle n'est plus lue, mais
 * reste en place comme sauvegarde après la migration (voir migrerLots_).
 */
const ETAT_HEADERS = [
  'N° de lot', 'Type', 'Description', 'Cage', 'Étage', 'Façade',
  'N° plan', 'Porte cave',
  'Quote-part charges générales', 'Quote-part charges ascenseur',
  'Description complète'
];

const COPRO_HEADERS = ['N° de lot', 'N° Copropriétaire', 'Nom Copropriétaire'];

// Lignes d'exemple des modèles CSV téléchargeables, dans l'ordre des en-têtes
// ci-dessus. Elles vivent ici pour ne pas pouvoir diverger des colonnes que
// l'import valide.
const ETAT_EXEMPLE = [
  '15', 'Appartement', 'T3', 'A', '2', 'Sud',
  '101', '',
  '125', '90',
  'Un appartement de trois pièces au deuxième étage'
];

const COPRO_EXEMPLE = ['15', '1', 'DUPONT Jean (Monsieur)'];

const MODELES = {
  etatDivision: {
    entetes: ETAT_HEADERS,
    exemple: ETAT_EXEMPLE,
    nomFichier: 'modele-etat-division.csv'
  },
  coproprietaires: {
    entetes: COPRO_HEADERS,
    exemple: COPRO_EXEMPLE,
    nomFichier: 'modele-coproprietaires.csv'
  }
};

/*
 * Correspondance entre les colonnes des deux feuilles et les noms utilisés par
 * la vue combinée que consomme l'application. Ces noms historiques sont
 * conservés à dessein : l'interface affiche toujours « Escalier », « Clé 1 »
 * et « Clé 3 », et le renommage ne concerne que les feuilles sources.
 */
const VUE_DEPUIS_ETAT = {
  'N° de lot': 'N° lot',
  'Type': 'Type',
  'Description': 'Description',
  'Cage': 'Escalier',
  'Étage': 'Etage',
  'Façade': 'Façade',
  'N° plan': 'N° plan',
  'Porte cave': 'Porte cave',
  'Quote-part charges générales': 'Clé 1 : charges générales',
  'Quote-part charges ascenseur': 'Clé 3 : ascenceurs',
  'Description complète': 'Description complète'
};

const VUE_DEPUIS_COPRO = {
  'N° Copropriétaire': 'N° cop',
  'Nom Copropriétaire': 'Copropriétaire'
};

// Colonnes de l'ancienne feuille Lots, utilisées uniquement par la migration.
const LOTS_HEADERS = [
  'N° cop', 'Copropriétaire', 'Type', 'Description', 'N° lot',
  'Escalier', 'Etage', 'Façade', 'Porte cave', 'N° plan',
  'Clé 1 : charges générales', 'Clé 3 : ascenceurs', 'Description complète'
];

const CACHE_FIELDS = ['Responsable', 'DateEcheance', 'Priorite', 'Statut'];

const STATUT_EN_COURS = 'En cours';
const STATUT_CLOS = 'Clos';
const STATUTS = [STATUT_EN_COURS, STATUT_CLOS];

// Durée de vie d'une session (glissante) et d'un lien envoyé par e-mail.
const SESSION_DUREE_MS = 30 * 24 * 3600 * 1000;   // 30 jours
const LIEN_DUREE_MS = 60 * 60 * 1000;             // 1 heure

// Anti-force brute : 5 échecs par e-mail par fenêtre de 15 minutes.
const MAX_ECHECS = 5;
const FENETRE_ECHECS_S = 15 * 60;

// PBKDF2-HMAC-SHA256. Apps Script n'offre ni bcrypt ni argon2 : on dérive à la
// main, et chaque itération est un appel natif — benchmarkHash() a mesuré
// 7247 ms pour 10 000 itérations, soit ~0,72 ms l'unité. 3500 tient donc en
// ~2,5 s, ce qui laisse une demi-seconde sous la cible de 3 s pour le reste de
// la requête (verrou, lectures de feuilles) et absorbe les variations de charge
// de la plateforme. Relancer benchmarkHash() avant de retoucher ce nombre.
//
// Ce compte est volontairement bas au regard des recommandations usuelles
// (OWASP : 600 000) : la plateforme l'impose. C'est le poivre, hors du
// classeur, qui protège réellement les hachages en cas de fuite de la seule
// Google Sheet — l'itération n'est ici qu'une défense supplémentaire.
//
// Changer cette valeur n'invalide pas les mots de passe déjà enregistrés :
// le nombre d'itérations est stocké dans chaque hachage et c'est lui que
// verifierMotDePasse_() rejoue.
const PBKDF2_ITERATIONS = 3500;

const LONGUEUR_MDP_MIN = 10;

const COMPTES_INITIAUX = [
  { email: 'rfgeneste@outlook.com', prenom: 'Renaud Frank', nom: 'GENESTE', estAdmin: true },
  { email: 'rfgeneste@gmail.com', prenom: 'Renaud Frank', nom: 'GENESTE', estAdmin: false },
  { email: 'leilo00614@gmail.com', prenom: 'Claude', nom: 'BAUDOUIN', estAdmin: false },
  { email: 'CS_Residenceduparc@outlook.com', prenom: 'CS', nom: 'test', estAdmin: false }
];

/* ========================= Installation / setup ========================= */

/**
 * À exécuter une fois depuis l'éditeur Apps Script.
 * Idempotent : peut être relancé sans risque.
 */
function setup() {
  ensureSheetsExist_();
  ensureAuthSheets_();
  ensurePepper_();
  const comptes = seedComptesInitiaux_();
  const migres = migrerStatutsOuvertEnCours_();
  const lotsMigres = migrerLots_();

  const messages = [
    'Feuilles vérifiées : ' + [POINTS_SHEET_NAME, HISTO_SHEET_NAME, USERS_SHEET_NAME,
      SESSIONS_SHEET_NAME, ETAT_SHEET_NAME, COPRO_SHEET_NAME].join(', '),
    'Comptes créés : ' + (comptes.length ? comptes.join(', ') : 'aucun (déjà présents)'),
    'Statuts "Ouvert" migrés en "' + STATUT_EN_COURS + '" : ' + migres + ' cellule(s)',
    lotsMigres
      ? 'Lots scindés en ' + ETAT_SHEET_NAME + ' et ' + COPRO_SHEET_NAME + ' : '
        + lotsMigres + ' lot(s). L\'ancienne feuille "' + LOTS_SHEET_NAME
        + '" est conservée intacte comme sauvegarde, vous pouvez la supprimer une fois vérifiée.'
      : 'Scission des lots : rien à faire (déjà migrée, ou feuille "' + LOTS_SHEET_NAME + '" absente ou vide)',
    'URL de l\'application utilisée pour les liens e-mail : ' + getAppUrl_()
  ];
  messages.forEach(function (m) { Logger.log(m); });
  return messages.join('\n');
}

/** Mesure le coût réel d'un hachage, pour calibrer PBKDF2_ITERATIONS. */
function benchmarkHash() {
  const t0 = new Date().getTime();
  hacherMotDePasse_('mot-de-passe-de-test');
  const ms = new Date().getTime() - t0;
  Logger.log(PBKDF2_ITERATIONS + ' itérations : ' + ms + ' ms');
  return ms;
}

function ensureSheetsExist_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let points = ss.getSheetByName(POINTS_SHEET_NAME);
  let histo = ss.getSheetByName(HISTO_SHEET_NAME);

  if (!points) {
    const sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getName() !== HISTO_SHEET_NAME) {
      points = sheets[0];
      points.setName(POINTS_SHEET_NAME);
    } else {
      points = ss.insertSheet(POINTS_SHEET_NAME);
    }
  }
  if (points.getLastRow() === 0) {
    points.appendRow(POINTS_HEADERS);
  }

  if (!histo) {
    histo = ss.insertSheet(HISTO_SHEET_NAME);
  }
  if (histo.getLastRow() === 0) {
    histo.appendRow(HISTO_HEADERS);
  } else if (histo.getLastColumn() < HISTO_HEADERS.length) {
    // Migration : ajout de la colonne "Auteur" aux historiques existants.
    const manquantes = HISTO_HEADERS.slice(histo.getLastColumn());
    histo.getRange(1, histo.getLastColumn() + 1, 1, manquantes.length).setValues([manquantes]);
  }

  return { points: points, histo: histo };
}

function ensureAuthSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const creer = function (nom, entetes) {
    let sheet = ss.getSheetByName(nom);
    if (!sheet) sheet = ss.insertSheet(nom);
    if (sheet.getLastRow() === 0) sheet.appendRow(entetes);
    return sheet;
  };
  return {
    users: creer(USERS_SHEET_NAME, USERS_HEADERS),
    sessions: creer(SESSIONS_SHEET_NAME, SESSIONS_HEADERS),
    etat: creer(ETAT_SHEET_NAME, ETAT_HEADERS),
    copro: creer(COPRO_SHEET_NAME, COPRO_HEADERS)
  };
}

/**
 * Scinde l'ancienne feuille "Lots" en EtatDivision et Coproprietaires.
 * Ne fait rien si les deux nouvelles feuilles contiennent déjà des données, ou
 * si l'ancienne est absente ou vide : setup() reste donc rejouable.
 * La feuille "Lots" n'est pas supprimée — elle sert de sauvegarde, et c'est à
 * l'administrateur de la retirer une fois la migration vérifiée.
 */
function migrerLots_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(LOTS_SHEET_NAME);
  if (!source || source.getLastRow() < 2) return 0;

  const feuilles = ensureAuthSheets_();
  if (feuilles.etat.getLastRow() > 1 || feuilles.copro.getLastRow() > 1) return 0;

  const valeurs = source.getDataRange().getValues();
  const entetes = valeurs[0].map(function (h) { return String(h).trim(); });
  const indexDe = function (nom) { return entetes.indexOf(nom); };

  // L'ancienne feuille Lots portait déjà les noms de la vue combinée : chaque
  // colonne cible se retrouve donc via VUE_DEPUIS_ETAT / VUE_DEPUIS_COPRO.
  const lignesEtat = [];
  const lignesCopro = [];

  for (let i = 1; i < valeurs.length; i++) {
    const r = valeurs[i];
    if (!r.some(function (c) { return c !== '' && c !== null; })) continue;

    lignesEtat.push(ETAT_HEADERS.map(function (h) {
      const j = indexDe(VUE_DEPUIS_ETAT[h]);
      return j === -1 ? '' : assainirCellule_(r[j]);
    }));

    lignesCopro.push(COPRO_HEADERS.map(function (h) {
      if (h === 'N° de lot') {
        const j = indexDe(VUE_DEPUIS_ETAT['N° de lot']);
        return j === -1 ? '' : assainirCellule_(r[j]);
      }
      const j = indexDe(VUE_DEPUIS_COPRO[h]);
      return j === -1 ? '' : assainirCellule_(r[j]);
    }));
  }

  if (!lignesEtat.length) return 0;

  ecrireFeuille_(feuilles.etat, ETAT_HEADERS, lignesEtat);
  ecrireFeuille_(feuilles.copro, COPRO_HEADERS, lignesCopro);

  // La date de fraîcheur n'est délibérément pas renseignée : aucun import réel
  // n'a eu lieu, l'afficher serait trompeur.
  return lignesEtat.length;
}

/** Remplace intégralement le contenu d'une feuille par des en-têtes + lignes. */
function ecrireFeuille_(sheet, entetes, lignes) {
  const rows = [entetes].concat(lignes);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, entetes.length).setValues(rows);
}

function seedComptesInitiaux_() {
  const sheet = ensureAuthSheets_().users;
  const existants = lireUtilisateurs_().map(function (u) { return u.emailNormalise; });
  const crees = [];
  COMPTES_INITIAUX.forEach(function (c) {
    if (existants.indexOf(c.email.trim().toLowerCase()) !== -1) return;
    sheet.appendRow([c.email, c.prenom, c.nom, '', c.estAdmin ? 'TRUE' : 'FALSE']);
    crees.push(c.email);
  });
  return crees;
}

/** Remplace l'ancien statut "Ouvert" par "En cours" dans Points et Historique. */
function migrerStatutsOuvertEnCours_() {
  const sheets = ensureSheetsExist_();
  let modifiees = 0;

  const migrer = function (sheet, headers) {
    const col = headers.indexOf('Statut') + 1;
    if (col === 0 || sheet.getLastRow() < 2) return;
    const plage = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    const valeurs = plage.getValues();
    let touche = false;
    valeurs.forEach(function (ligne) {
      if (String(ligne[0]).trim() === 'Ouvert') {
        ligne[0] = STATUT_EN_COURS;
        modifiees++;
        touche = true;
      }
    });
    if (touche) plage.setValues(valeurs);
  };

  migrer(sheets.points, POINTS_HEADERS);
  migrer(sheets.histo, HISTO_HEADERS);
  return modifiees;
}

/* ============================== Utilitaires ============================== */

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowIso_() {
  return new Date().toISOString();
}

/** Erreur portant un code exploitable par le client (ex. réafficher la connexion). */
function erreurAuth_(message, code) {
  const err = new Error(message);
  err.codeApp = code;
  return err;
}

function getAppUrl_() {
  const prop = PropertiesService.getScriptProperties().getProperty('APP_URL');
  return (prop || APP_URL_PAR_DEFAUT || '').replace(/\/+$/, '');
}

function getPepper_() {
  return PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
}

function ensurePepper_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) {
    props.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }
}

function octetsAleatoires_() {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Utilities.getUuid() + String(new Date().getTime())
  );
}

function jetonAleatoire_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function sha256Base64_(texte) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texte, Utilities.Charset.UTF_8)
  );
}

/** Comparaison à temps constant, pour ne pas fuiter d'information par le timing. */
function egaliteConstante_(a, b) {
  const sa = String(a);
  const sb = String(b);
  let diff = sa.length ^ sb.length;
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function normaliserEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function estVrai_(valeur) {
  return valeur === true || String(valeur).trim().toUpperCase() === 'TRUE';
}

/* ============================ Mots de passe ============================ */

/**
 * PBKDF2-HMAC-SHA256 (dkLen = 32, donc un seul bloc).
 * Le poivre, stocké dans les propriétés de script et non dans la feuille,
 * rend inexploitables des hachages obtenus par une fuite du seul classeur.
 */
function pbkdf2_(motDePasse, selOctets, iterations) {
  const cle = Utilities.newBlob(motDePasse + getPepper_()).getBytes();
  let u = Utilities.computeHmacSha256Signature(selOctets.concat([0, 0, 0, 1]), cle);
  const resultat = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, cle);
    for (let j = 0; j < resultat.length; j++) {
      resultat[j] = resultat[j] ^ u[j];
    }
  }
  return resultat;
}

/** Produit "pbkdf2$<iterations>$<sel base64>$<hash base64>". */
function hacherMotDePasse_(motDePasse) {
  const sel = octetsAleatoires_();
  const hash = pbkdf2_(motDePasse, sel, PBKDF2_ITERATIONS);
  return ['pbkdf2', PBKDF2_ITERATIONS, Utilities.base64Encode(sel), Utilities.base64Encode(hash)].join('$');
}

function verifierMotDePasse_(motDePasse, stocke) {
  const parties = String(stocke || '').split('$');
  if (parties.length !== 4 || parties[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parties[1], 10);
  if (!iterations || iterations < 1) return false;
  const sel = Utilities.base64Decode(parties[2]);
  const attendu = Utilities.base64Encode(pbkdf2_(motDePasse, sel, iterations));
  return egaliteConstante_(attendu, parties[3]);
}

/**
 * Hachage jetable, vérifié quand le compte n'existe pas ou n'a pas encore de
 * mot de passe. Sans lui, une adresse inconnue répondrait instantanément là où
 * une adresse réelle coûte une dérivation PBKDF2 complète : le temps de réponse
 * suffirait à énumérer les comptes.
 */
function hashFactice_() {
  const sel = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'sel-factice-anti-timing')
  );
  return ['pbkdf2', PBKDF2_ITERATIONS, sel, sel].join('$');
}

function validerMotDePasse_(motDePasse) {
  const mdp = String(motDePasse || '');
  if (mdp.length < LONGUEUR_MDP_MIN) {
    throw new Error('Le mot de passe doit contenir au moins ' + LONGUEUR_MDP_MIN + ' caractères.');
  }
  return mdp;
}

/* ============================ Utilisateurs ============================ */

function lireUtilisateurs_() {
  const sheet = ensureAuthSheets_().users;
  const valeurs = sheet.getDataRange().getValues();
  const utilisateurs = [];
  for (let i = 1; i < valeurs.length; i++) {
    const r = valeurs[i];
    if (!r[0]) continue;
    utilisateurs.push({
      rowIndex: i + 1,
      email: String(r[0]).trim(),
      emailNormalise: normaliserEmail_(r[0]),
      prenom: String(r[1] || ''),
      nom: String(r[2] || ''),
      hash: String(r[3] || ''),
      estAdmin: estVrai_(r[4])
    });
  }
  return utilisateurs;
}

function trouverUtilisateur_(email) {
  const cible = normaliserEmail_(email);
  if (!cible) return null;
  const trouves = lireUtilisateurs_().filter(function (u) { return u.emailNormalise === cible; });
  return trouves.length ? trouves[0] : null;
}

/** Vue publique d'un utilisateur : jamais de hachage renvoyé au client. */
function utilisateurPublic_(u) {
  return {
    email: u.email,
    prenom: u.prenom,
    nom: u.nom,
    estAdmin: u.estAdmin,
    nomAffiche: nomAffiche_(u)
  };
}

function nomAffiche_(u) {
  return [u.prenom, u.nom].filter(function (p) { return p; }).join(' ') || u.email;
}

function definirHashUtilisateur_(user, hash) {
  const sheet = ensureAuthSheets_().users;
  sheet.getRange(user.rowIndex, USERS_HEADERS.indexOf('MotDePasseHash') + 1).setValue(hash);
}

/* ======================= Sessions et liens e-mail ======================= */

function sessionsSheet_() {
  return ensureAuthSheets_().sessions;
}

function creerJeton_(email, type, dureeMs) {
  const jeton = jetonAleatoire_();
  const expire = new Date(new Date().getTime() + dureeMs);
  sessionsSheet_().appendRow([
    sha256Base64_(jeton), normaliserEmail_(email), type, expire.toISOString(), nowIso_(), ''
  ]);
  return jeton;
}

/**
 * Résout un jeton de session en utilisateur. Renvoie null si le jeton est
 * inconnu, expiré, d'un autre type, ou si le compte a disparu de la feuille
 * Utilisateurs (retirer un compte révoque donc immédiatement ses sessions).
 */
function utilisateurDepuisJeton_(jeton) {
  if (!jeton) return null;
  const empreinte = sha256Base64_(jeton);
  const sheet = sessionsSheet_();
  const valeurs = sheet.getDataRange().getValues();
  const maintenant = new Date();

  for (let i = 1; i < valeurs.length; i++) {
    const r = valeurs[i];
    if (String(r[0]) !== empreinte || String(r[2]) !== 'session') continue;
    const expire = new Date(r[3]);
    if (!(expire > maintenant)) return null;

    const user = trouverUtilisateur_(r[1]);
    if (!user) return null;

    // Session glissante, prolongée au plus une fois par jour pour éviter
    // une écriture dans la feuille à chaque requête.
    const restant = expire.getTime() - maintenant.getTime();
    if (restant < SESSION_DUREE_MS - 24 * 3600 * 1000) {
      sheet.getRange(i + 1, SESSIONS_HEADERS.indexOf('Expire') + 1)
        .setValue(new Date(maintenant.getTime() + SESSION_DUREE_MS).toISOString());
    }
    return user;
  }
  return null;
}

/** Consomme un lien à usage unique (première connexion / mot de passe oublié). */
function consommerLien_(jeton) {
  if (!jeton) return null;
  const empreinte = sha256Base64_(jeton);
  const sheet = sessionsSheet_();
  const valeurs = sheet.getDataRange().getValues();
  const maintenant = new Date();

  for (let i = 1; i < valeurs.length; i++) {
    const r = valeurs[i];
    if (String(r[0]) !== empreinte || String(r[2]) !== 'lien') continue;
    if (r[5]) return null;                        // déjà utilisé
    if (!(new Date(r[3]) > maintenant)) return null; // expiré
    sheet.getRange(i + 1, SESSIONS_HEADERS.indexOf('UtiliseLe') + 1).setValue(nowIso_());
    return trouverUtilisateur_(r[1]);
  }
  return null;
}

function supprimerJetonsDe_(email, type) {
  const cible = normaliserEmail_(email);
  const sheet = sessionsSheet_();
  const valeurs = sheet.getDataRange().getValues();
  for (let i = valeurs.length - 1; i >= 1; i--) {
    const r = valeurs[i];
    if (normaliserEmail_(r[1]) !== cible) continue;
    if (type && String(r[2]) !== type) continue;
    sheet.deleteRow(i + 1);
  }
}

function supprimerJeton_(jeton) {
  if (!jeton) return;
  const empreinte = sha256Base64_(jeton);
  const sheet = sessionsSheet_();
  const valeurs = sheet.getDataRange().getValues();
  for (let i = valeurs.length - 1; i >= 1; i--) {
    if (String(valeurs[i][0]) === empreinte) sheet.deleteRow(i + 1);
  }
}

function purgerJetonsExpires_() {
  const sheet = sessionsSheet_();
  const valeurs = sheet.getDataRange().getValues();
  const maintenant = new Date();
  for (let i = valeurs.length - 1; i >= 1; i--) {
    const expire = new Date(valeurs[i][3]);
    if (!(expire > maintenant)) sheet.deleteRow(i + 1);
  }
}

/* ========================= Contrôle des droits ========================= */

function requireUser_(body) {
  const user = utilisateurDepuisJeton_(body && body.token);
  if (!user) {
    throw erreurAuth_('Vous devez être connecté pour effectuer cette action.', 'AUTH_REQUISE');
  }
  return user;
}

function requireAdmin_(body) {
  const user = requireUser_(body);
  if (!user.estAdmin) {
    throw erreurAuth_('Action réservée aux administrateurs.', 'DROITS_INSUFFISANTS');
  }
  return user;
}

/* ========================= Anti-force brute ========================= */

function cleEchecs_(email) {
  return 'echecs_' + Utilities.base64EncodeWebSafe(normaliserEmail_(email));
}

function verifierQuotaEchecs_(email) {
  const n = parseInt(CacheService.getScriptCache().get(cleEchecs_(email)) || '0', 10);
  if (n >= MAX_ECHECS) {
    throw erreurAuth_(
      'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
      'TROP_TENTATIVES'
    );
  }
}

function noterEchec_(email) {
  const cache = CacheService.getScriptCache();
  const cle = cleEchecs_(email);
  const n = parseInt(cache.get(cle) || '0', 10) + 1;
  cache.put(cle, String(n), FENETRE_ECHECS_S);
}

function effacerEchecs_(email) {
  CacheService.getScriptCache().remove(cleEchecs_(email));
}

/* ================================ doGet ================================ */

function doGet(e) {
  try {
    ensureSheetsExist_();
    const action = (e.parameter.action || 'list');

    if (action === 'list') {
      const points = readAllPoints_();
      const historique = readAllHistorique_();
      if (e.parameter.pointId) {
        const pid = String(e.parameter.pointId);
        return jsonOut_({
          ok: true,
          points: points.filter(function (p) { return String(p.ID) === pid; }),
          historique: historique.filter(function (h) { return String(h.PointId) === pid; })
        });
      }
      return jsonOut_({ ok: true, points: points, historique: historique });
    }

    if (action === 'lots') {
      return jsonOut_({
        ok: true,
        lots: readAllLots_(),
        majCoproprietaires: getMajCoproprietaires_()
      });
    }

    // Colonnes attendues par l'import, pour que le front puisse produire un
    // modèle CSV qui ne risque pas de diverger de ce que le serveur valide.
    if (action === 'modele') {
      const modele = MODELES[e.parameter.feuille];
      if (!modele) return jsonOut_({ ok: false, error: 'Modèle inconnu : ' + e.parameter.feuille });
      return jsonOut_({
        ok: true,
        entetes: modele.entetes,
        exemple: modele.exemple,
        nomFichier: modele.nomFichier
      });
    }

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function readAllPoints_() {
  const sheet = ensureSheetsExist_().points;
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  return rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) {
      const obj = {};
      POINTS_HEADERS.forEach(function (h, i) { obj[h] = r[i]; });
      return obj;
    });
}

function readAllHistorique_() {
  const sheet = ensureSheetsExist_().histo;
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  return rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) {
      const obj = {};
      HISTO_HEADERS.forEach(function (h, i) { obj[h] = r[i] === undefined ? '' : r[i]; });
      return obj;
    });
}

/** Lit une feuille en objets {en-tête: valeur}, lignes vides ignorées. */
function lireFeuille_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const entetes = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1)
    .filter(function (r) {
      return r.some(function (c) { return c !== '' && c !== null; });
    })
    .map(function (r) {
      const obj = {};
      entetes.forEach(function (h, i) {
        if (h) obj[h] = r[i] === undefined || r[i] === null ? '' : r[i];
      });
      return obj;
    });
}

function cleLot_(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim();
}

/**
 * Vue combinée des deux feuilles, dans la forme historique attendue par
 * l'application (cf. VUE_DEPUIS_ETAT / VUE_DEPUIS_COPRO).
 *
 * La jointure part d'EtatDivision : tout lot structurel est affiché, avec un
 * copropriétaire vide si aucune ligne ne lui correspond. Une ligne de
 * Coproprietaires visant un lot inconnu n'apparaît pas — elle est signalée à
 * l'import plutôt que d'être perdue en silence.
 */
function readAllLots_() {
  const feuilles = ensureAuthSheets_();

  const proprietaires = {};
  lireFeuille_(feuilles.copro).forEach(function (ligne) {
    const cle = cleLot_(ligne['N° de lot']);
    if (cle) proprietaires[cle] = ligne;
  });

  return lireFeuille_(feuilles.etat).map(function (ligne) {
    const obj = {};
    Object.keys(VUE_DEPUIS_ETAT).forEach(function (source) {
      obj[VUE_DEPUIS_ETAT[source]] = ligne[source] === undefined ? '' : ligne[source];
    });

    const copro = proprietaires[cleLot_(ligne['N° de lot'])];
    Object.keys(VUE_DEPUIS_COPRO).forEach(function (source) {
      obj[VUE_DEPUIS_COPRO[source]] = copro && copro[source] !== undefined ? copro[source] : '';
    });

    return obj;
  });
}

/** Numéros de lot de Coproprietaires absents d'EtatDivision. */
function lotsOrphelins_() {
  const feuilles = ensureAuthSheets_();
  const connus = {};
  lireFeuille_(feuilles.etat).forEach(function (l) {
    connus[cleLot_(l['N° de lot'])] = true;
  });

  const orphelins = [];
  lireFeuille_(feuilles.copro).forEach(function (l) {
    const cle = cleLot_(l['N° de lot']);
    if (cle && !connus[cle] && orphelins.indexOf(cle) === -1) orphelins.push(cle);
  });
  return orphelins;
}

function getMajCoproprietaires_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_MAJ_COPRO) || '';
}

/* ================================ doPost ================================ */

// Actions accessibles sans être connecté (le flux d'authentification lui-même).
const ACTIONS_PUBLIQUES = ['login', 'demandeLien', 'definirMotDePasse', 'me', 'logout'];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Requête illisible' });
  }

  const action = body.action;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Le serveur est occupé, réessayez dans un instant.' });
  }

  try {
    ensureSheetsExist_();

    // --- Authentification ---
    if (action === 'login') return jsonOut_(handleLogin_(body));
    if (action === 'demandeLien') return jsonOut_(handleDemandeLien_(body));
    if (action === 'definirMotDePasse') return jsonOut_(handleDefinirMotDePasse_(body));
    if (action === 'me') return jsonOut_(handleMe_(body));
    if (action === 'logout') return jsonOut_(handleLogout_(body));

    // --- Points de suivi ---
    if (action === 'create') return jsonOut_(handleCreate_(body, requireAdmin_(body)));
    if (action === 'ajoutSuivi') return jsonOut_(handleAjoutSuivi_(body, requireUser_(body)));
    if (action === 'editSuivi') return jsonOut_(handleEditSuivi_(body, requireAdmin_(body)));
    if (action === 'renamePoint') return jsonOut_(handleRenamePoint_(body, requireAdmin_(body)));
    if (action === 'deletePoint') return jsonOut_(handleDeletePoint_(body, requireAdmin_(body)));

    // --- Administration ---
    if (action === 'importEtatDivision') return jsonOut_(handleImportEtatDivision_(body, requireAdmin_(body)));
    if (action === 'importCoproprietaires') return jsonOut_(handleImportCoproprietaires_(body, requireAdmin_(body)));
    if (action === 'listUsers') return jsonOut_(handleListUsers_(body, requireAdmin_(body)));
    if (action === 'addUser') return jsonOut_(handleAddUser_(body, requireAdmin_(body)));
    if (action === 'removeUser') return jsonOut_(handleRemoveUser_(body, requireAdmin_(body)));

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message || String(err), code: err.codeApp || '' });
  } finally {
    lock.releaseLock();
  }
}

/* ====================== Actions d'authentification ====================== */

function handleLogin_(body) {
  const email = normaliserEmail_(body.email);
  if (!email) return { ok: false, error: 'Email requis' };
  verifierQuotaEchecs_(email);

  const user = trouverUtilisateur_(email);
  const motDePasse = String(body.motDePasse || '');

  const echec = {
    ok: false,
    code: 'IDENTIFIANTS_INVALIDES',
    error: 'Email ou mot de passe incorrect.'
  };

  // Un compte connu mais sans mot de passe est signalé explicitement, pour
  // guider la première connexion. Choix assumé : cela permet de découvrir
  // quelles adresses n'ont pas encore de compte actif. La fuite s'arrête là —
  // un compte inconnu et un mauvais mot de passe restent indiscernables, texte
  // et temps de calcul compris (d'où le hachage factice ci-dessous), de sorte
  // que la liste des comptes réellement actifs n'est pas énumérable.
  if (user && !user.hash) {
    return {
      ok: false,
      code: 'MOT_DE_PASSE_NON_DEFINI',
      error: 'Aucun mot de passe n\'est encore défini pour ce compte. '
        + 'Utilisez « Première connexion ou mot de passe oublié » pour recevoir un lien par e-mail.'
    };
  }

  if (!user) {
    verifierMotDePasse_(motDePasse, hashFactice_());
    noterEchec_(email);
    return echec;
  }
  if (!verifierMotDePasse_(motDePasse, user.hash)) {
    noterEchec_(email);
    return echec;
  }

  effacerEchecs_(email);
  purgerJetonsExpires_();
  const jeton = creerJeton_(user.email, 'session', SESSION_DUREE_MS);
  return { ok: true, token: jeton, user: utilisateurPublic_(user) };
}

/**
 * Envoie un lien de définition/réinitialisation de mot de passe.
 * Répond toujours ok:true, même pour une adresse inconnue, afin de ne pas
 * transformer ce point d'entrée en oracle listant les comptes existants.
 */
function handleDemandeLien_(body) {
  const email = normaliserEmail_(body.email);
  const reponse = {
    ok: true,
    message: 'Si cette adresse correspond à un compte, un e-mail vient d\'être envoyé. '
      + 'Le lien est valable une heure.'
  };
  if (!email) return { ok: false, error: 'Email requis' };

  const user = trouverUtilisateur_(email);
  if (!user) return reponse;

  supprimerJetonsDe_(user.email, 'lien');
  const jeton = creerJeton_(user.email, 'lien', LIEN_DUREE_MS);
  envoyerLienEmail_(user, jeton, user.hash ? 'oubli' : 'init');
  return reponse;
}

function envoyerLienEmail_(user, jeton, motif) {
  const base = getAppUrl_();
  const lien = base + (base.indexOf('?') === -1 ? '?' : '&') + 'resetToken=' + encodeURIComponent(jeton);
  const premiere = motif === 'init';

  const sujet = premiere
    ? 'Définissez votre mot de passe — La Résidence du Parc'
    : 'Réinitialisation de votre mot de passe — La Résidence du Parc';

  const intro = premiere
    ? 'Un compte vient d\'être ouvert pour vous sur l\'application de la copropriété '
      + 'La Résidence du Parc. Cliquez sur le lien ci-dessous pour définir votre mot de passe.'
    : 'Vous avez demandé à réinitialiser votre mot de passe sur l\'application de la '
      + 'copropriété La Résidence du Parc. Cliquez sur le lien ci-dessous pour en choisir un nouveau.';

  const texte = 'Bonjour ' + nomAffiche_(user) + ',\n\n'
    + intro + '\n\n' + lien + '\n\n'
    + 'Ce lien est valable une heure et ne peut servir qu\'une fois.\n'
    + 'Si vous n\'êtes pas à l\'origine de cette demande, ignorez simplement cet e-mail : '
    + 'votre mot de passe actuel reste inchangé.\n';

  const html = '<p>Bonjour ' + echapperHtml_(nomAffiche_(user)) + ',</p>'
    + '<p>' + echapperHtml_(intro) + '</p>'
    + '<p><a href="' + lien + '">' + (premiere ? 'Définir mon mot de passe' : 'Choisir un nouveau mot de passe') + '</a></p>'
    + '<p style="color:#666;font-size:13px">Ce lien est valable une heure et ne peut servir qu\'une fois. '
    + 'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.</p>';

  MailApp.sendEmail({ to: user.email, subject: sujet, body: texte, htmlBody: html });
}

function echapperHtml_(texte) {
  return String(texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Consomme le lien reçu par e-mail et enregistre le nouveau mot de passe. */
function handleDefinirMotDePasse_(body) {
  // Valider avant de consommer le lien : un mot de passe trop court ne doit pas
  // brûler le lien et obliger à en redemander un.
  const mdp = validerMotDePasse_(body.motDePasse);

  const user = consommerLien_(body.lienToken);
  if (!user) {
    return {
      ok: false,
      code: 'LIEN_INVALIDE',
      error: 'Ce lien est invalide, expiré ou déjà utilisé. Demandez-en un nouveau.'
    };
  }

  definirHashUtilisateur_(user, hacherMotDePasse_(mdp));

  // Un changement de mot de passe invalide les sessions ouvertes ailleurs.
  supprimerJetonsDe_(user.email, 'session');
  effacerEchecs_(user.email);

  const frais = trouverUtilisateur_(user.email);
  const jeton = creerJeton_(frais.email, 'session', SESSION_DUREE_MS);
  return { ok: true, token: jeton, user: utilisateurPublic_(frais) };
}

function handleMe_(body) {
  const user = utilisateurDepuisJeton_(body.token);
  if (!user) return { ok: true, user: null };
  return { ok: true, user: utilisateurPublic_(user) };
}

function handleLogout_(body) {
  supprimerJeton_(body.token);
  return { ok: true };
}

/* ==================== Points de suivi (actions métier) ==================== */

/** create — réservé aux administrateurs (cf. doPost). */
function handleCreate_(body, user) {
  if (!body.sujet) return { ok: false, error: 'Sujet requis' };

  const sheet = ensureSheetsExist_().points;
  const newId = nextNumericId_(sheet);
  const now = nowIso_();
  const statut = normaliserStatut_(body.statut) || STATUT_EN_COURS;

  const row = [
    newId,
    body.dateOuverture || now.slice(0, 10),
    body.sujet,
    body.description || '',
    statut,
    body.responsable || '',
    body.dateEcheance || '',
    body.priorite || '',
    now,
    now
  ];
  sheet.appendRow(row);

  const note = body.note || ('Point créé : ' + body.sujet);
  appendHistorique_(newId, {
    note: note,
    resume: body.resume || note.slice(0, 30),
    responsable: body.responsable || '',
    dateEcheance: body.dateEcheance || '',
    priorite: body.priorite || '',
    document: body.document || '',
    statut: statut,
    auteur: nomAffiche_(user)
  });

  return { ok: true, id: newId };
}

function nextNumericId_(sheet) {
  const values = sheet.getDataRange().getValues();
  let maxId = 0;
  for (let i = 1; i < values.length; i++) {
    const raw = values[i][0];
    const n = parseInt(raw, 10);
    if (!isNaN(n) && String(n) === String(raw).trim()) {
      if (n > maxId) maxId = n;
    }
  }
  return maxId + 1;
}

function normaliserStatut_(valeur) {
  const v = String(valeur || '').trim();
  if (!v) return '';
  if (v === 'Ouvert') return STATUT_EN_COURS;   // tolère l'ancien libellé
  if (STATUTS.indexOf(v) === -1) {
    throw new Error('Statut inconnu : ' + v);
  }
  return v;
}

function trouverPoint_(pointId) {
  const pid = String(pointId);
  const points = readAllPoints_();
  const trouves = points.filter(function (p) { return String(p.ID) === pid; });
  return trouves.length ? trouves[0] : null;
}

/**
 * ajoutSuivi — ouvert à tout utilisateur connecté (commentaire, échéance,
 * responsable, pièce jointe), SAUF le changement de statut : clôturer comme
 * rouvrir un point est réservé aux administrateurs.
 */
function handleAjoutSuivi_(body, user) {
  if (!body.id) return { ok: false, error: 'id requis' };
  if (!body.note) return { ok: false, error: 'note requise' };

  const pid = String(body.id);
  const point = trouverPoint_(pid);
  if (!point) return { ok: false, error: 'Point introuvable: ' + pid };

  const statutDemande = normaliserStatut_(body.statut);
  if (statutDemande && statutDemande !== normaliserStatut_(point.Statut) && !user.estAdmin) {
    throw erreurAuth_(
      'Seul un administrateur peut changer le statut d\'un point.',
      'DROITS_INSUFFISANTS'
    );
  }

  appendHistorique_(pid, {
    note: body.note,
    resume: body.resume || String(body.note).slice(0, 30),
    responsable: body.responsable || '',
    dateEcheance: body.dateEcheance || '',
    priorite: body.priorite || '',
    document: body.document || '',
    statut: statutDemande,
    auteur: nomAffiche_(user)
  });

  const ok = recomputePointCache_(pid);
  if (!ok) return { ok: false, error: 'Point introuvable: ' + pid };
  return { ok: true, id: pid };
}

/** editSuivi — corriger une entrée déjà enregistrée : administrateurs seuls. */
function handleEditSuivi_(body, user) {
  if (!body.histoId) return { ok: false, error: 'histoId requis' };

  const sheet = ensureSheetsExist_().histo;
  const values = sheet.getDataRange().getValues();
  const colOf = function (name) { return HISTO_HEADERS.indexOf(name) + 1; };

  let pointId = null;
  let found = false;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(body.histoId)) {
      found = true;
      pointId = values[i][HISTO_HEADERS.indexOf('PointId')];
      const rowIndex = i + 1;
      const editable = {
        note: 'Note',
        resume: 'Resume',
        responsable: 'Responsable',
        dateEcheance: 'DateEcheance',
        priorite: 'Priorite',
        document: 'Document',
        statut: 'Statut'
      };
      Object.keys(editable).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          const valeur = key === 'statut' ? normaliserStatut_(body[key]) : body[key];
          sheet.getRange(rowIndex, colOf(editable[key])).setValue(valeur);
        }
      });
      break;
    }
  }

  if (!found) return { ok: false, error: 'Entrée introuvable: ' + body.histoId };
  recomputePointCache_(pointId);
  return { ok: true, id: String(pointId) };
}

/** renamePoint — administrateurs seuls. */
function handleRenamePoint_(body, user) {
  if (!body.id) return { ok: false, error: 'id requis' };
  if (!body.sujet) return { ok: false, error: 'sujet requis' };

  const pid = String(body.id);
  const sheet = ensureSheetsExist_().points;
  const values = sheet.getDataRange().getValues();
  const colOf = function (name) { return POINTS_HEADERS.indexOf(name) + 1; };

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === pid) {
      const rowIndex = i + 1;
      const oldSujet = values[i][POINTS_HEADERS.indexOf('Sujet')];
      sheet.getRange(rowIndex, colOf('Sujet')).setValue(body.sujet);
      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        sheet.getRange(rowIndex, colOf('Description')).setValue(body.description);
      }
      sheet.getRange(rowIndex, colOf('DateMAJ')).setValue(nowIso_());

      if (oldSujet !== body.sujet) {
        appendHistorique_(pid, {
          note: 'Sujet modifié : "' + oldSujet + '" → "' + body.sujet + '"',
          resume: 'Renommé',
          auteur: nomAffiche_(user)
        });
      }
      return { ok: true, id: pid };
    }
  }
  return { ok: false, error: 'Point introuvable: ' + pid };
}

/** deletePoint — administrateurs seuls. Supprime le point et tout son historique. */
function handleDeletePoint_(body, user) {
  if (!body.id) return { ok: false, error: 'id requis' };
  const pid = String(body.id);
  const sheets = ensureSheetsExist_();

  const pointsValues = sheets.points.getDataRange().getValues();
  let supprime = false;
  for (let i = pointsValues.length - 1; i >= 1; i--) {
    if (String(pointsValues[i][0]) === pid) {
      sheets.points.deleteRow(i + 1);
      supprime = true;
    }
  }
  if (!supprime) return { ok: false, error: 'Point introuvable: ' + pid };

  const histoValues = sheets.histo.getDataRange().getValues();
  const colPointId = HISTO_HEADERS.indexOf('PointId');
  for (let i = histoValues.length - 1; i >= 1; i--) {
    if (String(histoValues[i][colPointId]) === pid) {
      sheets.histo.deleteRow(i + 1);
    }
  }

  return { ok: true, id: pid };
}

/**
 * L'auteur est toujours dérivé de la session côté serveur, jamais lu depuis
 * la requête. On stocke le nom affiché et non l'e-mail : l'historique est
 * consultable publiquement, il ne doit pas exposer les adresses des comptes.
 */
function appendHistorique_(pointId, fields) {
  const sheet = ensureSheetsExist_().histo;
  const histoId = Utilities.getUuid();
  sheet.appendRow([
    histoId,
    pointId,
    nowIso_(),
    fields.note || '',
    (fields.resume || '').slice(0, 30),
    fields.responsable || '',
    fields.dateEcheance || '',
    fields.priorite || '',
    fields.document || '',
    fields.statut || '',
    fields.auteur || ''
  ]);
}

/**
 * Recalcule l'état courant d'un point (onglet Points) à partir de TOUT son
 * historique, dans l'ordre chronologique — plutôt que de se fier uniquement au
 * dernier ajout. Nécessaire pour que corriger une entrée passée (editSuivi)
 * reste cohérent avec l'état affiché du point.
 */
function recomputePointCache_(pointId) {
  const pid = String(pointId);
  const pointsSheet = ensureSheetsExist_().points;
  const pointsValues = pointsSheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < pointsValues.length; i++) {
    if (String(pointsValues[i][0]) === pid) { rowIndex = i + 1; break; }
  }
  if (rowIndex === -1) return false;

  const histo = readAllHistorique_()
    .filter(function (h) { return String(h.PointId) === pid; })
    .sort(function (a, b) { return new Date(a.Date) - new Date(b.Date); });

  const cache = {};
  CACHE_FIELDS.forEach(function (f) { cache[f] = ''; });
  histo.forEach(function (h) {
    CACHE_FIELDS.forEach(function (f) {
      if (h[f]) cache[f] = h[f];
    });
  });

  const colOf = function (name) { return POINTS_HEADERS.indexOf(name) + 1; };
  CACHE_FIELDS.forEach(function (f) {
    pointsSheet.getRange(rowIndex, colOf(f)).setValue(cache[f]);
  });
  pointsSheet.getRange(rowIndex, colOf('DateMAJ')).setValue(nowIso_());
  return true;
}

/* ======================= Administration : Lots ======================= */

/** Contrôles communs aux deux imports : lignes présentes et colonnes attendues. */
function validerLignesImport_(lignes, entetes) {
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return 'Aucune ligne à importer.';
  }
  const manquantes = entetes.filter(function (h) {
    return !Object.prototype.hasOwnProperty.call(lignes[0], h);
  });
  if (manquantes.length) {
    return 'Colonnes manquantes dans le fichier : ' + manquantes.join(', ');
  }
  return null;
}

function enLignesFeuille_(lignes, entetes) {
  return lignes.map(function (l) {
    return entetes.map(function (h) { return assainirCellule_(l[h]); });
  });
}

/**
 * importEtatDivision — administrateurs seuls. Remplace la structure complète du
 * bâtiment, opération rare et lourde de conséquences : le client fait saisir
 * « CONFIRMER », et le serveur exige la même confirmation explicite plutôt que
 * de s'en remettre à l'interface.
 */
function handleImportEtatDivision_(body, user) {
  if (String(body.confirmation || '').trim().toUpperCase() !== 'CONFIRMER') {
    return { ok: false, error: 'Confirmation explicite requise pour remplacer l\'état de division.' };
  }

  const erreur = validerLignesImport_(body.lignes, ETAT_HEADERS);
  if (erreur) return { ok: false, error: erreur };

  ecrireFeuille_(ensureAuthSheets_().etat, ETAT_HEADERS,
    enLignesFeuille_(body.lignes, ETAT_HEADERS));

  // Des lots peuvent avoir disparu : les copropriétaires qui s'y rattachaient
  // deviennent orphelins et cesseraient d'être affichés sans prévenir.
  return { ok: true, nombre: body.lignes.length, orphelins: lotsOrphelins_() };
}

/**
 * importCoproprietaires — administrateurs seuls. Opération courante (mutations),
 * sans confirmation renforcée. Horodate la mise à jour, affichée publiquement.
 */
function handleImportCoproprietaires_(body, user) {
  const erreur = validerLignesImport_(body.lignes, COPRO_HEADERS);
  if (erreur) return { ok: false, error: erreur };

  ecrireFeuille_(ensureAuthSheets_().copro, COPRO_HEADERS,
    enLignesFeuille_(body.lignes, COPRO_HEADERS));

  const maintenant = nowIso_();
  PropertiesService.getScriptProperties().setProperty(PROP_MAJ_COPRO, maintenant);

  return {
    ok: true,
    nombre: body.lignes.length,
    majCoproprietaires: maintenant,
    orphelins: lotsOrphelins_()
  };
}

/** Neutralise les valeurs interprétées comme formule par Sheets. */
function assainirCellule_(valeur) {
  if (valeur === null || valeur === undefined) return '';
  const s = String(valeur);
  return s.charAt(0) === '=' ? "'" + s : s;
}

/* =================== Administration : Utilisateurs =================== */

function handleListUsers_(body, user) {
  const utilisateurs = lireUtilisateurs_().map(function (u) {
    const pub = utilisateurPublic_(u);
    pub.motDePasseDefini = !!u.hash;   // jamais le hachage lui-même
    return pub;
  });
  return { ok: true, users: utilisateurs };
}

function handleAddUser_(body, user) {
  const email = String(body.email || '').trim();
  if (!email || email.indexOf('@') === -1) {
    return { ok: false, error: 'Adresse e-mail invalide.' };
  }
  if (trouverUtilisateur_(email)) {
    return { ok: false, error: 'Ce compte existe déjà.' };
  }

  ensureAuthSheets_().users.appendRow([
    email,
    String(body.prenom || '').trim(),
    String(body.nom || '').trim(),
    '',                                  // mot de passe défini via le lien e-mail
    body.estAdmin ? 'TRUE' : 'FALSE'
  ]);

  const cree = trouverUtilisateur_(email);
  let emailEnvoye = false;
  if (body.envoyerInvitation !== false) {
    try {
      const jeton = creerJeton_(cree.email, 'lien', LIEN_DUREE_MS);
      envoyerLienEmail_(cree, jeton, 'init');
      emailEnvoye = true;
    } catch (err) {
      // Le compte est créé malgré tout : l'invitation reste renvoyable ensuite.
      Logger.log('Envoi de l\'invitation impossible : ' + err);
    }
  }

  return { ok: true, user: utilisateurPublic_(cree), invitationEnvoyee: emailEnvoye };
}

function handleRemoveUser_(body, user) {
  const cible = trouverUtilisateur_(body.email);
  if (!cible) return { ok: false, error: 'Compte introuvable.' };

  if (cible.emailNormalise === user.emailNormalise) {
    return { ok: false, error: 'Vous ne pouvez pas supprimer votre propre compte.' };
  }

  const admins = lireUtilisateurs_().filter(function (u) { return u.estAdmin; });
  if (cible.estAdmin && admins.length <= 1) {
    return { ok: false, error: 'Impossible de supprimer le dernier administrateur.' };
  }

  supprimerJetonsDe_(cible.email, null);          // révoque ses sessions
  ensureAuthSheets_().users.deleteRow(cible.rowIndex);
  return { ok: true, email: cible.email };
}
