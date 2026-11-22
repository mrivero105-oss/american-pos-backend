// Llave pública RSA-2048 (SPKI) de verificación local de licencias v2 (no contiene material privado).
// Se exporta como módulo ES en lugar de importar `.pem?raw` para mantener intacto el bloqueo
// de seguridad `server.fs.deny` (*.pem) de Vite 8 / Vitest 5 contra llaves privadas.
const PUBLIC_RSA_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnZYPc3WHQCv38UDckbZw
mfjZP+lP6gLSP6X+nlX5l2O/G3B8H9v5cM/ZgMe2OXL+vR/G6HwA024WDiHoAvY6
HOmR3zbJZ6zXmaYcv2fcMEz62hlfolcUQh/QDR5/r1bdyXu+ISfqs56kctxHxoZ+
HJXj/8qAO5tBaOpUf3YfJWizPMa7xEWSHLVug9RMTxxF6UH6BaoT8/TQRllNfSHW
fjKlqc2B3y6f9lfl6HBcf/lSPbHE/nJ4YF7Y27KyNk8c2K/bcSLpKCdbKE6YCezQ
YZ8XySA1JySuHbLCOGUGDwUY+bXdZrGP4P/apnEaWKHG4NXRJfyZUE3Qg6dv6nMB
hQIDAQAB
-----END PUBLIC KEY-----`;

export default PUBLIC_RSA_KEY_PEM;
