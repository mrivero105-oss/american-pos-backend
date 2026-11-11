const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
    const rootDir = path.resolve(__dirname, '..');
    const distDir = path.join(rootDir, 'dist_installer');
    const stubPath = path.join(distDir, 'stub.exe');
    const zipPath = path.join(distDir, 'app_payload.zip');
    const outExe = path.join(distDir, 'Instalador_Isaac_POS_Ultra.exe');
    const desktopExe = path.join(process.env.USERPROFILE || 'C:\\Users\\mrive', 'Desktop', 'Instalador_Isaac_POS_Ultra.exe');

    if (!fs.existsSync(zipPath)) {
        console.error('[Installer Builder] ERROR: app_payload.zip no existe aún.');
        process.exit(1);
    }

    console.log('[Installer Builder] 1. Re-compilando Stub GUI con csc.exe y favicon...');
    const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    const cscCmd = `"${csc}" /target:winexe /win32icon:"public\\favicon.ico" /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll /out:"dist_installer\\stub.exe" "scripts\\installer_gui.cs"`;
    execSync(cscCmd, { cwd: rootDir });

    console.log('[Installer Builder] 2. Ensamblando Instalador Autónomo .exe (Stub + Payload + Footer)...');
    const stubBuf = fs.readFileSync(stubPath);
    const zipStat = fs.statSync(zipPath);
    const zipLen = zipStat.size;

    console.log(`[Installer Builder]    - Tamaño Stub GUI: ${(stubBuf.length / 1024).toFixed(1)} KB`);
    console.log(`[Installer Builder]    - Tamaño Payload: ${(zipLen / (1024 * 1024)).toFixed(2)} MB`);

    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigInt64LE(BigInt(zipLen), 0);

    const outStream = fs.createWriteStream(outExe);
    outStream.write(stubBuf);

    const zipStream = fs.createReadStream(zipPath);
    zipStream.pipe(outStream, { end: false });

    zipStream.on('end', () => {
        outStream.write(lenBuf, () => {
            outStream.end();
            console.log('[Installer Builder] 3. Instalador compilado exitosamente:', outExe);

            // Copiar al Escritorio del Usuario
            fs.copyFileSync(outExe, desktopExe);
            console.log('[Installer Builder] 4. Copia directa en el Escritorio:', desktopExe);

            const finalStat = fs.statSync(desktopExe);
            console.log(`\n🎉 INSTALADOR EJECUTABLE .EXE GENERADO EXITOSAMENTE`);
            console.log(`   Ubicación 1: ${outExe}`);
            console.log(`   Ubicación 2: ${desktopExe}`);
            console.log(`   Tamaño Total: ${(finalStat.size / (1024 * 1024)).toFixed(2)} MB\n`);
        });
    });
}

main().catch(err => {
    console.error('Fatal error in create_final_installer:', err);
    process.exit(1);
});
