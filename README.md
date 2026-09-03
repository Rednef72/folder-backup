# Folder Backup

**Author / Auteur:** Aurélien Chevreux
**Publisher:** rednef

Folder Backup adds two commands to the context menu of folders in the VS Code Explorer.

## Features

- **Folder Backup: Back up this folder now** creates a complete timestamped copy of the selected folder.
- **Folder Backup: Back up & compress this folder now** creates a timestamped ZIP archive.
- The backup is created next to the source folder.
- Progress and completion notifications are displayed.
- The completed backup can be revealed in the system file explorer.
- English and French interfaces are included.
- The standard copy uses the VS Code file-system API and can therefore work with supported remote file systems.

Example:

```text
MyScripts/
MyScripts.backup-20260724-103000/
MyScripts.backup-20260724-103015.zip
```

## Installation

1. Open the **Extensions** view in VS Code.
2. Open the `...` menu.
3. Select **Install from VSIX...**.
4. Select `folder-backup-rednef-1.0.1.vsix`.
5. Reload VS Code if requested.

## ZIP limits

The integrated ZIP writer uses the standard ZIP format without Zip64. It supports up to 65,535 entries and does not support an individual file or final archive larger than 4 GB.

---

# Folder Backup — Français

Folder Backup ajoute deux commandes dans le menu contextuel des dossiers de l’explorateur VS Code.

## Fonctionnalités

- **Folder Backup : Sauvegarder ce dossier maintenant** crée une copie complète et horodatée du dossier sélectionné.
- **Folder Backup : Sauvegarder et compresser ce dossier maintenant** crée une archive ZIP horodatée.
- La sauvegarde est créée à côté du dossier source.
- Une notification de progression et une notification de fin sont affichées.
- La sauvegarde terminée peut être ouverte dans l’explorateur système.
- Les interfaces française et anglaise sont incluses.
- La copie standard utilise l’API de système de fichiers de VS Code et peut donc fonctionner avec les systèmes de fichiers distants compatibles.

## Installation

1. Ouvrir la vue **Extensions** dans VS Code.
2. Ouvrir le menu `...`.
3. Choisir **Installer à partir d’un fichier VSIX...**.
4. Sélectionner `folder-backup-rednef-1.0.1.vsix`.
5. Recharger VS Code si demandé.

## Limites ZIP

Le générateur ZIP intégré utilise le format ZIP standard sans Zip64. Il accepte jusqu’à 65 535 éléments et ne prend pas en charge un fichier individuel ou une archive finale de plus de 4 Go.
