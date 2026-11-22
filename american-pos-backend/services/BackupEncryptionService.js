const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Constantes criptográficas para AES-256-GCM
const MAGIC_HEADER = Buffer.from('ISAAC_SEC_BK1'); // 13 bytes
const SALT_LEN = 16;
const IV_LEN = 12; // 96 bits recomendado para GCM
const TAG_LEN = 16; // 128 bits auth tag
const HEADER_LEN = MAGIC_HEADER.length + SALT_LEN + IV_LEN + TAG_LEN;
const CHUNK_SIZE = 64 * 1024; // 64 KB para evitar picos de RAM en backups grandes
const ALGORITHM = 'aes-256-gcm';

class BackupEncryptionService {
    /**
     * Obtiene la clave maestra o usa una provista por el usuario
     */
    _getMasterSecret(customPassword) {
        if (customPassword && typeof customPassword === 'string' && customPassword.trim().length >= 6) {
            return customPassword.trim();
        }
        const secret = process.env.BACKUP_ENCRYPTION_KEY ? String(process.env.BACKUP_ENCRYPTION_KEY).trim() : '';
        if (!secret) {
            throw new Error('BACKUP_ENCRYPTION_KEY debe estar configurado en .env para cifrar o descifrar respaldos (no se permite reutilizar JWT_SECRET).');
        }
        return secret;
    }

    /**
     * Deriva una clave de 256 bits mediante PBKDF2 (100,000 iteraciones SHA-256)
     */
    _deriveKey(secret, salt) {
        return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
    }

    /**
     * Comprueba si un archivo de respaldo está cifrado con AES-256-GCM
     */
    isEncrypted(filePath) {
        try {
            if (!filePath || !fs.existsSync(filePath)) return false;
            const stat = fs.statSync(filePath);
            if (stat.size < MAGIC_HEADER.length + SALT_LEN + IV_LEN + TAG_LEN) return false;

            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(MAGIC_HEADER.length);
            fs.readSync(fd, buffer, 0, MAGIC_HEADER.length, 0);
            fs.closeSync(fd);
            return buffer.equals(MAGIC_HEADER);
        } catch (e) {
            return false;
        }
    }

    /**
     * Cifra un archivo de respaldo usando AES-256-GCM en chunks de 64 KB (sin cargar todo en RAM)
     */
    encryptFile(inputPath, outputPath, customPassword = null) {
        if (!fs.existsSync(inputPath)) {
            throw new Error(`El archivo de origen no existe: ${inputPath}`);
        }

        const secret = this._getMasterSecret(customPassword);
        const salt = crypto.randomBytes(SALT_LEN);
        const iv = crypto.randomBytes(IV_LEN);
        const key = this._deriveKey(secret, salt);

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const tmpOutPath = `${outputPath}.tmp.${process.pid}.${Date.now()}`;

        let inFd = null;
        let outFd = null;
        let originalSize = 0;
        let ciphertextSize = 0;

        try {
            inFd = fs.openSync(inputPath, 'r');
            outFd = fs.openSync(tmpOutPath, 'w');

            // Escribir cabecera con espacio reservado para TAG_LEN usando posición explícita
            const tagPlaceholder = Buffer.alloc(TAG_LEN);
            const initialHeader = Buffer.concat([MAGIC_HEADER, salt, iv, tagPlaceholder]);
            let writePos = 0;
            fs.writeSync(outFd, initialHeader, 0, initialHeader.length, writePos);
            writePos += initialHeader.length;

            const readBuffer = Buffer.allocUnsafe(CHUNK_SIZE);
            let bytesRead = 0;
            let readPos = 0;
            while ((bytesRead = fs.readSync(inFd, readBuffer, 0, CHUNK_SIZE, readPos)) > 0) {
                readPos += bytesRead;
                originalSize += bytesRead;
                const encryptedChunk = cipher.update(readBuffer.subarray(0, bytesRead));
                if (encryptedChunk.length > 0) {
                    fs.writeSync(outFd, encryptedChunk, 0, encryptedChunk.length, writePos);
                    writePos += encryptedChunk.length;
                    ciphertextSize += encryptedChunk.length;
                }
            }

            const finalChunk = cipher.final();
            if (finalChunk.length > 0) {
                fs.writeSync(outFd, finalChunk, 0, finalChunk.length, writePos);
                writePos += finalChunk.length;
                ciphertextSize += finalChunk.length;
            }

            const tag = cipher.getAuthTag();
            const tagOffset = MAGIC_HEADER.length + SALT_LEN + IV_LEN;
            fs.writeSync(outFd, tag, 0, TAG_LEN, tagOffset);

            fs.closeSync(inFd);
            inFd = null;
            fs.closeSync(outFd);
            outFd = null;

            fs.renameSync(tmpOutPath, outputPath);

            return {
                success: true,
                outputPath,
                originalSize,
                encryptedSize: HEADER_LEN + ciphertextSize,
                algorithm: ALGORITHM
            };
        } finally {
            if (inFd !== null) {
                try { fs.closeSync(inFd); } catch (_closeInErr) { /* noop */ }
            }
            if (outFd !== null) {
                try { fs.closeSync(outFd); } catch (_closeOutErr) { /* noop */ }
            }
            if (fs.existsSync(tmpOutPath)) {
                try { fs.unlinkSync(tmpOutPath); } catch (_unlinkTmpErr) { /* noop */ }
            }
        }
    }

