<!-- Développé avec l'aide de l'IA (Claude). Idée et conception par l'équipe. -->
# Lunar Landing Site Navigator

## Présentation du projet

**Lunar Landing Site Navigator** est une application web statique d'aide à la comparaison de points représentatifs près du pôle Sud lunaire. Elle estime, pour une période choisie, la durée pendant laquelle le Soleil (source d'énergie) et la Terre (communication directe) se trouvent au-dessus de l'horizon local. Elle signale également les périodes de nuit, de perte de visibilité de la Terre et de perte simultanée des deux.

À l'ouverture, un écran d'accueil présente le navigateur et ses limites; le bouton « Explore the navigator » ouvre l'application. L'interface propose ensuite quatre sections : **Analysis** pour examiner un site et une période, **Compare** pour classer plusieurs sites, **Validation** pour consulter les contrôles de données, et **About** pour les hypothèses, limites et sources.

Le projet côté navigateur utilise HTML, CSS, JavaScript sans framework et Canvas. Il n'y a pas de compilation ni de serveur applicatif. Les positions célestes sont pré-calculées et enregistrées en JSON : le navigateur ne contacte pas NASA/JPL Horizons. Un serveur HTTP statique est toutefois nécessaire pour charger ces fichiers JSON avec `fetch` (par exemple l'extension Live Server de VS Code). Ouvrir directement `index.html` avec une adresse `file://` empêche généralement leur chargement.

## Fonctionnement général

1. Au démarrage, `app.js` charge les sites et les éphémérides depuis `data/`, puis initialise les contrôles de date et les graphiques.
2. L'utilisateur choisit un site et une période. Les échantillons horaires du Soleil et de la Terre sont associés par leur horodatage UTC; seuls ceux de la période sélectionnée sont analysés.
3. Pour chaque échantillon, l'application compare l'élévation de l'astre à l'élévation du terrain dans sa direction. Dans Analysis, le bouton « Terrain on/off » bascule entre le profil LOLA disponible et l'horizon plat; les métriques et le diagramme sont recalculés. Elle transforme ces états visibles/invisibles en pourcentages, durées et score.
4. Les résultats sont affichés sous forme de métriques, d'un verdict descriptif prudent, d'un diagramme polaire du ciel, d'une chronologie et, dans l'onglet Compare, d'un tableau classé et d'un graphique. Si le classement mélange des profils LOLA et des horizons plats, un avertissement précise que les scores ne sont pas directement comparables.

### Algorithmes et indicateurs

- **Visibilité** : l'azimut est arrondi au degré le plus proche pour choisir l'une des 360 directions de l'horizon. Un astre est visible si son élévation est strictement supérieure à celle de l'horizon dans cette direction. Sans profil de terrain valide, l'horizon vaut 0° partout; cette hypothèse rend généralement la visibilité solaire optimiste.
- **Pourcentage visible** : nombre d'échantillons où l'astre est visible divisé par le nombre d'échantillons horaires appariés de la période, multiplié par 100.
- **Nuit la plus longue** : plus longue suite consécutive d'échantillons où le Soleil n'est pas visible. **Perte de communication la plus longue** : même calcul lorsque la Terre n'est pas visible. **Blackout le plus long** : suite où ni le Soleil ni la Terre ne sont visibles. La durée est obtenue en multipliant le nombre d'échantillons consécutifs par leur espacement horaire.
- **Prochaine disparition** : depuis l'heure sélectionnée, l'application cherche le premier passage d'un état visible à un état invisible et indique le temps correspondant. Si aucun passage n'existe dans la période, elle le précise.
- **Score** : `poids Soleil × % Soleil visible + poids Terre × % Terre visible`. Le curseur règle le poids du Soleil de 0 à 100 %; celui de la Terre complète toujours à 100 %. Les valeurs initiales sont 60 % et 40 %. Ce score est un choix de planification, pas une mesure scientifique validée.
- **Comparaison** : le même calcul est exécuté pour chaque site sélectionné sur la même période; le classement est décroissant selon le score.
- **Diagramme polaire** : l'azimut donne la direction (Nord en haut, Est à droite) et l'élévation donne la distance au centre. Le réglage de zoom montre soit les 0–10° au-dessus de l'horizon, soit une plage plus large. Les trajectoires visibles du Soleil (trait doré continu) et de la Terre (trait bleu discontinu), le profil d'horizon et les positions à l'heure sélectionnée sont distingués dans la légende. La chronologie code les états « Soleil + Terre », « un seul visible » et « aucun visible ».

Les métriques disposent d'infobulles accessibles au survol et au focus clavier. Le bouton « How to read this » explique le diagramme polaire en trois phrases. Les onglets se parcourent avec les flèches gauche/droite et les touches Début/Fin; l'écran d'accueil et les infobulles respectent le réglage de réduction des animations. La page About explique aussi pourquoi le pôle Sud lunaire pose des contraintes d'éclairage et de communication.

Les durées sont calculées sur des échantillons horaires, et non sur une interpolation continue. Une période d'invisibilité qui commence ou finit au bord de la plage de dates est affichée avec `≥`, car sa durée complète peut se trouver en dehors de la période observée.

