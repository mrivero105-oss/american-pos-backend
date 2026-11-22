const { execFile } = require('child_process');
const crypto = require('crypto');
const fsSync = require('fs');
const path = require('path');
const os = require('os');

class HardwareIdentity {
    constructor() {
        const appData = process.env.USER_DATA_PATH
            || (process.platform === 'win32' && process.env.APPDATA
                ? (fsSync.existsSync(path.join(process.env.APPDATA, 'isaac-pos')) ? path.join(process.env.APPDATA, 'isaac-pos') :
                   fsSync.existsSync(path.join(process.env.APPDATA, 'Isaac POS')) ? path.join(process.env.APPDATA, 'Isaac POS') :
                   fsSync.existsSync(path.join(process.env.APPDATA, 'isaacpos')) ? path.join(process.env.APPDATA, 'isaacpos') :
                   fsSync.existsSync(path.join(process.env.APPDATA, 'americanpos')) ? path.join(process.env.APPDATA, 'americanpos') :
                   fsSync.existsSync(path.join(process.env.APPDATA, 'american-pos-backend')) ? path.join(process.env.APPDATA, 'american-pos-backend') :
                   path.join(process.env.APPDATA, 'isaac-pos'))
                : path.join(os.homedir(), '.isaac-pos'));

        this.dirPath = appData;
        this.hwidPath = path.join(appData, '.hwid_sticky');
        this.sigPath = path.join(appData, '.hwid_sticky.sig');
        this.fastSigPath = path.join(appData, '.hwid_sticky.fast');
        this.cachedHwid = null;
        this._cachedMachineGuid = null;
        this._pendingPromise = null;
    }

    async getFastMachineGuid() {
        if (this._cachedMachineGuid) return this._cachedMachineGuid;
        if (process.platform !== 'win32') return null;

        return new Promise((resolve) => {
            execFile(
                'reg.exe',
                ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
                { timeout: 2500, windowsHide: true },
                (err, stdout) => {
                    if (!err && stdout) {
                        const m = String(stdout).match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
                        if (m && m[1]) {
                            this._cachedMachineGuid = m[1].trim();
                            return resolve(this._cachedMachineGuid);
                        }
                    }
                    resolve(null);
                }
            );
        });
    }

