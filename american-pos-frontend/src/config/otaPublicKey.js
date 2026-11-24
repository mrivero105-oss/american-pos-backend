/**
 * Clave Pública RSA-2048 dedicada exclusivamente a la verificación criptográfica
 * de paquetes OTA móviles (dist.zip y manifiesto version.json).
 *
 * Aislada de la clave maestra de licencias para reducir blast radius.
 * La clave privada correspondiente reside únicamente fuera del repositorio Git.
 */
export const OTA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjmR5wG+OxLv8SvmvqkSC
bylPMatYtCp2wxsj5BBwovfCps6UsKdoj2aLPNt4WAQCPJEn96WjcKxo82mfeEGb
71RxErS827qHknXDniZ2Z+1OLT0/EVvLCPx52MniNaF9OmlPtxdY2bHw6vQEhrrb
Ptmt0/EzadWOAxyIGNAQ/raRVLdTMDUqMoo8nlP8HhLjM21xyyxynlG433XUFLM+
M98eJQTuLrP73HDvnwLN0loQGXfot34INzEgdeEySIp8qNR4oS5qJIKn/WqrpoA9
oN/tO3+Kwj/OHfLIwA1lnLNU8VJzUiqI+0MwwSzy8FetciGD37VgYgckjRJrLfc9
FwIDAQAB
-----END PUBLIC KEY-----`;

export default OTA_PUBLIC_KEY_PEM;