### Données de terrain et limites scientifiques

Les directions et élévations du Soleil et de la Terre proviennent de NASA JPL Horizons (DE440/DE441), avec un observateur sur la Lune, des coordonnées géodésiques, une atmosphère désactivée (« airless »), l'échelle UT et un pas d'une heure. Le jeu fourni couvre du 15 novembre 2026 au 15 février 2027. Le script de génération interroge Horizons; l'application web n'effectue pas ces requêtes.

Le script `scripts/generate_horizon.js` lit le GeoTIFF LOLA et écrit `data/horizon.json`. Le fichier fourni couvre Shackleton et le point représentatif Artemis; Malapert, Haworth et Nobile sont hors de la couverture de ce sous-ensemble. Les profils disponibles sont calculés sur 3 km, avec un pas de 25 m, pour 360 azimuts. Ces paramètres sont configurables. Le script lit les rangées du GeoTIFF à la demande; il ne charge pas le DEM complet en mémoire. Un profil est marqué indisponible si un échantillon requis sort de la couverture, contient NoData, ou si une direction n'a aucun échantillon. L'application conserve alors l'horizon plat et l'indique dans la bannière.

Le script lit le GeoTIFF en coordonnées géographiques longitude/latitude (degrés), d'après ses GeoKeys. Il n'interprète pas les degrés comme des mètres et calcule les distances sur une sphère de rayon 1 737 400 m. La courbure est prise en compte dans l'angle apparent du relief; les centres des pixels les plus proches sont échantillonnés le long de rayons géodésiques. Le nom de fichier contenant `EQ` ne suffit pas à établir une projection équirectangulaire; les GeoKeys inspectés décrivent un CRS géographique lunaire. L'horizon tangent local à 0° est conservé comme minimum, pour que le relief en contrebas ne rende pas visibles des astres sous l'horizon lunaire. Ce n'est pas un ray-tracing continu et les obstacles plus petits que le pas d'échantillonnage peuvent être manqués. Les altitudes sont supposées en mètres pour le calcul, mais cette unité n'est ni encodée par le GeoTIFF ni confirmée indépendamment; toute métrique terrain reste conditionnelle à cette hypothèse. L'altitude `0 km` des éphémérides Horizons ne correspond pas nécessairement à l'altitude du pixel LOLA utilisé comme observateur.

Le fichier fourni provient de la couche Moon Trek **« LRO LOLA DEM 87.5 deg v4, S Pole »**. La date de téléchargement et la boîte de sélection/export du sous-ensemble ne sont pas consignées; il n'est donc pas possible de revendiquer une reproduction exacte de la découpe d'origine. Le nom `5mp` ne constitue pas à lui seul une confirmation de résolution au sol de 5 m : la résolution observée dans les coordonnées géographiques varie avec la latitude. L'application n'affiche donc pas une précision « LOLA 5 m ».

