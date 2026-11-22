const { execFile, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const IO_CHUNK_SIZE = 64 * 1024;
const STREAM_STORE_THRESHOLD = 16 * 1024 * 1024; // 16 MB: evita picos de RAM en deflate síncrono

/**
 * Calcula CRC32 usando aceleración nativa Node (zlib.crc32) con respaldo incremental puro JS.
 */
function crc32Update(buf, previousCrc = 0) {
    if (typeof zlib.crc32 === 'function') {
        return zlib.crc32(buf, previousCrc >>> 0) >>> 0;
    }
    let crc = (previousCrc ^ -1);
    for (let i = 0; i < buf.length; i++) {
        crc = crc ^ buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (-(crc & 1) & 0xEDB88320);
        }
    }
    return (crc ^ -1) >>> 0;
}

function crc32(buf) {
    return crc32Update(buf, 0);
}

function computeFileStatsIncremental(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const chunk = Buffer.allocUnsafe(IO_CHUNK_SIZE);
        let crc = 0;
        let totalSize = 0;
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(fd, chunk, 0, IO_CHUNK_SIZE, null)) > 0) {
            const slice = chunk.subarray(0, bytesRead);
            crc = crc32Update(slice, crc);
            totalSize += bytesRead;
        }
        return { crc: crc >>> 0, totalSize };
    } finally {
        try { fs.closeSync(fd); } catch (_closeErr) { /* noop */ }
    }
}

/**
 * Recursively collects file paths for ZIP creation
 */
function collectFilesRecursively(targetDir, baseRelName = '') {
    let files = [];
    if (!fs.existsSync(targetDir)) return files;
    const items = fs.readdirSync(targetDir);
    for (const item of items) {
        const fullPath = path.join(targetDir, item);
        const relPath = baseRelName ? path.join(baseRelName, item) : item;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            files = files.concat(collectFilesRecursively(fullPath, relPath));
        } else {
            files.push({ relPath, fullPath });
        }
    }
    return files;
}

/**
 * Universal Pure JavaScript ZIP archive generator (Streaming format)
 * Compatible with Windows 7, 8, 10, 11, Linux, macOS without external dependencies.
 */
function createZipArchive(zipPath, fileList) {
    const cdHeaders = [];
    let currentOffset = 0;
    let validFilesCount = 0;

    const outFd = fs.openSync(zipPath, 'w');
    const copyBuffer = Buffer.allocUnsafe(IO_CHUNK_SIZE);

    try {
        for (const item of fileList) {
            if (!fs.existsSync(item.fullPath)) continue;
            const stat = fs.statSync(item.fullPath);
            if (stat.isDirectory()) continue;

            const fileNameBuffer = Buffer.from(item.relPath.replace(/\\/g, '/'), 'utf8');
            const flags = 2048; // Bit 11 set for UTF-8 support
            let crc = 0;
            let uncompressedSize = 0;
            let compressedSize = 0;
            let method = 0;
            let inlinePayload = null;

            try {
                if (stat.size > STREAM_STORE_THRESHOLD) {
                    // Streaming STORE para archivos enormes (>16 MB): RAM máxima 64 KB
                    const stats = computeFileStatsIncremental(item.fullPath);
                    crc = stats.crc;
                    uncompressedSize = stats.totalSize;
                    compressedSize = uncompressedSize;
                    method = 0;
                } else {
                    const fileData = fs.readFileSync(item.fullPath);
                    const compressedData = zlib.deflateRawSync(fileData);
                    const useDeflate = compressedData.length < fileData.length;
                    inlinePayload = useDeflate ? compressedData : fileData;
                    method = useDeflate ? 8 : 0;
                    crc = crc32(fileData);
                    uncompressedSize = fileData.length;
                    compressedSize = inlinePayload.length;
                }
            } catch (e) {
                console.error(`[Snapshot System] Warning: Skipping locked file ${item.fullPath}: ${e.message}`);
                continue;
            }

            // Local File Header
            const lfh = Buffer.alloc(30 + fileNameBuffer.length);
            lfh.writeUInt32LE(0x04034b50, 0);
            lfh.writeUInt16LE(20, 4);
            lfh.writeUInt16LE(flags, 6);
            lfh.writeUInt16LE(method, 8);
            lfh.writeUInt16LE(0, 10);
            lfh.writeUInt16LE(0, 12);
            lfh.writeUInt32LE(crc, 14);
            lfh.writeUInt32LE(compressedSize, 18);
            lfh.writeUInt32LE(uncompressedSize, 22);
            lfh.writeUInt16LE(fileNameBuffer.length, 26);
            lfh.writeUInt16LE(0, 28);
            fileNameBuffer.copy(lfh, 30);

            fs.writeSync(outFd, lfh);
            if (inlinePayload) {
                fs.writeSync(outFd, inlinePayload);
            } else {
                const inFd = fs.openSync(item.fullPath, 'r');
                try {
                    let bytesRead = 0;
                    while ((bytesRead = fs.readSync(inFd, copyBuffer, 0, IO_CHUNK_SIZE, null)) > 0) {
                        fs.writeSync(outFd, copyBuffer, 0, bytesRead);
                    }
                } finally {
                    try { fs.closeSync(inFd); } catch (_closeInErr) { /* noop */ }
                }
            }

            // Central Directory Header
            const cdh = Buffer.alloc(46 + fileNameBuffer.length);
            cdh.writeUInt32LE(0x02014b50, 0);
            cdh.writeUInt16LE(20, 4);
            cdh.writeUInt16LE(20, 6);
            cdh.writeUInt16LE(flags, 8);
            cdh.writeUInt16LE(method, 10);
            cdh.writeUInt16LE(0, 12);
            cdh.writeUInt16LE(0, 14);
            cdh.writeUInt32LE(crc, 16);
            cdh.writeUInt32LE(compressedSize, 20);
            cdh.writeUInt32LE(uncompressedSize, 24);
            cdh.writeUInt16LE(fileNameBuffer.length, 28);
            cdh.writeUInt16LE(0, 30);
            cdh.writeUInt16LE(0, 32);
            cdh.writeUInt16LE(0, 34);
            cdh.writeUInt16LE(0, 36);
            cdh.writeUInt32LE(0, 38);
            cdh.writeUInt32LE(currentOffset, 42);
            fileNameBuffer.copy(cdh, 46);

            cdHeaders.push(cdh);
            currentOffset += lfh.length + compressedSize;
            validFilesCount++;
        }

        const cdOffset = currentOffset;
        let cdSize = 0;
        for (const cdh of cdHeaders) {
            fs.writeSync(outFd, cdh);
            cdSize += cdh.length;
        }

        // End of Central Directory Record
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(0, 4);
        eocd.writeUInt16LE(0, 6);
        eocd.writeUInt16LE(validFilesCount, 8);
        eocd.writeUInt16LE(validFilesCount, 10);
        eocd.writeUInt32LE(cdSize, 12);
        eocd.writeUInt32LE(cdOffset, 16);
        eocd.writeUInt16LE(0, 20);

        fs.writeSync(outFd, eocd);
    } finally {
        try {
            fs.closeSync(outFd);
        } catch (_closeErr) {
            // Ignore file descriptor already closed
        }
    }
}

