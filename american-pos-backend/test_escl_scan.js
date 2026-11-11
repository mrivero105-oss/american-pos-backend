const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testScan() {
    const ip = '192.168.1.27';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>2550</pwg:Width>
      <pwg:Height>3508</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <scan:InputSource>Platen</scan:InputSource>
  <scan:ColorMode>RGB24</scan:ColorMode>
  <scan:XResolution>300</scan:XResolution>
  <scan:YResolution>300</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
</scan:ScanSettings>`;

    console.log(`[eSCL] Enviando orden de escaneo a la Canon G4010 en http://${ip}...`);
    const res = await axios.post(`http://${ip}/eSCL/ScanJobs`, xml, {
        headers: { 'Content-Type': 'text/xml' },
        timeout: 15000
    });

    console.log('[eSCL] Respuesta creación trabajo:', res.status, 'Location:', res.headers.location);

    let location = res.headers.location;
    let jobUrl = location.startsWith('http') ? location : `http://${ip}${location.startsWith('/') ? '' : '/'}${location}`;
    
    console.log(`[eSCL] Descargando imagen física desde: ${jobUrl}/NextDocument...`);
    const docRes = await axios.get(`${jobUrl}/NextDocument`, {
        responseType: 'arraybuffer',
        timeout: 120000
    });

    const outPath = path.join(__dirname, 'test_canon_scan.jpg');
    fs.writeFileSync(outPath, Buffer.from(docRes.data));
    console.log(`[eSCL] SUCCESS! Factura escaneada guardada en: ${outPath} (${docRes.data.byteLength} bytes)`);
}

testScan().catch(err => {
    console.error('[eSCL ERROR]:', err.response?.status, err.response?.data?.toString() || err.message);
});