Pour retrouver le GeoTIFF, ouvrir [NASA Moon Trek](https://trek.nasa.gov/moon/), sélectionner la couche exacte indiquée ci-dessus, puis exporter/télécharger une zone couvrant les profils des points Shackleton et Artemis, avec leurs environs jusqu'à 3 km. Enregistrer le fichier sous `data_raw/LRO_LOLA_DEM_SPole875_5mp_v04_EQ-subsetted.tif` pour utiliser les commandes ci-dessous. La boîte d'origine n'étant pas connue, une nouvelle découpe peut ne pas produire les mêmes profils. `data_raw/` et les fichiers `*.tif` sont ignorés par Git; si un TIFF a déjà été suivi dans un dépôt Git, l'ignorer ne le retire pas de l'index : depuis la racine du vrai dépôt, `git rm --cached -- "data_raw/LRO_LOLA_DEM_SPole875_5mp_v04_EQ-subsetted.tif"` le retire du suivi sans supprimer sa copie locale. Le site statique n'a pas besoin du TIFF à l'exécution : il charge `data/horizon.json`, qui contient les profils déjà générés.

Les points sont représentatifs, pas des sites d'atterrissage officiels. Les coordonnées de certaines régions candidates sont approximatives. Le Soleil est considéré comme un point, et un pas horaire peut manquer des événements plus courts qu'une heure. Le modèle ne fournit ni prédiction complète de puissance, ni visibilité radio certifiée, ni faisabilité d'atterrissage. Les résultats sont un outil de comparaison préliminaire seulement.

L'onglet Validation compare certains échantillons arrondis aux valeurs de référence JPL Horizons et affiche un contexte de littérature distinct. La valeur de Gläser et al. (2018) concerne une crête et un modèle de terrain/atterrisseur différents : elle n'est pas une comparaison numérique équivalente. Le contrôle de positions célestes ne valide pas un modèle de terrain.

## Rôle des fichiers

| Fichier | Rôle |
|---|---|
| `README.md` | Documentation du projet : présentation, méthode, algorithmes, limites, sources et instructions d'exécution. |
| `index.html` | Structure et contenu de l'interface : onglets, formulaires, indicateurs, tableaux et éléments Canvas. Charge `style.css` et `app.js`. |
| `style.css` | Mise en forme, thème sombre, disposition adaptative, états visuels et règles d'accessibilité. |
| `app.js` | Logique navigateur : chargement et contrôle des données, calculs de visibilité et de score, bascule de modèle terrain, gestion des interactions, comparaison, validation et dessin des graphiques. |
| `data/sites.json` | Catalogue des points étudiés : identifiant, nom, longitude Est-positive, latitude, altitude simplifiée et notes sur les coordonnées. |
| `data/ephemeris.json` | Éphémérides horaires du Soleil et de la Terre par site, calculées par Horizons et consommées par l'application. |
| `data/horizon.json` | Profils d'horizon LOLA par site, avec statut explicite et paramètres de calcul; les sites indisponibles n'utilisent pas de profil fictif. |
| `data/validation.json` | Échantillons de contrôle JPL Horizons et, éventuellement, lignes de contexte scientifique publiées. |
| `scripts/fetch_horizons.js` | Script Node.js qui lit les sites, interroge l'API JPL Horizons pour le Soleil et la Terre, analyse les réponses, puis écrit les nouvelles éphémérides et conserve une sauvegarde. |
| `scripts/generate_horizon.js` | Générateur Node.js des profils LOLA; vérifie la projection et la couverture, traite NoData et prend en compte la courbure lunaire. |
| `scripts/generate_horizon.test.js` | Tests du DEM, de la couverture, des profils, des NoData, de la géométrie et du repli navigateur. |
| `scripts/inspect_tif.mjs` | Inspection du GeoTIFF par lecture de rangées : géométrie, GeoKeys, NoData et plage des altitudes. |

`data/horizon.json` est chargé comme un fichier statique, sans serveur Node.js en production; il est compatible avec GitHub Pages. L'application accepte le nouveau format `metadata` / `sites` ainsi que l'ancien format en tableaux indexés par identifiant de site. Un profil absent, invalide ou marqué indisponible entraîne l'utilisation de l'horizon plat et l'affichage de « Flat Horizon Approximation – Terrain data unavailable ».

Si les fichiers de sites ou d'éphémérides sont indisponibles, l'application dispose de données illustratives de secours. Elles servent uniquement à montrer l'interface et ne doivent pas être utilisées pour tirer des conclusions scientifiques ou de mission. La validation est elle aussi facultative.

Le script d'éphémérides crée également `data/ephemeris.backup.json` comme fichier de sauvegarde; ce fichier est ignoré par Git.

## Lancer l'application

Depuis la racine du projet, servir les fichiers via un serveur HTTP statique. Avec VS Code, installer/activer **Live Server**, puis ouvrir la racine `index.html` avec « Open with Live Server ». Le même ensemble de fichiers peut être publié sur GitHub Pages.

## Régénérer les éphémérides

Prérequis : Node.js 18 ou une version ultérieure et une connexion à l'API NASA JPL Horizons.

Depuis la racine du projet :

```text
node scripts/fetch_horizons.js
```

Le script lit `data/sites.json`, effectue une requête pour le Soleil et une pour la Terre à chaque site, limite le rythme des requêtes, réessaie certaines erreurs temporaires, et écrit `data/ephemeris.json`. Les sites dont l'une des requêtes échoue sont signalés; les autres sites terminés peuvent être enregistrés. Vérifier les messages d'échec, la plage et le pas des dates ainsi que la plausibilité des résultats avant d'utiliser les nouvelles données. Toute coordonnée approximative doit être vérifiée et remplacée par une coordonnée approuvée avant un usage opérationnel.

## Générer et tester les profils LOLA

Pour régénérer les profils, le DEM source doit se trouver dans `data_raw/LRO_LOLA_DEM_SPole875_5mp_v04_EQ-subsetted.tif` (voir ci-dessus pour le retrouver; il n'est pas inclus dans le dépôt). Depuis la racine du projet :

```text
node scripts/inspect_tif.mjs
node scripts/generate_horizon.js
npm test
```

Le rayon par défaut est de 3 000 m et le pas d'échantillonnage de 25 m. Pour les modifier :

```text
node scripts/generate_horizon.js --max-distance-m 3000 --sample-step-m 25
```

Une distance trop grande peut dépasser la couverture du DEM, notamment près du pôle; les sites concernés seront explicitement marqués indisponibles. L'application web n'a besoin que de `data/horizon.json`, pas du GeoTIFF de 520 Mo.

## Sources

- Éphémérides : [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- Données et documentation LOLA : [NASA PDS Geosciences Node](https://pds-geosciences.wustl.edu/missions/lro/lola.htm)
- Contexte de nomenclature lunaire : [IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/)
- Contexte d'éclairage : [Gläser et al. (2018), *Illumination Conditions at the Lunar Poles: Implications for Future Exploration*](https://ntrs.nasa.gov/citations/20170007365)

Le projet n'intègre pas Moon Trek ou LROC Quickmap ni d'images cartographiques de la NASA.
