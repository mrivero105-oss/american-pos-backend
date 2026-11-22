const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const RUN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_APPROVED_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const CANONICAL_RUN_VALUE = 'Isaac POS';
const AUTO_START_TASK_NAME = 'Isaac POS AutoStart';
const DUPLICATE_RUN_VALUES = [
    'American POS',
    'electron.app.Isaac POS',
    'electron.app.Isaac POS Modern',
    'com.isaacpos.frontend'
];

function defaultExecFileAsync(cmd, args, options = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { windowsHide: true, timeout: 7000, ...options }, (err, stdout, stderr) => {
            resolve({
                ok: !err,
                err,
                stdout: String(stdout || ''),
                stderr: String(stderr || '')
            });
        });
    });
}

function escapeXml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getAutoLaunchPreference(userDataPath) {
    try {
        if (!userDataPath) return true;
        const settingsPath = path.join(userDataPath, 'auto_launch.json');
        if (fs.existsSync(settingsPath)) {
            const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (typeof parsed.autoLaunch === 'boolean') {
                return parsed.autoLaunch;
            }
        }
    } catch (_e) {}
    return true;
}

function saveAutoLaunchPreference(userDataPath, enabled) {
    try {
        if (!userDataPath) return;
        const settingsPath = path.join(userDataPath, 'auto_launch.json');
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        settings.autoLaunch = Boolean(enabled);
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (_e) {}
}

function resolveTargetExecutablePath(processExecPath = process.execPath) {
    const exePath = String(processExecPath || '');
    const lower = exePath.toLowerCase();
    if (!lower || lower.includes('node.exe') || lower.includes('electron.exe')) {
        const candidates = [
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Isaac POS Modern', 'Isaac POS Modern.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Isaac POS V24.04', 'Isaac POS V24.04.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Isaac POS', 'Isaac POS.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'IsaacPOS', 'Isaac POS.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'American POS', 'American POS.exe')
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return exePath;
}

function removeRedundantStartupShortcuts(logFn = () => {}) {
    if (process.platform !== 'win32') return;
    const startupDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    for (const fileName of ['Isaac POS.lnk', 'American POS.lnk']) {
        const scPath = path.join(startupDir, fileName);
        try {
            if (fs.existsSync(scPath)) {
                fs.unlinkSync(scPath);
                logFn(`Removed redundant startup shortcut: ${scPath}`);
            }
        } catch (_e) {}
    }
}

async function isWindowsProcessElevated(execFn = defaultExecFileAsync) {
    if (process.platform !== 'win32') return false;
    const res = await execFn('whoami.exe', ['/groups']);
    if (!res.ok) return false;
    // High Mandatory Level (S-1-16-12288) o System Mandatory Level (S-1-16-16384)
    return res.stdout.includes('S-1-16-12288') || res.stdout.includes('S-1-16-16384');
}

async function getCurrentWindowsUserId(execFn = defaultExecFileAsync) {
    // Preferir SID exacto via `whoami /user /fo list` para evitar incompatibilidades con cuentas Microsoft o espacios
    const sidRes = await execFn('whoami.exe', ['/user', '/fo', 'list']);
    if (sidRes.ok && sidRes.stdout) {
        const sidMatch = sidRes.stdout.match(/(S-1-5-[\d-]+)/i);
        if (sidMatch && sidMatch[1]) {
            return sidMatch[1];
        }
    }
    const res = await execFn('whoami.exe', []);
    const trimmed = res.ok ? res.stdout.trim().split(/\r?\n/)[0]?.trim() : '';
    if (trimmed) return trimmed;
    const domain = process.env.USERDOMAIN || os.hostname();
    const user = process.env.USERNAME || os.userInfo().username;
    return domain ? `${domain}\\${user}` : user;
}

/**
 * Construye el XML de tarea programada con LogonTrigger y RunLevel configurable.
 * Permite arrancar en Windows 10/11 incluso ejecutables con manifest highestAvailable y UAC activo.
 */
function buildAutoStartTaskXml({ userId, exePath, runLevel = 'HighestAvailable' }) {
    const safeUser = escapeXml(userId);
    const safeExe = escapeXml(exePath);
    const safeWorkDir = escapeXml(path.dirname(exePath));
    const safeRunLevel = escapeXml(runLevel);

    return [
        '<?xml version="1.0" encoding="UTF-16"?>',
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
        '  <Triggers>',
        '    <LogonTrigger>',
        '      <Enabled>true</Enabled>',
        `      <UserId>${safeUser}</UserId>`,
        '      <Delay>PT2S</Delay>',
        '    </LogonTrigger>',
        '  </Triggers>',
        '  <Principals>',
        '    <Principal id="Author">',
        `      <UserId>${safeUser}</UserId>`,
        '      <LogonType>InteractiveToken</LogonType>',
        `      <RunLevel>${safeRunLevel}</RunLevel>`,
        '    </Principal>',
        '  </Principals>',
        '  <Settings>',
        '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
        '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
        '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
        '    <AllowHardTerminate>false</AllowHardTerminate>',
        '    <StartWhenAvailable>true</StartWhenAvailable>',
        '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
        '    <AllowStartOnDemand>true</AllowStartOnDemand>',
        '    <Enabled>true</Enabled>',
        '    <Hidden>false</Hidden>',
        '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
        '    <WakeToRun>false</WakeToRun>',
        '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
        '    <Priority>4</Priority>',
        '  </Settings>',
        '  <Actions Context="Author">',
        '    <Exec>',
        `      <Command>${safeExe}</Command>`,
        `      <WorkingDirectory>${safeWorkDir}</WorkingDirectory>`,
        '    </Exec>',
        '  </Actions>',
        '</Task>'
    ].join('\r\n');
}

function isTaskXmlMatching(xmlStdout, exePath, expectedRunLevel = 'HighestAvailable') {
    if (!xmlStdout) return false;
    const normalizedExe = escapeXml(exePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasLogon = /<LogonTrigger>/i.test(xmlStdout);
    const hasRunLevel = expectedRunLevel === 'HighestAvailable'
        ? /<RunLevel>\s*HighestAvailable\s*<\/RunLevel>/i.test(xmlStdout)
        : !/<RunLevel>\s*HighestAvailable\s*<\/RunLevel>/i.test(xmlStdout);
    const hasCommand = new RegExp(`<Command>\\s*"?${normalizedExe}"?\\s*<\\/Command>`, 'i').test(xmlStdout);
    const hasInfiniteTime = /<ExecutionTimeLimit>\s*PT0S\s*<\/ExecutionTimeLimit>/i.test(xmlStdout);
    const allowsBattery = /<DisallowStartIfOnBatteries>\s*false\s*<\/DisallowStartIfOnBatteries>/i.test(xmlStdout);
    const isDisabled = /<Settings>[\s\S]*?<Enabled>\s*false\s*<\/Enabled>/i.test(xmlStdout)
        || /<LogonTrigger>[\s\S]*?<Enabled>\s*false\s*<\/Enabled>/i.test(xmlStdout);

    return hasLogon && hasRunLevel && hasCommand && hasInfiniteTime && allowsBattery && !isDisabled;
}

async function ensureScheduledTaskAutoStart(exePath, { execFn = defaultExecFileAsync, logFn = () => {} } = {}) {
    const queryRes = await execFn('schtasks.exe', ['/Query', '/TN', AUTO_START_TASK_NAME, '/XML']);
    if (queryRes.ok && isTaskXmlMatching(queryRes.stdout, exePath, 'HighestAvailable')) {
        return { ok: true, updated: false };
    }

    const userId = await getCurrentWindowsUserId(execFn);
    const xmlContent = buildAutoStartTaskXml({ userId, exePath, runLevel: 'HighestAvailable' });
    const tmpXml = path.join(os.tmpdir(), `isaac_autostart_${process.pid}_${Date.now()}.xml`);
    try {
        const utf16BomBuffer = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xmlContent, 'utf16le')]);
        fs.writeFileSync(tmpXml, utf16BomBuffer);
        const createRes = await execFn('schtasks.exe', ['/Create', '/TN', AUTO_START_TASK_NAME, '/XML', tmpXml, '/F']);
        if (!createRes.ok) {
            return { ok: false, error: createRes.stderr || createRes.stdout || createRes.err?.message || 'Error creando tarea programada' };
        }
        logFn(`Autoinicio configurado vía Programador de Tareas (${AUTO_START_TASK_NAME}, RunLevel: HighestAvailable) para: ${exePath}`);
        return { ok: true, updated: true };
    } finally {
        try { if (fs.existsSync(tmpXml)) fs.unlinkSync(tmpXml); } catch (_e) {}
    }
}

async function removeScheduledTaskAutoStart({ execFn = defaultExecFileAsync, logFn = () => {} } = {}) {
    const queryRes = await execFn('schtasks.exe', ['/Query', '/TN', AUTO_START_TASK_NAME]);
    if (!queryRes.ok) return { ok: true, removed: false };
    const delRes = await execFn('schtasks.exe', ['/Delete', '/TN', AUTO_START_TASK_NAME, '/F']);
    if (delRes.ok) {
        logFn(`Removed Windows Scheduled Task auto-start: ${AUTO_START_TASK_NAME}`);
    }
    return { ok: delRes.ok, removed: delRes.ok, error: delRes.stderr || delRes.err?.message };
}

/**
 * Configura de forma idempotente y no bloqueante el autoinicio del sistema.
 * Si el proceso corre elevado (build Modern con highestAvailable), usa Task Scheduler
 * con RunLevel HighestAvailable para evitar el bloqueo silencioso PID 0 de HKCU\Run en UAC.
 */
async function configureWindowsAutoLaunch(enabled = true, options = {}) {
    const desiredEnabled = Boolean(enabled);
    const userDataPath = options.userDataPath || null;
    const isPackaged = Boolean(options.isPackaged);
    const processExecPath = options.processExecPath || process.execPath;
    const app = options.app || null;
    const execFn = options.execFn || defaultExecFileAsync;
    const logFn = options.logFn || (() => {});

    if (process.platform !== 'win32') {
        try {
            if (app?.setLoginItemSettings) {
                app.setLoginItemSettings({ openAtLogin: desiredEnabled, path: processExecPath });
            }
        } catch (_e) {}
        saveAutoLaunchPreference(userDataPath, desiredEnabled);
        return { success: true, enabled: desiredEnabled, mechanism: 'electron_login_items' };
    }

    const exePath = resolveTargetExecutablePath(processExecPath);
    const isDevExecutable = exePath.toLowerCase().includes('node.exe') || exePath.toLowerCase().includes('electron.exe');

    if (isDevExecutable && !isPackaged) {
        logFn('Modo desarrollo detectado. Omitiendo registro automático en Windows.');
        return { success: true, enabled: false, mechanism: 'dev_skipped' };
    }

    try {
        if (app?.setLoginItemSettings) {
            app.setLoginItemSettings({ openAtLogin: false, path: exePath });
        }
    } catch (_e) {}

    removeRedundantStartupShortcuts(logFn);

    const regDump = await execFn('reg.exe', ['query', RUN_REG_KEY]);
    const regText = regDump.stdout || '';

    for (const dupKey of DUPLICATE_RUN_VALUES) {
        if (regText.includes(dupKey)) {
            await execFn('reg.exe', ['delete', RUN_REG_KEY, '/v', dupKey, '/f']);
            logFn(`Removed duplicate Windows Run entry: ${dupKey}`);
        }
    }

    const runLineMatch = regText.split(/\r?\n/).find((line) => /^\s*Isaac POS\s+REG_/i.test(line));
    const currentRunValue = runLineMatch ? runLineMatch.replace(/^\s*Isaac POS\s+REG_\w+\s+/i, '').trim() : '';

    if (!desiredEnabled) {
        await removeScheduledTaskAutoStart({ execFn, logFn });
        if (currentRunValue) {
            await execFn('reg.exe', ['delete', RUN_REG_KEY, '/v', CANONICAL_RUN_VALUE, '/f']);
            logFn('Windows auto-launch disabled by user preference.');
        }
        saveAutoLaunchPreference(userDataPath, false);
        return { success: true, enabled: false, mechanism: 'disabled' };
    }

    const elevated = typeof options.isElevatedOverride === 'boolean'
        ? options.isElevatedOverride
        : await isWindowsProcessElevated(execFn);

    if (elevated) {
        const taskRes = await ensureScheduledTaskAutoStart(exePath, { execFn, logFn });
        if (taskRes.ok) {
            // Eliminar HKCU\Run\Isaac POS para evitar que Explorer intente lanzarlo con PID 0 (UAC) en paralelo a la tarea
            if (currentRunValue) {
                await execFn('reg.exe', ['delete', RUN_REG_KEY, '/v', CANONICAL_RUN_VALUE, '/f']);
                logFn('Removed HKCU Run entry superseded by elevated Windows Scheduled Task.');
            }
            saveAutoLaunchPreference(userDataPath, true);
            return { success: true, enabled: true, mechanism: 'scheduled_task', exePath };
        }
        logFn(`Aviso configurando tarea programada, intentando fallback HKCU Run: ${taskRes.error}`);
    }

    // Fallback (o build asInvoker no elevado): usar HKCU\Run canónico
    const expectedCmd = `"${exePath}"`;
    if (currentRunValue !== expectedCmd) {
        logFn(`Configurando autoinicio único en Windows para: ${exePath}`);
        const addRes = await execFn('reg.exe', ['add', RUN_REG_KEY, '/v', CANONICAL_RUN_VALUE, '/t', 'REG_SZ', '/d', expectedCmd, '/f']);
        if (!addRes.ok) {
            const errMsg = addRes.stderr || addRes.err?.message || 'Reg add error';
            logFn(`Reg add error: ${errMsg}`);
            return { success: false, enabled: false, error: errMsg };
        }
    }

    saveAutoLaunchPreference(userDataPath, true);
    return { success: true, enabled: true, mechanism: 'hkcu_run', exePath };
}

async function isRunEntryApprovedEnabled(execFn = defaultExecFileAsync) {
    const approved = await execFn('reg.exe', ['query', STARTUP_APPROVED_RUN_KEY, '/v', CANONICAL_RUN_VALUE]);
    if (!approved.ok || !approved.stdout) return true;
    const match = approved.stdout.match(/REG_BINARY\s+([0-9A-Fa-f]+)/i);
    if (!match) return true;
    // Windows StartupApproved: primer byte 03 (o impar distinto de 02/06) indica deshabilitado en Administrador de Tareas
    return !match[1].startsWith('03');
}

async function getWindowsAutoLaunchStatus(options = {}) {
    const userDataPath = options.userDataPath || null;
    const app = options.app || null;
    const execFn = options.execFn || defaultExecFileAsync;

    if (process.platform !== 'win32') {
        if (app?.getLoginItemSettings) {
            return Boolean(app.getLoginItemSettings().openAtLogin);
        }
        return getAutoLaunchPreference(userDataPath);
    }

    const taskRes = await execFn('schtasks.exe', ['/Query', '/TN', AUTO_START_TASK_NAME, '/XML']);
    if (taskRes.ok && /<LogonTrigger>/i.test(taskRes.stdout)) {
        const disabled = /<Settings>[\s\S]*?<Enabled>\s*false\s*<\/Enabled>/i.test(taskRes.stdout)
            || /<LogonTrigger>[\s\S]*?<Enabled>\s*false\s*<\/Enabled>/i.test(taskRes.stdout);
        if (!disabled) return true;
    }

    const regRes = await execFn('reg.exe', ['query', RUN_REG_KEY, '/v', CANONICAL_RUN_VALUE]);
    if (regRes.ok && regRes.stdout && regRes.stdout.includes(CANONICAL_RUN_VALUE)) {
        const approved = await isRunEntryApprovedEnabled(execFn);
        if (approved) return true;
    }

    return false;
}

module.exports = {
    AUTO_START_TASK_NAME,
    RUN_REG_KEY,
    CANONICAL_RUN_VALUE,
    DUPLICATE_RUN_VALUES,
    buildAutoStartTaskXml,
    configureWindowsAutoLaunch,
    ensureScheduledTaskAutoStart,
    getAutoLaunchPreference,
    getWindowsAutoLaunchStatus,
    isTaskXmlMatching,
    isWindowsProcessElevated,
    removeRedundantStartupShortcuts,
    removeScheduledTaskAutoStart,
    resolveTargetExecutablePath,
    saveAutoLaunchPreference
};