    async _getMachineUUIDDetailed() {
        if (process.platform !== 'win32') {
            return { uuid: 'GENERIC-HOST-' + os.hostname(), isReliable: true, timedOut: false };
        }

        return new Promise((resolve) => {
            execFile(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    '$u=(Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID; if(-not $u){$u=(Get-WmiObject -Class Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID}; if($u){[Console]::Out.Write($u.Trim())}'
                ],
                { timeout: 7000, windowsHide: true },
                (error, stdout) => {
                    const psUuid = stdout ? stdout.trim() : '';
                    if (!error && psUuid && psUuid.length > 5 && !psUuid.includes('Error')) {
                        return resolve({ uuid: psUuid, isReliable: true, timedOut: false });
                    }
                    const timedOut = Boolean(error && (error.killed || error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM'));
                    execFile('wmic.exe', ['csproduct', 'get', 'UUID'], { timeout: 3000, windowsHide: true }, (err, wmicOut) => {
                        if (!err && wmicOut) {
                            const lines = wmicOut.split('\n');
                            const uuid = lines[1] ? lines[1].trim() : '';
                            if (uuid && uuid !== 'UUID' && uuid.length > 5) {
                                return resolve({ uuid, isReliable: true, timedOut: false });
                            }
                        }
                        console.warn('[HWID] Fallo al leer WMIC y Powershell, usando ID por Hostname.');
                        resolve({
                            uuid: 'WIN-' + os.hostname().toUpperCase().replace(/[^A-Z0-9]/g, ''),
                            isReliable: false,
                            timedOut: timedOut || Boolean(err && (err.killed || err.code === 'ETIMEDOUT'))
                        });
                    });
                }
            );
        });
    }

    async getMachineUUID() {
        const res = await this._getMachineUUIDDetailed();
        return res.uuid;
    }

    computeSealSignature(hwid, hardwareUuid) {
        const sealKey = `ISAAC-HWID-SEAL-v2:${String(hardwareUuid || '').trim()}:${os.platform()}`;
        return crypto.createHmac('sha256', sealKey).update(String(hwid || ''), 'utf8').digest('hex');
    }

    verifySealSignature(hwid, hardwareUuid, storedSigHex) {
        if (!hwid || !hardwareUuid || !storedSigHex) return false;
        const expected = this.computeSealSignature(hwid, hardwareUuid);
        const bufA = Buffer.from(String(storedSigHex).trim(), 'utf8');
        const bufB = Buffer.from(expected, 'utf8');
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    computeFastSealSignature(hwid, machineGuid) {
        const sealKey = `ISAAC-HWID-FAST-v1:${String(machineGuid || '').trim()}:${os.platform()}`;
        return crypto.createHmac('sha256', sealKey).update(String(hwid || ''), 'utf8').digest('hex');
    }

    verifyFastSealSignature(hwid, machineGuid, storedFastSigHex) {
        if (!hwid || !machineGuid || !storedFastSigHex) return false;
        const expected = this.computeFastSealSignature(hwid, machineGuid);
        const bufA = Buffer.from(String(storedFastSigHex).trim(), 'utf8');
        const bufB = Buffer.from(expected, 'utf8');
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    _writeFastSealSafe(hwid, machineGuid) {
        if (!hwid || !machineGuid) return;
        try {
            fsSync.mkdirSync(this.dirPath, { recursive: true });
            fsSync.writeFileSync(this.fastSigPath, this.computeFastSealSignature(hwid, machineGuid), 'utf8');
        } catch (_) {}
    }

    async getStableNetId() {
        if (this.cachedHwid) return this.cachedHwid;
        if (this._pendingPromise) return this._pendingPromise;

        this._pendingPromise = (async () => {
            try {
                // 0. Fast-path sin PowerShell/WMI: verificar sello ligado al MachineGuid del registro de Windows
                let existingHwid = '';
                let hasSigFile = false;
                try {
                    if (fsSync.existsSync(this.hwidPath)) {
                        existingHwid = fsSync.readFileSync(this.hwidPath, 'utf8').trim();
                        hasSigFile = fsSync.existsSync(this.sigPath);
                        if (existingHwid && existingHwid.startsWith('POS-') && hasSigFile && fsSync.existsSync(this.fastSigPath)) {
                            const machineGuid = await this.getFastMachineGuid();
                            if (machineGuid) {
                                const fastSigHex = fsSync.readFileSync(this.fastSigPath, 'utf8').trim();
                                if (this.verifyFastSealSignature(existingHwid, machineGuid, fastSigHex)) {
                                    this.cachedHwid = existingHwid;
                                    return existingHwid;
                                }
                            }
                        }
                    }
                } catch (_fastErr) {}

                // 1. Verificación completa por hardware UUID (solo primer arranque o ante ausencia/desajuste del sello rápido)
                const [{ uuid: baseUUID, isReliable, timedOut }, machineGuid] = await Promise.all([
                    this._getMachineUUIDDetailed(),
                    this.getFastMachineGuid()
                ]);
                const canonicalHwid = `POS-${baseUUID}`;

                try {
                    if (existingHwid && existingHwid.startsWith('POS-')) {
                        if (hasSigFile) {
                            const sigHex = fsSync.readFileSync(this.sigPath, 'utf8').trim();
                            if (this.verifySealSignature(existingHwid, baseUUID, sigHex)) {
                                this._writeFastSealSafe(existingHwid, machineGuid);
                                this.cachedHwid = existingHwid;
                                return existingHwid;
                            }
                            if (!isReliable && timedOut) {
                                console.warn('[HWID] Timeout consultando WMI/CIM; conservando .hwid_sticky existente para evitar falso positivo.');
                                this.cachedHwid = existingHwid;
                                return existingHwid;
                            }
                            console.warn('[HWID] Firma HMAC de .hwid_sticky no coincide con la placa base actual (posible clonación). Regenerando HWID físico.');
                        } else if (existingHwid === canonicalHwid || process.env.ALLOW_UNSIGNED_LEGACY_HWID === 'true') {
                            try {
                                fsSync.writeFileSync(this.sigPath, this.computeSealSignature(existingHwid, baseUUID), 'utf8');
                                this._writeFastSealSafe(existingHwid, machineGuid);
                            } catch (_) {}
                            this.cachedHwid = existingHwid;
                            return existingHwid;
                        } else {
                            console.warn('[HWID] .hwid_sticky legado sin firma pertenece a otro UUID de hardware. Regenerando HWID físico.');
                        }
                    }
                } catch (_e) {}

                try {
                    fsSync.mkdirSync(this.dirPath, { recursive: true });
                    fsSync.writeFileSync(this.hwidPath, canonicalHwid, 'utf8');
                    fsSync.writeFileSync(this.sigPath, this.computeSealSignature(canonicalHwid, baseUUID), 'utf8');
                    this._writeFastSealSafe(canonicalHwid, machineGuid);
                    this.cachedHwid = canonicalHwid;
                } catch (writeErr) {
                    console.error('[HWID] Permiso de escritura denegado en HWID sticky file:', writeErr.message);
                    this.cachedHwid = canonicalHwid;
                }

                return canonicalHwid;
            } finally {
                this._pendingPromise = null;
            }
        })();

        return this._pendingPromise;
    }
}

module.exports = new HardwareIdentity();
