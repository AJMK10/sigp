# SIGP Inventaire — application mobile

Application React Native (Expo SDK 52) des équipes d'inventaire physique : lecture des étiquettes (QR code, code-barres),
fiche constat avec photos, comptage **sans réseau**, synchronisation et clôture de zone signée par le chef d'équipe.
Elle reprend les écrans mobiles de la maquette (Mes zones, Scan, Fiche constat, Clôture de zone).

## Fonctionnement hors ligne

1. À la connexion, l'application télécharge le **paquet** de l'équipe (`GET /api/mobile/paquet`) : zones confiées dans les
   campagnes ouvertes, locaux de chaque zone, dictionnaire des biens présents dans ces zones, constats déjà enregistrés.
   En comptage à l'aveugle, la liste attendue par zone et la localisation attendue ne sont pas transmises.
2. Les constats sont enregistrés **sur l'appareil à chaque saisie** (survivent à la fermeture, à une panne de batterie).
3. Au retour du réseau (ou au retour de l'application au premier plan), la file part par lots de 200
   (`POST /api/mobile/synchroniser`). Chaque constat porte un identifiant généré par l'appareil : un lot renvoyé après une
   coupure n'est **jamais enregistré deux fois**. Un constat refusé (zone clôturée, commentaire manquant…) reste sur
   l'appareil avec son motif, pour correction.
4. Les photos partent après leur constat (`POST /api/mobile/photos`) et sont rangées dans la GED du bien.
5. La clôture de zone (`POST /api/mobile/zones/:id/cloturer`) exige que tout soit transmis et conserve la signature du chef
   d'équipe en GED (procès-verbal).

Règles reprises du web : commentaire obligatoire pour un bien en mauvais état ou hors d'usage (plus une photo, exigée par
l'application), un bien constaté une seule fois par campagne (le constat le plus récent l'emporte), position et horodatage.
La déconnexion conserve les constats non transmis ; seul le compte qui les a saisis peut les envoyer.

## Développement

```bash
cd apps/mobile
npm install
npx expo start          # puis Expo Go sur le téléphone (même réseau) ou un émulateur
npm run typecheck
npm test                # logique hors ligne : reconnaissance, file, synchronisation
```

À la première connexion, saisissez l'adresse du serveur (ex. `sigp.monentite.ci` ou `http://192.168.1.10:3000`) :
l'application complète en `…/api`. Une adresse par défaut peut être fixée dans `app.json` (`expo.extra.defaultApiUrl`).

## Construire l'application

```bash
npm install -g eas-cli
eas build -p android --profile preview      # APK installable directement (distribution interne)
eas build -p android --profile production   # Android App Bundle pour le Play Store
eas build -p ios --profile production       # nécessite un compte Apple Developer
```

Permissions demandées : caméra (lecture des étiquettes, photos), localisation pendant l'utilisation (horodatage des constats).
