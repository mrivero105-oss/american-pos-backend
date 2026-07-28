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
                // Windows 7 compatibility: Use Get-WmiObject (supported in PowerShell 2.0+)
                exec('powershell.exe -NoProfile -Command "(Get-WmiObject -Class Win32_ComputerSystemProduct).UUID"', { timeout: 4000 }, (error, stdout) => {
                    const psUuid = stdout ? stdout.trim() : '';
                    if (!error && psUuid && psUuid.length > 5 && !psUuid.includes('Error')) {
                        return resolve(psUuid);
                    }
                    // Fallback to WMIC (csproduct is the correct alias)
                    exec('wmic csproduct get UUID', { timeout: 4000 }, (err, wmicOut) => {
                        if (!err && wmicOut) {
                            const lines = wmicOut.split('\n');
                            const uuid = lines[1] ? lines[1].trim() : '';
                            if (uuid && uuid !== 'UUID' && uuid.length > 5) {
                                return resolve(uuid);
                            }
                        }
                        console.warn('[HWID] Fallo al leer WMIC y Powershell en Win7, usando ID inmutable por Hostname.');
                        resolve('WIN-' + os.hostname().toUpperCase().replace(/[^A-Z0-9]/g, ''));
                    });
                });
            } else {
                resolve('GENERIC-HOST-' + os.hostname());
            }
        });
    }

    async getStableNetId() {
        if (this.cachedHwid) return this.cachedHwid;

        const fsSync = require('fs');
        try {
            // Intenta leer el HWID previamente fijado en disco
            if (fsSync.existsSync(this.hwidPath)) {
                const existingHwid = fsSync.readFileSync(this.hwidPath, 'utf8').trim();
                if (existingHwid && existingHwid.startsWith('POS-')) {
                    this.cachedHwid = existingHwid;
                    return existingHwid;
                }
            }
        } catch (e) {}

        // Genera uno inmutable y lo guarda síncronamente
        const baseUUID = await this.getMachineUUID();
        const newHwid = `POS-${baseUUID}`;
        
        try {
            fsSync.mkdirSync(this.dirPath, { recursive: true });
            fsSync.writeFileSync(this.hwidPath, newHwid, 'utf8');
            this.cachedHwid = newHwid;
        } catch (writeErr) {
            console.error('[HWID] Permiso de escritura denegado en HWID sticky file:', writeErr.message);
            this.cachedHwid = newHwid;
        }

        return newHwid;
    }
}

module.exports = new HardwareIdentity();
