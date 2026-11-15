const crypto = require('crypto');
const fs = require('fs');

// Constantes criptográficas para AES-256-GCM
const MAGIC_HEADER = Buffer.from('ISAAC_SEC_BK1'); // 13 bytes
const SALT_LEN = 16;
const IV_LEN = 12; // 96 bits recomendado para GCM
const TAG_LEN = 16; // 128 bits auth tag
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
     * Cifra un archivo de respaldo usando AES-256-GCM con autenticación criptográfica
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
        const fileData = fs.readFileSync(inputPath);
        const encrypted = Buffer.concat([cipher.update(fileData), cipher.final()]);
        const tag = cipher.getAuthTag();

        const finalBuffer = Buffer.concat([MAGIC_HEADER, salt, iv, tag, encrypted]);
        fs.writeFileSync(outputPath, finalBuffer);

        return {
            success: true,
            outputPath,
            originalSize: fileData.length,
            encryptedSize: finalBuffer.length,
            algorithm: ALGORITHM
        };
    }

    /**
     * Descifra un archivo de respaldo cifrado con verificación de integridad de authTag
     */
    decryptFile(inputPath, outputPath, customPassword = null) {
        if (!this.isEncrypted(inputPath)) {
            throw new Error('El archivo no tiene el formato de respaldo cifrado de Isaac POS (Encabezado inválido).');
        }

        const buffer = fs.readFileSync(inputPath);
        let offset = MAGIC_HEADER.length;

        const salt = buffer.subarray(offset, offset + SALT_LEN);
        offset += SALT_LEN;

        const iv = buffer.subarray(offset, offset + IV_LEN);
        offset += IV_LEN;

        const tag = buffer.subarray(offset, offset + TAG_LEN);
        offset += TAG_LEN;

        const ciphertext = buffer.subarray(offset);

        const secret = this._getMasterSecret(customPassword);
        const key = this._deriveKey(secret, salt);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted;
        try {
            decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch (err) {
            throw new Error('Fallo de autenticación criptográfica. Contraseña de respaldo incorrecta o archivo manipulado.');
        }

        fs.writeFileSync(outputPath, decrypted);

        return {
            success: true,
            outputPath,
            decryptedSize: decrypted.length
        };
    }
}

module.exports = new BackupEncryptionService();