/**
 * Universal Pure JavaScript ZIP Extractor (Central Directory Parser via File Descriptor)
 * Lee EOCD, Central Directory y cada entrada por desplazamiento sin cargar el archivo ZIP entero en RAM.
 */
function extractZipArchive(zipPath, targetDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const stat = fs.statSync(zipPath);
    if (stat.size < 22) return;

    const resolvedTargetDir = path.resolve(targetDir);
    const inFd = fs.openSync(zipPath, 'r');

    try {
        const tailLen = Math.min(stat.size, 65557);
        const tailOffset = stat.size - tailLen;
        const tailBuf = Buffer.allocUnsafe(tailLen);
        fs.readSync(inFd, tailBuf, 0, tailLen, tailOffset);

        let eocdPos = -1;
        for (let i = tailLen - 22; i >= 0; i--) {
            if (tailBuf.readUInt32LE(i) === 0x06054b50) {
                eocdPos = i;
                break;
            }
        }

        if (eocdPos === -1) {
            throw new Error('Formato ZIP inválido: No se encontró la cabecera EOCD.');
        }

        const totalRecords = tailBuf.readUInt16LE(eocdPos + 10);
        const cdSize = tailBuf.readUInt32LE(eocdPos + 12);
        const cdOffset = tailBuf.readUInt32LE(eocdPos + 16);
        const cdBufferLen = Math.min(cdSize || (stat.size - cdOffset), stat.size - cdOffset);
        if (cdOffset + cdBufferLen > stat.size) {
            throw new Error('Formato ZIP inválido: Central Directory fuera de rango.');
        }

        const cdBuffer = Buffer.allocUnsafe(cdBufferLen);
        fs.readSync(inFd, cdBuffer, 0, cdBufferLen, cdOffset);

        const lfhHeader = Buffer.allocUnsafe(30);
        const streamChunk = Buffer.allocUnsafe(IO_CHUNK_SIZE);

        let currentCd = 0;
        for (let i = 0; i < totalRecords; i++) {
            if (currentCd + 46 > cdBuffer.length) break;
            const sig = cdBuffer.readUInt32LE(currentCd);
            if (sig !== 0x02014b50) break;

            const flags = cdBuffer.readUInt16LE(currentCd + 8);
            const method = cdBuffer.readUInt16LE(currentCd + 10);
            const compressedSize = cdBuffer.readUInt32LE(currentCd + 20);
            const fileNameLen = cdBuffer.readUInt16LE(currentCd + 28);
            const extraLen = cdBuffer.readUInt16LE(currentCd + 30);
            const commentLen = cdBuffer.readUInt16LE(currentCd + 32);
            const localHeaderOffset = cdBuffer.readUInt32LE(currentCd + 42);

            const isUtf8 = (flags & 2048) !== 0;
            const fileName = cdBuffer.toString(isUtf8 ? 'utf8' : 'latin1', currentCd + 46, currentCd + 46 + fileNameLen);

            currentCd += 46 + fileNameLen + extraLen + commentLen;

            if (!fileName || fileName.endsWith('/') || fileName.endsWith('\\')) continue;
            if (localHeaderOffset + 30 > stat.size) continue;

            fs.readSync(inFd, lfhHeader, 0, 30, localHeaderOffset);
            const localSig = lfhHeader.readUInt32LE(0);
            if (localSig !== 0x04034b50) continue;

            const localNameLen = lfhHeader.readUInt16LE(26);
            const localExtraLen = lfhHeader.readUInt16LE(28);
            const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
            if (dataOffset + compressedSize > stat.size) continue;

            const normalizedRel = fileName.replace(/\//g, path.sep);
            const destPath = path.resolve(targetDir, normalizedRel);

            // Blindaje contra ataques de Zip-Slip (salto de directorio)
            if (!destPath.startsWith(resolvedTargetDir + path.sep) && destPath !== resolvedTargetDir) {
                console.warn(`[Snapshot System] ⚠️ Zip Slip attempt blocked for entry: ${fileName}`);
                continue;
            }

            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            if (method === 0) {
                const MAX_ENTRY_BYTES = 250 * 1024 * 1024;
                if (compressedSize > MAX_ENTRY_BYTES) {
                    throw new Error(`Entrada ZIP excede el límite seguro de tamaño (${fileName}).`);
                }
                const outFd = fs.openSync(destPath, 'w');
                try {
                    let remaining = compressedSize;
                    let readPos = dataOffset;
                    while (remaining > 0) {
                        const toRead = Math.min(IO_CHUNK_SIZE, remaining);
                        const bytesRead = fs.readSync(inFd, streamChunk, 0, toRead, readPos);
                        if (bytesRead <= 0) break;
                        fs.writeSync(outFd, streamChunk, 0, bytesRead);
                        readPos += bytesRead;
                        remaining -= bytesRead;
                    }
                } finally {
                    try { fs.closeSync(outFd); } catch (_closeOutErr) { /* noop */ }
                }
            } else if (method === 8) {
                const MAX_ENTRY_BYTES = 250 * 1024 * 1024;
                if (compressedSize > MAX_ENTRY_BYTES) {
                    throw new Error(`Entrada ZIP comprimida excede el límite seguro (${fileName}).`);
                }
                const compressedData = Buffer.allocUnsafe(compressedSize);
                if (compressedSize > 0) {
                    fs.readSync(inFd, compressedData, 0, compressedSize, dataOffset);
                }
                const inflateOpts = { maxOutputLength: MAX_ENTRY_BYTES };
                let uncompressedData;
                try {
                    uncompressedData = zlib.inflateRawSync(compressedData, inflateOpts);
                } catch (_e1) {
                    try {
                        uncompressedData = zlib.unzipSync(compressedData, inflateOpts);
                    } catch (_e2) {
                        uncompressedData = zlib.inflateSync(compressedData, inflateOpts);
                    }
                }
                if (uncompressedData) {
                    fs.writeFileSync(destPath, uncompressedData);
                }
            }
        }
    } finally {
        try { fs.closeSync(inFd); } catch (_closeInErr) { /* noop */ }
    }
}

/**
 * Crea una Instantánea Maestra (.zip) de PostgreSQL que empaqueta el volcado (.sql / .json)
 * junto con product_images, supplier_logos e invoices.
 *
 * @param {string} userDataPath Ruta de UserData.
 * @returns {Promise<string>} Ruta del archivo ZIP generado.
 */
async function createMasterSnapshot(userDataPath) {
    if (!userDataPath) {
        userDataPath = process.env.USER_DATA_PATH || process.cwd();
    }

    const backupDir = path.join(userDataPath, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFileName = `master_snapshot_${timestamp}.zip`;
    const zipPath = path.join(backupDir, zipFileName);

    const logMsg = (msg) => {
        console.log(`[Snapshot System] ${msg}`);
    };

    logMsg(`Iniciando Instantánea Maestra PostgreSQL en ${backupDir}`);

    // Generar volcado PostgreSQL (.sql o .json) usando el motor unificado de respaldo
    const { performPostgresBackup } = require('./sqliteBackupHelper');
    const generatedDbDump = await performPostgresBackup(userDataPath);
    let tempDumpInUserData = null;

    if (generatedDbDump && fs.existsSync(generatedDbDump)) {
        const dumpExt = path.extname(generatedDbDump) || '.sql';
        tempDumpInUserData = path.join(userDataPath, `db_dump_${timestamp}${dumpExt}`);
        fs.copyFileSync(generatedDbDump, tempDumpInUserData);
    }

    const cleanupTempAndRotate = () => {
        if (tempDumpInUserData && fs.existsSync(tempDumpInUserData)) {
            try {
                fs.unlinkSync(tempDumpInUserData);
            } catch (_unlinkErr) {
                // Ignore temp cleanup error
            }
        }
        try {
            const allSnapshots = fs.readdirSync(backupDir)
                .filter(f => (f.startsWith('master_snapshot_') || f.startsWith('backup_')) && (f.endsWith('.zip') || f.endsWith('.sql') || f.endsWith('.json') || f.endsWith('.enc')))
                .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
                .sort((a, b) => b.time - a.time);

            if (allSnapshots.length > 10) {
                allSnapshots.slice(10).forEach(f => {
                    try {
                        fs.unlinkSync(path.join(backupDir, f.name));
                    } catch (_rotErr) {
                        // Ignore locked file during rotation
                    }
                });
            }
        } catch (_dirErr) {
            // Ignore rotation directory scan error
        }
    };

    let hasTar = false;
    try {
        execSync('tar --version', { stdio: 'ignore' });
        hasTar = true;
    } catch (_tarErr) {
        hasTar = false;
    }

    const buildWithPureJsZip = () => {
        const fileList = [];
        if (tempDumpInUserData && fs.existsSync(tempDumpInUserData)) {
            fileList.push({ relPath: path.basename(tempDumpInUserData), fullPath: tempDumpInUserData });
        }

        for (const dirName of ['product_images', 'supplier_logos', 'invoices']) {
            const fullDir = path.join(userDataPath, dirName);
            if (fs.existsSync(fullDir)) {
                fileList.push(...collectFilesRecursively(fullDir, dirName));
            }
        }

        for (const fileName of ['settings.json', 'payment_methods.json']) {
            const fullFile = path.join(userDataPath, fileName);
            if (fs.existsSync(fullFile)) {
                fileList.push({ relPath: fileName, fullPath: fullFile });
            }
        }

        if (fileList.length === 0) {
            cleanupTempAndRotate();
            throw new Error('No se pudo generar el volcado de PostgreSQL ni existen carpetas multimedia para respaldar.');
        }

        createZipArchive(zipPath, fileList);
        cleanupTempAndRotate();

        try {
            const cloudMirrorService = require('../services/CloudMirrorService');
            cloudMirrorService.mirrorBackupFile(zipPath);
        } catch (mirrorErr) {
            logMsg(`Cloud mirror notice: ${mirrorErr.message}`);
        }

        logMsg(`Instantánea Maestra (PureJS) completada: ${zipPath}`);
        return zipPath;
    };

    if (hasTar) {
        const tarArgs = ['-ac', '-f', path.join('backups', zipFileName)];
        if (tempDumpInUserData && fs.existsSync(tempDumpInUserData)) {
            tarArgs.push(path.basename(tempDumpInUserData));
        }
        for (const dirName of ['product_images', 'supplier_logos', 'invoices']) {
            if (fs.existsSync(path.join(userDataPath, dirName))) {
                tarArgs.push(dirName);
            }
        }
        for (const fileName of ['settings.json', 'payment_methods.json']) {
            if (fs.existsSync(path.join(userDataPath, fileName))) {
                tarArgs.push(fileName);
            }
        }

        if (tarArgs.length > 3) {
            const tarSucceeded = await new Promise((resolve) => {
                execFile('tar', tarArgs, { cwd: userDataPath }, (zipError) => {
                    resolve(!zipError && fs.existsSync(zipPath));
                });
            });

            if (tarSucceeded) {
                cleanupTempAndRotate();
                try {
                    const cloudMirrorService = require('../services/CloudMirrorService');
                    cloudMirrorService.mirrorBackupFile(zipPath);
                } catch (mirrorErr) {
                    logMsg(`Cloud mirror notice: ${mirrorErr.message}`);
                }
                logMsg(`Instantánea Maestra (tar) completada: ${zipPath}`);
                return zipPath;
            }
        }
    }

    return buildWithPureJsZip();
}

module.exports = {
    createMasterSnapshot,
    extractZipArchive,
    createZipArchive,
    collectFilesRecursively
};
