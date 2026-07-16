const { Sale } = require('../database/models');
const precision = require('../utils/precision');

class SriService {
    /**
     * Calcula el dígito verificador Módulo 11 oficial para el SRI de Ecuador.
     * @param {string} key48 Los primeros 48 dígitos de la clave de acceso.
     * @returns {number} Dígito verificador obtenido (0-9).
     */
    calculateModulo11(key48) {
        if (!key48 || key48.length !== 48) {
            throw new Error('El argumento debe constar exactamente de 48 caracteres numéricos.');
        }

        let sum = 0;
        let factor = 2;

        // Recorrer de derecha a izquierda
        for (let i = 47; i >= 0; i--) {
            const digit = parseInt(key48.charAt(i), 10);
            sum += digit * factor;
            
            factor++;
            if (factor > 7) {
                factor = 2; // Reiniciar factor en 2 al llegar a 7
            }
        }

        const residuo = sum % 11;
        let checkDigit = 11 - residuo;

        if (checkDigit === 11) {
            checkDigit = 0;
        } else if (checkDigit === 10) {
            checkDigit = 1;
        }

        return checkDigit;
    }

    /**
     * Genera la Clave de Acceso oficial de 49 dígitos para el SRI.
     * @param {Object} sale El registro de venta.
     * @param {Object} settings Ajustes del negocio (para RUC, serie, establecimiento, ambiente).
     * @returns {string} Clave de acceso generada de 49 dígitos.
     */
    generateAccessKey(sale, settings) {
        // 1. Fecha de Emisión (DDMMAAAA)
        // Intentar parsear la fecha de la venta
        let dateStr = '23052026'; // Fallback
        try {
            const dateObj = new Date(sale.date || sale.timestamp || new Date());
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            dateStr = `${day}${month}${year}`;
        } catch (e) {
            console.error('[SRI] Error formateando fecha para clave de acceso:', e);
        }

        // 2. Tipo de Comprobante: '01' para Factura
        const tipoComprobante = '01';

        // 3. RUC del Emisor (13 dígitos)
        // Eliminar guiones, letras y pad con ceros
        const bizRuc = (settings.businessInfo?.rif || settings.businessInfo?.ruc || '1790011122001')
            .replace(/[^0-9]/g, '');
        const ruc = bizRuc.substring(0, 13).padStart(13, '0');

        // 4. Tipo de Ambiente: '1' para Pruebas, '2' para Producción
        const ambiente = settings.taxConfig?.sriEnvironment === 'production' ? '2' : '1';

        // 5. Serie (6 dígitos): Establecimiento (3) + Punto de Emisión (3)
        // Ejemplo: '001001'
        const establishment = String(settings.taxConfig?.sriEstablishment || '001').padStart(3, '0');
        const pointOfEmission = String(settings.taxConfig?.sriPointOfEmission || '001').padStart(3, '0');
        const serie = `${establishment}${pointOfEmission}`;

        // 6. Secuencial (9 dígitos)
        // Tomar el ID numérico de la venta o un número incremental limpio
        // Si el ID es un UUID, extraemos los últimos dígitos numéricos o usamos el contador
        let sequentialNum = '1';
        if (sale.id) {
            const numsOnly = sale.id.replace(/[^0-9]/g, '');
            if (numsOnly.length >= 9) {
                sequentialNum = numsOnly.substring(numsOnly.length - 9);
            } else if (numsOnly.length > 0) {
                sequentialNum = numsOnly;
            } else {
                // Generador pseudo-aleatorio basado en el timestamp de la venta
                sequentialNum = String(new Date(sale.date || sale.timestamp).getTime() % 1000000000);
            }
        }
        const secuencial = String(sequentialNum).padStart(9, '0');

        // 7. Código Numérico (8 dígitos): Código de control aleatorio
        // Usamos un hash numérico fijo basado en el ID de la venta para garantizar la idempotencia
        let controlNum = 12345678;
        if (sale.id) {
            let hash = 0;
            for (let i = 0; i < sale.id.length; i++) {
                hash = sale.id.charCodeAt(i) + ((hash << 5) - hash);
            }
            controlNum = Math.abs(hash) % 100000000;
        }
        const codigoNumerico = String(controlNum).padStart(8, '0');

        // 8. Tipo de Emisión: '1' para Emisión Normal
        const tipoEmision = '1';

        // Unir los 48 dígitos iniciales
        const key48 = `${dateStr}${tipoComprobante}${ruc}${ambiente}${serie}${secuencial}${codigoNumerico}${tipoEmision}`;

        // 9. Calcular dígito verificador
        const digitoVerificador = this.calculateModulo11(key48);

        // Clave completa
        const accessKey = `${key48}${digitoVerificador}`;
        
        console.log(`[SRI] Clave de Acceso Generada (${accessKey.length} dígitos): ${accessKey}`);
        return accessKey;
    }

