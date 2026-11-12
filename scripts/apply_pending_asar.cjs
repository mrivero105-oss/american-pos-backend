const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const INSTALLED_DIR = 'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS Modern\\resources';
const targetAsar = path.join(INSTALLED_DIR, 'app.asar');
const targetNewAsar = path.join(INSTALLED_DIR, 'app.asar.new');

if (!fs.existsSync(targetNewAsar)) {
    console.log('No hay paquete pendiente (app.asar.new no existe).');
    process.exit(0);
}

console.log('Esperando liberación de archivo app.asar...');
let attempts = 0;
let backedUp = false;
const interval = setInterval(() => {
    attempts++;
    try {
        if (!backedUp && fs.existsSync(targetAsar)) {
            const bakPath = path.join(INSTALLED_DIR, `app.asar.bak_applied_${Date.now()}`);
            fs.copyFileSync(targetAsar, bakPath);
            backedUp = true;
        }
        fs.renameSync(targetNewAsar, targetAsar);
        clearInterval(interval);
        console.log('🎉 [ÉXITO] app.asar actualizado correctamente con el emblema Ultra HD.');
        
        // Refrescar icono
        const updateIconScript = path.resolve(__dirname, 'update_desktop_icon.ps1');
        if (fs.existsSync(updateIconScript)) {
            try {
                execSync(`powershell -ExecutionPolicy Bypass -File "${updateIconScript}"`, { stdio: 'ignore' });
            } catch (_) {}
        }
        process.exit(0);
    } catch (err) {
        if (attempts % 10 === 0) {
            console.log(`Intento ${attempts}: Isaac POS Modern sigue abierto. Esperando cierre...`);
        }
        if (attempts > 60) { // 60 segundos
            clearInterval(interval);
            console.log('Tiempo límite de espera alcanzado. El paquete sigue listo en app.asar.new.');
            process.exit(1);
        }
    }
}, 1000);
