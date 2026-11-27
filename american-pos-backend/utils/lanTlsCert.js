const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CERT_FILENAME = 'lan-cert.pem';
const KEY_FILENAME = 'lan-key.pem';
const RENEW_THRESHOLD_DAYS = 30;
const VALIDITY_DAYS = 825;

// --- Utilidades ASN.1 DER mínimas (RFC 5280) ---

function derLength(len) {
    if (len < 0x80) return Buffer.from([len]);
    const bytes = [];
    let n = len;
    while (n > 0) {
        bytes.unshift(n & 0xff);
        n >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derWrap(tag, content) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return Buffer.concat([Buffer.from([tag]), derLength(buf.length), buf]);
}

function derSequence(items) {
    return derWrap(0x30, Buffer.concat(items));
}

function derSet(items) {
    return derWrap(0x31, Buffer.concat(items));
}

function derOid(oidStr) {
    const parts = oidStr.split('.').map(Number);
    const out = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i += 1) {
        let v = parts[i];
        if (v === 0) {
            out.push(0);
            continue;
        }
        const stack = [];
        while (v > 0) {
            stack.unshift(v & 0x7f);
            v >>= 7;
        }
        for (let j = 0; j < stack.length - 1; j += 1) {
            stack[j] |= 0x80;
        }
        out.push(...stack);
    }
    return derWrap(0x06, Buffer.from(out));
}

