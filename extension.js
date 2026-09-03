'use strict';

const vscode = require('vscode');
const { createZipFromFolder } = require('./zip');

/**
 * Returns a timestamp formatted as YYYYMMDD-HHMMSS.
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

/**
 * Checks whether a resource exists.
 * @param {vscode.Uri} uri
 * @returns {Promise<boolean>}
 */
async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Gets the display name of a selected resource.
 * @param {vscode.Uri} resourceUri
 * @returns {string}
 */
function getResourceName(resourceUri) {
  return resourceUri.path.split('/').filter(Boolean).pop() || resourceUri.fsPath;
}

/**
 * Creates an available destination next to the source folder.
 * @param {vscode.Uri} sourceUri
 * @param {{extension?: string}} options
 * @returns {Promise<vscode.Uri>}
 */
async function createDestinationUri(sourceUri, options = {}) {
  const timestamp = formatTimestamp(new Date());
  const parentUri = vscode.Uri.joinPath(sourceUri, '..');
  const baseName = getResourceName(sourceUri) || 'folder';
  const extension = options.extension || '';
  const initialName = `${baseName}.backup-${timestamp}${extension}`;

  let candidate = vscode.Uri.joinPath(parentUri, initialName);
  let index = 2;

  while (await exists(candidate)) {
    candidate = vscode.Uri.joinPath(
      parentUri,
      `${baseName}.backup-${timestamp}-${index}${extension}`
    );
    index += 1;
  }

  return candidate;
}

/**
 * Validates the resource supplied by the Explorer context menu.
 * @param {unknown} resourceUri
 * @returns {Promise<vscode.Uri|null>}
 */
async function validateFolder(resourceUri) {
  if (!(resourceUri instanceof vscode.Uri)) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Folder Backup: select a folder in the VS Code Explorer.')
    );
    return null;
  }

  const stat = await vscode.workspace.fs.stat(resourceUri);
  if ((stat.type & vscode.FileType.Directory) === 0) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Folder Backup: the selected resource is not a folder.')
    );
    return null;
  }

  return resourceUri;
}

/**
 * Offers to reveal a completed backup in the system explorer.
 * @param {vscode.Uri} destinationUri
 * @param {string} message
 */
async function showCompletedBackup(destinationUri, message) {
  const revealLabel = vscode.l10n.t('Show in system explorer');
  const action = await vscode.window.showInformationMessage(
    message,
    revealLabel
  );

  if (action === revealLabel) {
    await vscode.commands.executeCommand('revealFileInOS', destinationUri);
  }
}

/**
 * Creates a full folder copy.
 * @param {vscode.Uri} resourceUri
 */
async function backupFolder(resourceUri) {
  const sourceUri = await validateFolder(resourceUri);
  if (!sourceUri) {
    return;
  }

  const destinationUri = await createDestinationUri(sourceUri);
  const sourceName = getResourceName(sourceUri);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Backing up “{0}”', sourceName),
      cancellable: false
    },
    async (progress) => {
      progress.report({
        message: vscode.l10n.t('Copying the folder and its contents…')
      });
      await vscode.workspace.fs.copy(sourceUri, destinationUri, { overwrite: false });
    }
  );

  await showCompletedBackup(
    destinationUri,
    vscode.l10n.t('Backup completed: {0}', destinationUri.fsPath)
  );
}

/**
 * Creates a timestamped ZIP backup next to the selected folder.
 * @param {vscode.Uri} resourceUri
 */
async function backupAndCompressFolder(resourceUri) {
  const sourceUri = await validateFolder(resourceUri);
  if (!sourceUri) {
    return;
  }

  const destinationUri = await createDestinationUri(sourceUri, { extension: '.zip' });
  const sourceName = getResourceName(sourceUri);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Backing up and compressing “{0}”', sourceName),
      cancellable: false
    },
    async (progress) => {
      await createZipFromFolder(
        sourceUri.fsPath,
        destinationUri.fsPath,
        ({ processed, total, archivePath }) => {
          progress.report({
            message: vscode.l10n.t(
              'Compressing {0} of {1}: {2}',
              processed,
              total,
              archivePath
            )
          });
        }
      );
    }
  );

  await showCompletedBackup(
    destinationUri,
    vscode.l10n.t('Compressed backup completed: {0}', destinationUri.fsPath)
  );
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const backupDisposable = vscode.commands.registerCommand(
    'folderBackup.backupFolder',
    async (resourceUri) => {
      try {
        await backupFolder(resourceUri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          vscode.l10n.t('Folder Backup: backup failed. {0}', message)
        );
      }
    }
  );

  const compressDisposable = vscode.commands.registerCommand(
    'folderBackup.backupAndCompressFolder',
    async (resourceUri) => {
      try {
        await backupAndCompressFolder(resourceUri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          vscode.l10n.t('Folder Backup: compressed backup failed. {0}', message)
        );
      }
    }
  );

  context.subscriptions.push(backupDisposable, compressDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
