const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../american-pos-frontend/src/pages/MobilePOSSimulator.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Inyectar Supabase Cloud Fallback en loadSettings
const target1 = `      if (rateRes.status === 'fulfilled' && rateRes.value.data?.rate) {
        const rateVal = parseFloat(rateRes.value.data.rate);
        if (rateVal && !isNaN(rateVal)) {
          setExchangeRate(rateVal);
          try { localStorage.setItem('pos_cached_exchange_rate', String(rateVal)); } catch (_) {}
        }
      }`;

const replacement1 = `      let rateLoaded = false;
      if (rateRes.status === 'fulfilled' && rateRes.value.data?.rate) {
        const rateVal = parseFloat(rateRes.value.data.rate);
        if (rateVal && !isNaN(rateVal)) {
          setExchangeRate(rateVal);
          try { localStorage.setItem('pos_cached_exchange_rate', String(rateVal)); } catch (_) {}
          rateLoaded = true;
        }
      }

      // Si la PC local no respondió (Ej: fuera del local con datos móviles), consultar Supabase Cloud 24/7
      if (!rateLoaded && hasSupabaseConfig()) {
        try {
          const cloudRes = await fetch(getSupabaseRestUrl('cloud_configuracion?id=eq.general&select=*'), {
            headers: getSupabaseHeaders()
          });
          if (cloudRes.ok) {
            const rows = await cloudRes.json();
            if (Array.isArray(rows) && rows.length > 0 && rows[0].tasa_cambio) {
              const cloudRate = parseFloat(rows[0].tasa_cambio);
              if (cloudRate && !isNaN(cloudRate) && cloudRate > 0) {
                setExchangeRate(prev => {
                  if (prev !== cloudRate) {
                    showToast('💱 Tasa oficial desde la Nube: Bs. ' + cloudRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                  }
                  return cloudRate;
                });
                try {
                  localStorage.setItem('pos_cached_exchange_rate', String(cloudRate));
                  localStorage.setItem('pos_exchange_rate', String(cloudRate));
                } catch (_) {}
                console.log('[MobilePOSSimulator] ☁️ Tasa actualizada desde Supabase Cloud:', cloudRate);
              }
            }
          }
        } catch (_cErr) {}
      }`;

// Normalizar CRLF
const normContent = content.replace(/\r\n/g, '\n');
const normTarget1 = target1.replace(/\r\n/g, '\n');
const normReplacement1 = replacement1.replace(/\r\n/g, '\n');

if (normContent.includes(normTarget1)) {
  let updated = normContent.replace(normTarget1, normReplacement1);

  // 2. Inyectar polling de Supabase en useEffect si no hay socket
  const target2 = `    const stopAutoSyncDaemon = syncManager.startAutoSync(15000);`;
  const replacement2 = `    const stopAutoSyncDaemon = syncManager.startAutoSync(15000);

    // Sondeo periódico de tasa en Supabase cuando el teléfono esté con datos móviles (desconectado del socket local)
    const cloudPollingTimer = setInterval(() => {
      const isSocketConnected = lanSyncService.isConnected() || socketContext?.connected;
      if (!isSocketConnected) {
        loadSettings();
      }
    }, 20000);`;

  const normTarget2 = target2.replace(/\r\n/g, '\n');
  const normReplacement2 = replacement2.replace(/\r\n/g, '\n');
  if (updated.includes(normTarget2)) {
    updated = updated.replace(normTarget2, normReplacement2);
    // Limpiar timer en cleanup
    updated = updated.replace('stopAutoSyncDaemon();', 'stopAutoSyncDaemon();\n      clearInterval(cloudPollingTimer);');
    console.log('POLLING_INJECTED');
  }

  // Guardar con formato original
  fs.writeFileSync(filePath, updated.replace(/\n/g, '\r\n'), 'utf8');
  console.log('SUCCESSFULLY_PATCHED_MOBILE_POS_SIMULATOR');
} else {
  console.log('TARGET_1_NOT_FOUND');
}