function derIntegerBytes(bytes) {
    let buf = Buffer.from(bytes);
    if (buf.length === 0) buf = Buffer.from([0]);
    if (buf[0] & 0x80) {
        buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return derWrap(0x02, buf);
}

function derIntegerSmall(num) {
    return derWrap(0x02, Buffer.from([num]));
}

function derBitString(bytes, unusedBits = 0) {
    return derWrap(0x03, Buffer.concat([Buffer.from([unusedBits]), bytes]));
}

function derOctetString(bytes) {
    return derWrap(0x04, bytes);
}

function derUtf8String(str) {
    return derWrap(0x0c, Buffer.from(String(str), 'utf8'));
}

function derUtcTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
    const str = `${yy}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
    return derWrap(0x17, Buffer.from(str, 'ascii'));
}

function derName(attributes) {
    return derSequence(
        attributes.map(([oid, value]) =>
            derSet([derSequence([derOid(oid), derUtf8String(value)])])
        )
    );
}

function formatPem(label, derBuffer) {
    const b64 = derBuffer.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function ipv4ToBuffer(ip) {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return null;
    }
    return Buffer.from(octets);
}

function collectLanSanTargets() {
    const ips = new Set(['127.0.0.1']);
    const dnsNames = new Set(['localhost', 'isaac-pos.local']);

    try {
        const host = os.hostname();
        if (host && /^[a-zA-Z0-9.-]+$/.test(host)) {
            dnsNames.add(host.toLowerCase());
        }
    } catch (_e) {}

    try {
        const interfaces = os.networkInterfaces();
        for (const ifaceList of Object.values(interfaces)) {
            if (!Array.isArray(ifaceList)) continue;
            for (const info of ifaceList) {
                if (!info || info.family !== 'IPv4') continue;
                if (info.address && ipv4ToBuffer(info.address)) {
                    ips.add(info.address);
                }
            }
        }
    } catch (_e) {}

    return {
        ips: Array.from(ips).sort(),
        dnsNames: Array.from(dnsNames).sort()
    };
}

function buildExtension(oid, valueDer, critical = false) {
    const parts = [derOid(oid)];
    if (critical) {
        parts.push(derWrap(0x01, Buffer.from([0xff])));
    }
    parts.push(derOctetString(valueDer));
    return derSequence(parts);
}

function generateSelfSignedLanCert({ ips, dnsNames } = collectLanSanTargets()) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1'
    });

    const now = new Date();
    const notBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const notAfter = new Date(now.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    const serialBytes = crypto.randomBytes(16);
    serialBytes[0] = (serialBytes[0] & 0x7f) || 0x01;

    // OID 1.2.840.10045.4.3.2 = ecdsa-with-SHA256 (sin NULL en params per RFC 5758)
    const sigAlgId = derSequence([derOid('1.2.840.10045.4.3.2')]);

    const subjectName = derName([
        ['2.5.4.10', 'Isaac POS'],
        ['2.5.4.3', 'Isaac POS LAN TLS']
    ]);

    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

    const sanEntries = [];
    for (const dns of dnsNames) {
        sanEntries.push(derWrap(0x82, Buffer.from(dns, 'ascii')));
    }
    for (const ip of ips) {
        const ipBuf = ipv4ToBuffer(ip);
        if (ipBuf) {
            sanEntries.push(derWrap(0x87, ipBuf));
        }
    }

    const extensions = derSequence([
        // BasicConstraints: critical=true, CA=false (SEQUENCE vacía)
        buildExtension('2.5.29.19', derSequence([]), true),
        // KeyUsage: critical=true, digitalSignature | keyEncipherment (0xA0, 5 unused bits)
        buildExtension('2.5.29.15', derBitString(Buffer.from([0xa0]), 5), true),
        // ExtKeyUsage: id-kp-serverAuth (1.3.6.1.5.5.7.3.1)
        buildExtension('2.5.29.37', derSequence([derOid('1.3.6.1.5.5.7.3.1')]), false),
        // SubjectAltName
        buildExtension('2.5.29.17', derSequence(sanEntries), false)
    ]);

    const tbsCertificate = derSequence([
        derWrap(0xa0, derIntegerSmall(2)), // v3
        derIntegerBytes(serialBytes),
        sigAlgId,
        subjectName, // issuer = subject
        derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]),
        subjectName,
        spkiDer,
        derWrap(0xa3, extensions)
    ]);

    const signatureDer = crypto.sign('sha256', tbsCertificate, privateKey);
    const certDer = derSequence([
        tbsCertificate,
        sigAlgId,
        derBitString(signatureDer, 0)
    ]);

    const certPem = formatPem('CERTIFICATE', certDer);
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

    return {
        cert: certPem,
        key: keyPem,
        fingerprint256: new crypto.X509Certificate(certPem).fingerprint256,
        ips,
        dnsNames
    };
}

function isExistingCertValid(certPem, expectedIps) {
    try {
        const x509 = new crypto.X509Certificate(certPem);
        const validToMs = Date.parse(x509.validTo);
        if (!Number.isFinite(validToMs)) return false;
        const minRemainingMs = RENEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
        if (validToMs - Date.now() < minRemainingMs) {
            return false;
        }
        const sanStr = String(x509.subjectAltName || '');
        for (const ip of expectedIps) {
            if (!sanStr.includes(`IP Address:${ip}`)) {
                return false;
            }
        }
        return true;
    } catch (_e) {
        return false;
    }
}

/**
 * Garantiza credenciales TLS LAN (ECDSA P-256) vigentes con SAN para todas las IPs LAN actuales.
 * Nunca sobrescribe si ya existen credenciales válidas; regenera automáticamente ante cambios de IP o expiración < 30 días.
 */
function ensureLanTlsCredentials(userDataPath) {
    const certsDir = path.join(userDataPath, 'certs');
    const certPath = path.join(certsDir, CERT_FILENAME);
    const keyPath = path.join(certsDir, KEY_FILENAME);
    const { ips, dnsNames } = collectLanSanTargets();

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        try {
            const existingCert = fs.readFileSync(certPath, 'utf8');
            const existingKey = fs.readFileSync(keyPath, 'utf8');
            if (existingKey.includes('PRIVATE KEY') && isExistingCertValid(existingCert, ips)) {
                const x509 = new crypto.X509Certificate(existingCert);
                return {
                    certPath,
                    keyPath,
                    cert: existingCert,
                    key: existingKey,
                    fingerprint256: x509.fingerprint256,
                    ips,
                    dnsNames,
                    regenerated: false
                };
            }
        } catch (_e) {}
    }

    fs.mkdirSync(certsDir, { recursive: true });
    const generated = generateSelfSignedLanCert({ ips, dnsNames });
    fs.writeFileSync(certPath, generated.cert, { encoding: 'utf8', mode: 0o644 });
    fs.writeFileSync(keyPath, generated.key, { encoding: 'utf8', mode: 0o600 });

    return {
        certPath,
        keyPath,
        cert: generated.cert,
        key: generated.key,
        fingerprint256: generated.fingerprint256,
        ips,
        dnsNames,
        regenerated: true
    };
}

module.exports = {
    collectLanSanTargets,
    generateSelfSignedLanCert,
    isExistingCertValid,
    ensureLanTlsCredentials,
    CERT_FILENAME,
    KEY_FILENAME
};
