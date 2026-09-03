'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const fsp = fs.promises;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

/**
 * Calculates the CRC-32 checksum used by the ZIP format.
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let crc = 0xffffffff;

  for (const value of buffer) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Converts a JavaScript date to the DOS date and time fields used by ZIP.
 * @param {Date} date
 * @returns {{date: number, time: number}}
 */
function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9)
    | ((date.getMonth() + 1) << 5)
    | date.getDate();
  const dosTime = (date.getHours() << 11)
    | (date.getMinutes() << 5)
    | Math.floor(date.getSeconds() / 2);

  return {
    date: dosDate & MAX_UINT16,
    time: dosTime & MAX_UINT16
  };
}

/**
 * Normalizes a path for use inside a ZIP archive.
 * @param {string} value
 * @returns {string}
 */
function normalizeArchivePath(value) {
  return value.split(path.sep).join('/').replace(/^\/+/, '');
}

/**
 * Recursively enumerates a folder without following symbolic links.
 * @param {string} sourcePath
 * @returns {Promise<Array<{absolutePath: string, archivePath: string, type: 'directory'|'file'|'symlink', stat: import('fs').Stats}>>}
 */
async function collectEntries(sourcePath) {
  const rootName = path.basename(path.resolve(sourcePath));
  const entries = [];

  async function visit(absolutePath, archivePath) {
    const stat = await fsp.lstat(absolutePath);

    if (stat.isSymbolicLink()) {
      entries.push({ absolutePath, archivePath, type: 'symlink', stat });
      return;
    }

    if (stat.isDirectory()) {
      const directoryArchivePath = archivePath.endsWith('/')
        ? archivePath
        : `${archivePath}/`;
      entries.push({
        absolutePath,
        archivePath: directoryArchivePath,
        type: 'directory',
        stat
      });

      const children = await fsp.readdir(absolutePath, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));

      for (const child of children) {
        await visit(
          path.join(absolutePath, child.name),
          normalizeArchivePath(path.join(archivePath, child.name))
        );
      }
      return;
    }

    if (stat.isFile()) {
      entries.push({ absolutePath, archivePath, type: 'file', stat });
    }
  }

  await visit(path.resolve(sourcePath), normalizeArchivePath(rootName));
  return entries;
}

/**
 * Writes an entire buffer to an open file handle.
 * @param {import('fs').promises.FileHandle} fileHandle
 * @param {Buffer} buffer
 * @returns {Promise<void>}
 */
async function writeBuffer(fileHandle, buffer) {
  let written = 0;

  while (written < buffer.length) {
    const result = await fileHandle.write(
      buffer,
      written,
      buffer.length - written,
      null
    );

    if (result.bytesWritten <= 0) {
      throw new Error('Unable to write the ZIP archive.');
    }

    written += result.bytesWritten;
  }
}

/**
 * Ensures that values can be represented by the non-Zip64 format.
 * @param {number} value
 * @param {string} label
 */
function ensureUint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new Error(`${label} exceeds the 4 GB limit of this ZIP implementation.`);
  }
}

/**
 * Creates a ZIP archive containing the selected folder as its top-level entry.
 * Files are processed one at a time to avoid keeping the entire archive in memory.
 *
 * @param {string} sourcePath
 * @param {string} destinationPath
 * @param {(state: {processed: number, total: number, archivePath: string}) => void} [onProgress]
 * @returns {Promise<void>}
 */
