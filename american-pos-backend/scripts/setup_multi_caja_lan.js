const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { Sequelize } = require('sequelize');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254')) {
                ips.push({ name, address: iface.address });
            }
        }
    }
    return ips;
}

function findPostgresHbaPath() {
    const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '16', 'data', 'pg_hba.conf'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '17', 'data', 'pg_hba.conf'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '15', 'data', 'pg_hba.conf'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '14', 'data', 'pg_hba.conf')
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    const basePg = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    if (fs.existsSync(basePg)) {
        try {
            const subdirs = fs.readdirSync(basePg);
            for (const sub of subdirs) {
                const p = path.join(basePg, sub, 'data', 'pg_hba.conf');
                if (fs.existsSync(p)) return p;
            }
        } catch (e) {}
    }

    return null;
}

async function runMultiCajaSetup() {
    console.log('======================================================================');
    console.log('       ISAAC POS - CONFIGURACIÓN DE RED MULTI-CAJA (POSTGRESQL)       ');
    console.log('======================================================================\n');

    // 1. Detect Local IPs
    const ips = getLocalIpAddresses();
    console.log('[1/5] Detectando direcciones IP de la red local...');
    if (ips.length === 0) {
        console.warn('⚠️ No se detectó ninguna interfaz de red activa.');
    } else {
        ips.forEach(ip => console.log(`   -> Adaptador: ${ip.name} | Dirección IP: ${ip.address}`));
    }
    const primaryIp = ips[0]?.address || '127.0.0.1';
    console.log(`   * IP Principal del Servidor: ${primaryIp}\n`);

    // 2. Locate and Update pg_hba.conf
    console.log('[2/5] Configurando permisos de red en PostgreSQL (pg_hba.conf)...');
    const hbaPath = findPostgresHbaPath();
    if (!hbaPath) {
        console.error('❌ No se encontró el archivo pg_hba.conf en las rutas estándar.');
        process.exit(1);
    }
    console.log(`   -> Archivo detectado: ${hbaPath}`);

    let hbaContent = fs.readFileSync(hbaPath, 'utf8');
    const lanMarker = '# ISAAC POS - MULTI-CAJA LOCAL NETWORK (LAN) ACCESS';

    if (hbaContent.includes(lanMarker) || (hbaContent.includes('192.168.0.0/16') && hbaContent.includes('scram-sha-256'))) {
        console.log('   ✅ Las reglas de acceso LAN ya están presentes en pg_hba.conf.\n');
    } else {
        const lanRules = `\n${lanMarker}\n` +
            `# Permite conexion con contrasena (scram-sha-256) desde terminales en la red local\n` +
            `host    all             all             192.168.0.0/16          scram-sha-256\n` +
            `host    all             all             10.0.0.0/8             scram-sha-256\n` +
            `host    all             all             172.16.0.0/12           scram-sha-256\n`;

        fs.appendFileSync(hbaPath, lanRules, 'utf8');
        console.log('   ✅ Reglas de subred (192.168.x.x, 10.x.x.x, 172.x.x.x) agregadas a pg_hba.conf.\n');
    }

    // 2b. Locate and Update postgresql.conf (listen_addresses = '*')
    console.log('[2b/5] Verificando interfaces de escucha en postgresql.conf (listen_addresses)...');
    const confPath = path.join(path.dirname(hbaPath), 'postgresql.conf');
    if (fs.existsSync(confPath)) {
        let confContent = fs.readFileSync(confPath, 'utf8');
        if (confContent.match(/^listen_addresses\s*=\s*'\*'/m)) {
            console.log("   ✅ listen_addresses ya está configurado en '*' en postgresql.conf.\n");
        } else {
            if (/listen_addresses\s*=/i.test(confContent)) {
                confContent = confContent.replace(/#?listen_addresses\s*=\s*'[^']*'/i, "listen_addresses = '*'\t\t# Habilitado por American POS Multi-Caja");
            } else {
                confContent += "\n# ISAAC POS - MULTI-CAJA LAN LISTEN\nlisten_addresses = '*'\n";
            }
            fs.writeFileSync(confPath, confContent, 'utf8');
            console.log("   ✅ postgresql.conf actualizado: listen_addresses = '*' para aceptar conexiones LAN.\n");
        }
    } else {
        console.warn('   ⚠️ postgresql.conf no encontrado en el directorio de pg_hba.conf.\n');
    }

    // 3. Reload PostgreSQL Configuration
    console.log('[3/5] Recargando configuracion de PostgreSQL en caliente...');
    try {
        const dbName = process.env.DB_NAME || 'americanpos';
        const dbUser = process.env.DB_USER || 'postgres';
        const dbPass = process.env.DB_PASSWORD || 'postgres';
        const dbPort = parseInt(process.env.DB_PORT || '5432', 10);

        const localSeq = new Sequelize(dbName, dbUser, dbPass, {
            host: '127.0.0.1',
            port: dbPort,
            dialect: 'postgres',
            logging: false
        });

        await localSeq.query('SELECT pg_reload_conf();');
        console.log('   ✅ Configuración recargada exitosamente (SELECT pg_reload_conf()).\n');
        await localSeq.close();
    } catch (reloadErr) {
        console.warn(`   ⚠️ Aviso al recargar configuración: ${reloadErr.message}\n`);
    }

    // 4. Windows Firewall Rules
    console.log('[4/5] Verificando reglas de Firewall de Windows...');
    if (process.platform === 'win32') {
        try {
            // Rule for 5432 (PostgreSQL)
            execSync('netsh advfirewall firewall add rule name="Isaac POS - PostgreSQL LAN (5432)" dir=in action=allow protocol=TCP localport=5432 profile=any', { stdio: 'ignore' });
            console.log('   ✅ Puerto TCP 5432 (PostgreSQL) habilitado en el Firewall.');

            // Rule for 3005 (POS Express API)
            execSync('netsh advfirewall firewall add rule name="Isaac POS - Server API (3005)" dir=in action=allow protocol=TCP localport=3005 profile=any', { stdio: 'ignore' });
            console.log('   ✅ Puerto TCP 3005 (Isaac POS API / WebSockets) habilitado en el Firewall.\n');
        } catch (fwErr) {
            console.warn(`   ⚠️ Aviso en Firewall (puede requerir ejecutar como Administrador): ${fwErr.message}\n`);
        }
    } else {
        console.log('   ℹ️ Sistema no-Windows detectado, omitiendo netsh.\n');
    }

    // 5. Verify and Certify LAN Connection
    console.log('[5/5] Certificando conexion remota simulada a través de la IP LAN...');
    const testHost = primaryIp !== '127.0.0.1' ? primaryIp : '127.0.0.1';
    try {
        const dbName = process.env.DB_NAME || 'americanpos';
        const dbUser = process.env.DB_USER || 'postgres';
        const dbPass = process.env.DB_PASSWORD || 'postgres';
        const dbPort = parseInt(process.env.DB_PORT || '5432', 10);

        const lanSeq = new Sequelize(dbName, dbUser, dbPass, {
            host: testHost,
            port: dbPort,
            dialect: 'postgres',
            logging: false,
            dialectOptions: {
                connectTimeout: 5000
            }
        });

        await lanSeq.authenticate();
        const [results] = await lanSeq.query('SELECT version();');
        console.log(`   ✅ Conexión LAN exitosa a http://${testHost}:${dbPort}`);
        console.log(`   Motor: ${results[0]?.version?.split(',')[0]}\n`);
        await lanSeq.close();

        console.log('======================================================================');
        console.log('  🎉 SISTEMA MULTI-CAJA LISTO PARA CONECTAR TERMINALES SECUNDARIAS!   ');
        console.log('======================================================================');
        console.log(`\nDatos para configurar Caja 2, Caja 3 o Tablets en la misma red Wi-Fi/LAN:`);
        console.log(`  - IP del Servidor:  ${primaryIp}`);
        console.log(`  - Puerto BD:        ${dbPort}`);
        console.log(`  - Nombre BD:        ${dbName}`);
        console.log(`  - Usuario BD:       ${dbUser}`);
        console.log(`  - URL Web/API:      http://${primaryIp}:3005\n`);
        console.log('======================================================================\n');
    } catch (testErr) {
        console.error(`❌ Falló la prueba de conexión LAN: ${testErr.message}`);
        process.exit(1);
    }
}

runMultiCajaSetup().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