    /**
     * Descifra un archivo de respaldo en chunks de 64 KB verificando autenticidad antes de publicar el archivo
     */
    decryptFile(inputPath, outputPath, customPassword = null) {
        if (!this.isEncrypted(inputPath)) {
            throw new Error('El archivo no tiene el formato de respaldo cifrado de Isaac POS (Encabezado inválido).');
        }

        const stat = fs.statSync(inputPath);
        if (stat.size < HEADER_LEN) {
            throw new Error('El archivo cifrado está truncado o corrupto.');
        }

        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const tmpOutPath = `${outputPath}.tmp.${process.pid}.${Date.now()}`;

        let inFd = null;
        let outFd = null;
        let decryptedSize = 0;

        try {
            inFd = fs.openSync(inputPath, 'r');
            const headerBuf = Buffer.allocUnsafe(HEADER_LEN);
            const headerRead = fs.readSync(inFd, headerBuf, 0, HEADER_LEN, 0);
            if (headerRead < HEADER_LEN) {
                throw new Error('No se pudo leer la cabecera completa del archivo cifrado.');
            }

            let offset = MAGIC_HEADER.length;
            const salt = headerBuf.subarray(offset, offset + SALT_LEN);
            offset += SALT_LEN;
            const iv = headerBuf.subarray(offset, offset + IV_LEN);
            offset += IV_LEN;
            const tag = headerBuf.subarray(offset, offset + TAG_LEN);

            const secret = this._getMasterSecret(customPassword);
            const key = this._deriveKey(secret, salt);

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(tag);

            outFd = fs.openSync(tmpOutPath, 'w');
            const readBuffer = Buffer.allocUnsafe(CHUNK_SIZE);
            let filePos = HEADER_LEN;
            let bytesRead = 0;

            while (filePos < stat.size && (bytesRead = fs.readSync(inFd, readBuffer, 0, CHUNK_SIZE, filePos)) > 0) {
                filePos += bytesRead;
                const plainChunk = decipher.update(readBuffer.subarray(0, bytesRead));
                if (plainChunk.length > 0) {
                    fs.writeSync(outFd, plainChunk);
                    decryptedSize += plainChunk.length;
                }
            }

            try {
                const finalPlain = decipher.final();
                if (finalPlain.length > 0) {
                    fs.writeSync(outFd, finalPlain);
                    decryptedSize += finalPlain.length;
                }
            } catch (_authErr) {
                throw new Error('Fallo de autenticación criptográfica. Contraseña de respaldo incorrecta o archivo manipulado.');
            }

            fs.closeSync(inFd);
            inFd = null;
            fs.closeSync(outFd);
            outFd = null;

            fs.renameSync(tmpOutPath, outputPath);

            return {
                success: true,
                outputPath,
                decryptedSize
            };
        } finally {
            if (inFd !== null) {
                try { fs.closeSync(inFd); } catch (_closeInErr) { /* noop */ }
            }
            if (outFd !== null) {
                try { fs.closeSync(outFd); } catch (_closeOutErr) { /* noop */ }
            }
            if (fs.existsSync(tmpOutPath)) {
                try { fs.unlinkSync(tmpOutPath); } catch (_unlinkTmpErr) { /* noop */ }
            }
        }
    }
}

module.exports = new BackupEncryptionService();