async function createZipFromFolder(sourcePath, destinationPath, onProgress) {
  const entries = await collectEntries(sourcePath);

  if (entries.length > MAX_UINT16) {
    throw new Error('The folder contains too many entries for this ZIP implementation.');
  }

  const output = await fsp.open(destinationPath, 'wx');
  const centralEntries = [];
  let offset = 0;
  let completed = false;

  try {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const nameBuffer = Buffer.from(entry.archivePath, 'utf8');
      const { date, time } = toDosDateTime(entry.stat.mtime);
      let originalData = Buffer.alloc(0);

      if (entry.type === 'file') {
        originalData = await fsp.readFile(entry.absolutePath);
      } else if (entry.type === 'symlink') {
        const linkTarget = await fsp.readlink(entry.absolutePath);
        originalData = Buffer.from(linkTarget, 'utf8');
      }

      ensureUint32(originalData.length, `File ${entry.archivePath}`);

      let method = 0;
      let archivedData = originalData;

      if (entry.type !== 'directory' && originalData.length > 0) {
        const compressedData = zlib.deflateRawSync(originalData, { level: 9 });
        if (compressedData.length < originalData.length) {
          method = 8;
          archivedData = compressedData;
        }
      }

      ensureUint32(archivedData.length, `Compressed file ${entry.archivePath}`);
      ensureUint32(offset, 'Archive offset');

      const checksum = crc32(originalData);
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt16LE(time, 10);
      localHeader.writeUInt16LE(date, 12);
      localHeader.writeUInt32LE(checksum, 14);
      localHeader.writeUInt32LE(archivedData.length, 18);
      localHeader.writeUInt32LE(originalData.length, 22);
      localHeader.writeUInt16LE(nameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);

      const localOffset = offset;
      await writeBuffer(output, localHeader);
      await writeBuffer(output, nameBuffer);
      if (archivedData.length > 0) {
        await writeBuffer(output, archivedData);
      }

      offset += localHeader.length + nameBuffer.length + archivedData.length;
      ensureUint32(offset, 'Archive size');

      let mode = entry.stat.mode;
      if (entry.type === 'directory') {
        mode = mode || 0o40755;
      } else if (entry.type === 'symlink') {
        mode = mode || 0o120777;
      } else {
        mode = mode || 0o100644;
      }

      const externalAttributes = (((mode & 0xffff) << 16)
        | (entry.type === 'directory' ? 0x10 : 0)) >>> 0;

      centralEntries.push({
        nameBuffer,
        method,
        time,
        date,
        checksum,
        compressedSize: archivedData.length,
        originalSize: originalData.length,
        localOffset,
        externalAttributes
      });

      if (onProgress) {
        onProgress({
          processed: index + 1,
          total: entries.length,
          archivePath: entry.archivePath
        });
      }
    }

    const centralDirectoryOffset = offset;

    for (const entry of centralEntries) {
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE((3 << 8) | 20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(entry.method, 10);
      centralHeader.writeUInt16LE(entry.time, 12);
      centralHeader.writeUInt16LE(entry.date, 14);
      centralHeader.writeUInt32LE(entry.checksum, 16);
      centralHeader.writeUInt32LE(entry.compressedSize, 20);
      centralHeader.writeUInt32LE(entry.originalSize, 24);
      centralHeader.writeUInt16LE(entry.nameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(entry.externalAttributes, 38);
      centralHeader.writeUInt32LE(entry.localOffset, 42);

      await writeBuffer(output, centralHeader);
      await writeBuffer(output, entry.nameBuffer);
      offset += centralHeader.length + entry.nameBuffer.length;
    }

    const centralDirectorySize = offset - centralDirectoryOffset;
    ensureUint32(centralDirectoryOffset, 'Central directory offset');
    ensureUint32(centralDirectorySize, 'Central directory size');

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(centralEntries.length, 8);
    endRecord.writeUInt16LE(centralEntries.length, 10);
    endRecord.writeUInt32LE(centralDirectorySize, 12);
    endRecord.writeUInt32LE(centralDirectoryOffset, 16);
    endRecord.writeUInt16LE(0, 20);

    await writeBuffer(output, endRecord);
    await output.close();
    completed = true;
  } finally {
    if (!completed) {
      await output.close().catch(() => {});
      await fsp.rm(destinationPath, { force: true }).catch(() => {});
    }
  }
}

module.exports = {
  createZipFromFolder
};
