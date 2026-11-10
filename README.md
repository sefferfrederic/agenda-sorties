# Sorties Liège-Luxembourg

Agenda personnel des sorties du jour en provinces de Liège et de Luxembourg, sans publicité.
Catégorie Noël élargie : Allemagne jusqu'à Cologne, France jusqu'à Strasbourg, Grand-Duché, Maastricht.

**Appli :** https://sefferfrederic.github.io/agenda-sorties/ (à ajouter à l'écran d'accueil de l'iPhone : Partager → Sur l'écran d'accueil)

## Fonctionnement

- Chaque nuit vers 4 h, GitHub Actions lance `collector/index.js` : lecture des sources, tri par catégorie,
  géocodage, fusion des doublons, écriture de `public/data/events.json`, puis publication sur GitHub Pages.
- Sources lues : quefaire.be, brocabrac.fr, tasoiree.be, info-lux.com.
- `collector/seed/noel-2026.json` : marchés de Noël de la zone élargie (à mettre à jour chaque automne).
- `collector/seed/recurrents.json` : brocantes et marchés hebdomadaires.
- Relancer à la main : onglet **Actions** → « Collecte et publication » → **Run workflow**.
