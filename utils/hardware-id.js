const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class HardwareIdentity {
    constructor() {
        // En Windows, se debe respetar APPDATA en producción por permisos, de lo contrario fallback
        const appData = process.platform === 'win32' && process.env.APPDATA 
            ? (require('fs').existsSync(path.join(process.env.APPDATA, 'americanpos')) ? path.join(process.env.APPDATA, 'americanpos') : path.join(process.env.APPDATA, 'american-pos-backend')) 
            : path.join(os.homedir(), '.american-pos');
            
        this.dirPath = appData;
        this.hwidPath = path.join(appData, '.hwid_sticky');
        this.cachedHwid = null;
    }

    async getMachineUUID() {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                exec('powershell.exe -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"', (error, stdout) => {
                    const psUuid = stdout ? stdout.trim() : '';
                    if (!error && psUuid) {
                        return resolve(psUuid);
                    }
                    // Fallback to WMIC if powershell fails
                    exec('wmic csproject get UUID', (err, wmicOut) => {
                        if (err) {
                            console.warn('[HWID] Fallo al leer WMIC y Powershell, usando fallback.');
                            return resolve('FALLBACK-' + os.hostname());
                        }
                        const lines = wmicOut.split('\n');
                        const uuid = lines[1] ? lines[1].trim() : 'UNKNOWN-UUID';
                        resolve(uuid);
                    });
                });
            } else {
                resolve('GENERIC-HOST-' + os.hostname());
            }
        });
    }

    async getStableNetId() {
        if (this.cachedHwid) return this.cachedHwid;

        try {
            // Intenta leer el HWID previamente fijado en disco (Async)
            const existingHwid = await fs.readFile(this.hwidPath, 'utf8');
            this.cachedHwid = existingHwid;
            return existingHwid;
        } catch (error) {
            // Si no existe, genera uno inmutable basado en la placa base y lo guarda
            const baseUUID = await this.getMachineUUID();
            const newHwid = `POS-${baseUUID}`;
            
            try {
                // Ensure directory exists
                await fs.mkdir(this.dirPath, { recursive: true });
                await fs.writeFile(this.hwidPath, newHwid, 'utf8');
                this.cachedHwid = newHwid;
            } catch (writeErr) {
                console.error('[HWID] FATAL: No se pudo escribir el sticky file. Permisos EPERM.', writeErr.message);
                this.cachedHwid = newHwid; // Fallback to memory
            }
            
            return newHwid;
        }
    }
}

module.exports = new HardwareIdentity();