    /**
     * Genera un XML simulado (Mock) en formato oficial del SRI para Ecuador.
     */
    generateInvoiceXml(sale, settings, accessKey) {
        const ruc = accessKey.substring(10, 23);
        const estab = accessKey.substring(24, 27);
        const ptoEmi = accessKey.substring(27, 30);
        const secuencial = accessKey.substring(30, 39);
        const ambiente = accessKey.substring(23, 24);

        const clientName = sale.customerName || 'Cliente Ocasional';
        // En Ecuador, RUC genérico para consumidor final es 9999999999999
        const clientIdentifier = sale.customerId || '9999999999999'; 

        // Detalle de impuestos
        const ivaRate = settings.taxConfig?.ivaRate || 15.0;
        const exemptBase = Number(sale.taxInfo?.exemptBase || 0);
        const taxableBase = Number(sale.taxInfo?.taxableBase || 0);
        const taxVal = Number(sale.tax || 0);

        return `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>${ambiente}</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>${settings.businessInfo?.name || 'Mi Negocio POS'}</razonSocial>
    <nombreComercial>${settings.businessInfo?.name || 'Mi Negocio'}</nombreComercial>
    <ruc>${ruc}</ruc>
    <claveAcceso>${accessKey}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>${estab}</estab>
    <ptoEmi>${ptoEmi}</ptoEmi>
    <secuencial>${secuencial}</secuencial>
    <dirMatriz>${settings.businessInfo?.address || 'Ecuador'}</dirMatriz>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>${accessKey.substring(0, 2)}/${accessKey.substring(2, 4)}/${accessKey.substring(4, 8)}</fechaEmision>
    <dirEstablecimiento>${settings.businessInfo?.address || 'Ecuador'}</dirEstablecimiento>
    <obligadoContabilidad>NO</obligadoContabilidad>
    <tipoIdentificacionComprador>${clientIdentifier.length === 10 ? '05' : clientIdentifier === '9999999999999' ? '07' : '04'}</tipoIdentificacionComprador>
    <razonSocialComprador>${clientName}</razonSocialComprador>
    <identificacionComprador>${clientIdentifier}</identificacionComprador>
    <totalSinImpuestos>${(Number(sale.subtotal) - Number(sale.discount)).toFixed(2)}</totalSinImpuestos>
    <totalDescuento>${Number(sale.discount).toFixed(2)}</totalDescuento>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>${ivaRate === 15 ? '4' : '2'}</codigoPorcentaje>
        <baseImponible>${taxableBase.toFixed(2)}</baseImponible>
        <valor>${taxVal.toFixed(2)}</valor>
      </totalImpuesto>
    </totalConImpuestos>
    <importeTotal>${Number(sale.total).toFixed(2)}</importeTotal>
    <moneda>DOLAR</moneda>
  </infoFactura>
</factura>`;
    }

    /**
     * Procesa la facturación asíncronamente simulando el envío y autorización ante el SRI de Ecuador.
     * @param {Object} sale Registro de la venta creado en Sequelize.
     * @param {Object} settings Ajustes del negocio.
     */
    async processInvoice(sale, settings) {
        try {
            console.log(`[SRI] Iniciando procesamiento fiscal de la venta ${sale.id} para Ecuador...`);
            
            // 1. Generar la Clave de Acceso
            const accessKey = this.generateAccessKey(sale, settings);
            
            // 2. Generar el XML de la Factura
            const xmlContent = this.generateInvoiceXml(sale, settings, accessKey);
            
            // 3. Simular la firma digital y envío al SRI (Ambiente de Pruebas / Recepción)
            console.log('[SRI] Firmando XML digitalmente con clave de pruebas...');
            console.log('[SRI] Enviando a Web Service: RecepciónComprobantesOffline...');
            
            // Simular retraso de red de 250ms
            await new Promise(resolve => setTimeout(resolve, 250));
            
            console.log('[SRI] SRI RECEPCIÓN: RECIBIDO CORRECTAMENTE (ESTADO: RECIBIDA)');
            console.log('[SRI] Enviando a Web Service: AutorizaciónComprobantesOffline...');
            
            // Simular retraso de procesamiento del SRI de 200ms
            await new Promise(resolve => setTimeout(resolve, 200));

            console.log(`[SRI] SRI AUTORIZACIÓN: AUTORIZADO CORRECTAMENTE. CLAVE: ${accessKey}`);

            // 4. Actualizar el registro en la base de datos de manera definitiva
            const sriAuthorizationDate = new Date().toISOString();
            
            // Guardamos localmente el XML (en una base de producción aquí se subiría a AWS S3 o servidor estático)
            // Para fines de desarrollo local simularemos un enlace de descarga
            const sriXmlUrl = `data:text/xml;charset=utf-8,${encodeURIComponent(xmlContent)}`;

            await Sale.update({
                sriAccessKey: accessKey,
                sriStatus: 'authorized',
                sriAuthorizationDate,
                sriXmlUrl
            }, {
                where: { id: sale.id }
            });

            console.log(`[SRI] Venta ${sale.id} fiscalizada con éxito en base de datos.`);
        } catch (error) {
            console.error('[SRI] Fallo crítico al procesar facturación electrónica de Ecuador:', error.message);
            // Intentar registrar el fallo en el estado de la venta
            try {
                await Sale.update({
                    sriStatus: 'rejected'
                }, {
                    where: { id: sale.id }
                });
            } catch (dbErr) {
                console.error('[SRI] No se pudo actualizar el estado fallido del SRI en DB:', dbErr);
            }
        }
    }
}

module.exports = new SriService();
