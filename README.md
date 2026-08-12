# Waklink

Portail de lecture de webtoons (Chroniques du Krosmoz). Site 100 % statique — HTML/CSS/JS, aucune dépendance à installer — prévu pour GitHub Pages.

## Ajouter un webtoon

Il suffit de déposer les images ; rien à écrire dans le code.

```
media/
  wakfu-la-grande-vague/        ← nom de la série  → « Wakfu La Grande Vague »
    tome-1/                     ← nom du tome      → « Tome 1 »
      WakfuGrandeVagueTome1-001.webp   ← 1re image = COUVERTURE
      WakfuGrandeVagueTome1-002.webp
      ...
    tome-2/
      ...
```

Règles appliquées automatiquement :

- le nom du dossier série devient le titre (`wakfu-la-grande-vague` → `Wakfu La Grande Vague`) ;
- le nom du dossier tome devient le libellé (`tome-1` → `Tome 1`), et le titre affiché est `Wakfu La Grande Vague - Tome 1` ;
- **la première image du dossier (ordre naturel : 001, 002, … 010) sert de couverture** ;
- les planches sont ordonnées naturellement, donc `-2.webp` passe avant `-10.webp` ;
- un dossier série contenant directement des images (sans sous-dossier) devient un tome unique « Intégrale » ;
- un tome vide s'affiche en « Prochainement » et n'est pas cliquable ;
- formats acceptés : `.webp`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.avif`.

Puis régénérer le manifest :

```bash
npm run build       # ou : node scripts/build-manifest.mjs
```

### Surcharger un titre (optionnel)

Poser un `info.json` dans un dossier série ou tome :

```json
{
  "title": "Wakfu — La Grande Vague",
  "label": "Tome I",
  "status": "Nouveau",
  "description": "Chapitre 1 · arc du Sadida"
}
```

## Accès (porte d'entrée)

Le portail s'ouvre sur un écran de connexion. Identifiants actuels : **Sayshara** / **Wakfu** (l'identifiant est insensible à la casse et aux espaces, le mot de passe non).

Pour les changer :

```bash
node scripts/set-credentials.mjs <identifiant> <mot-de-passe> ["mention affichée"]
```

Le script réécrit `assets/auth.json` avec un sel aléatoire et la clé dérivée (PBKDF2-SHA256, 310 000 itérations). Le mot de passe n'est jamais stocké, et changer les identifiants invalide les sessions déjà ouvertes. La mention affichée sous le formulaire ne doit pas révéler l'identifiant : le fichier est public.

La session vit dans `sessionStorage`, ou dans `localStorage` si « rester connecté » est coché. `Se déconnecter` la purge.

### ⚠ Ce que cette porte vaut

Un site statique ne peut pas garder un secret. Concrètement :

- n'importe qui peut lire `auth.json` et tenter une attaque par dictionnaire hors ligne — `Wakfu` tomberait vite, les 310 000 itérations ne font que ralentir ;
- la porte peut être sautée depuis la console du navigateur ;
- **les images restent accessibles par leur URL directe** (`…/media/wakfu-la-grande-vague/tome-1/…webp`), et donc indexables. Aucun code côté client ne peut l'empêcher.

C'est donc un filtre dissuasif, pas une protection. Pour un vrai verrou il faut un serveur devant les fichiers : Cloudflare Access (gratuit, à mettre devant un domaine custom), Netlify/Vercel avec protection par mot de passe, ou un dépôt privé servi par un backend.

Web Crypto exige un contexte sécurisé : le site doit être servi en `https` (GitHub Pages l'est) ou depuis `localhost`. En `http://` sur une IP de réseau local, la connexion affichera un message d'erreur explicite.

## Développement local

```bash
npm run start       # génère le manifest puis sert le site sur http://localhost:4173
```

Un simple `python3 -m http.server` à la racine fonctionne aussi. Ouvrir le fichier en `file://` ne marche pas : le `fetch` de `manifest.json` est bloqué par le navigateur.

## Déploiement GitHub Pages

Le workflow `.github/workflows/deploy.yml` régénère `manifest.json` à chaque push sur `main`, puis publie la racine du dépôt. Une seule chose à faire côté GitHub : **Settings → Pages → Source : GitHub Actions**.

Le site fonctionne aussi bien à la racine d'un domaine que sur un sous-chemin (`user.github.io/waklink/`) : tous les chemins sont relatifs.

### Poids des images

GitHub Pages plafonne à **1 Go par site**, **100 Mo par fichier**, et recommande de rester sous ~100 Go de bande passante par mois. `media/` pèse actuellement ~230 Mo. Si la bibliothèque grossit :

- garder du `.webp` (déjà le cas) et viser ≤ 1600 px de large ;
- ou héberger les images ailleurs (R2, S3, CDN) — il suffira alors de préfixer les `src` du manifest.

## Structure

```
index.html                    page unique (connexion + accueil + lecteur)
assets/styles.css             thème « portail », responsive
assets/app.js                 routage #/serie/tome, lecteur vertical, progression
assets/auth.js                porte d'entrée (vérification PBKDF2 côté navigateur)
assets/auth.json              généré — sel + clé dérivée, jamais le mot de passe
scripts/build-manifest.mjs    scan de media/ → manifest.json (dimensions lues sans dépendance)
scripts/set-credentials.mjs   écrit assets/auth.json
manifest.json                 généré — ne pas éditer à la main
```

## Lecteur

- défilement vertical continu, planches chargées par paliers ;
- barre de progression + compteur `page / total` ;
- la barre du haut s'efface à la descente, revient à la montée (tap sur mobile) ;
- clavier : `↓`/`espace` page suivante, `↑` précédente, `Échap` retour bibliothèque ;
- chaque tome a son URL (`#/wakfu-la-grande-vague/tome-1`) : partageable et compatible bouton retour.
