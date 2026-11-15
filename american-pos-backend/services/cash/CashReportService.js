const { sequelize } = require('../../database/connection');
const precision = require('../../utils/precision');

module.exports = {
    /**
     * Genera la estructura visual del reporte Z en texto plano (ESC/POS compatible)
     */
    generateZReportText(shift, data) {
        const { userName, declared, expected, differences, stats, totalExpenses, hash, auditStatus, itemsSummary } = data;
        const now = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
        
        const line = (label, value) => `${label.padEnd(22)}${String(value).padStart(10)}`;
        const separator = "--------------------------------";
        const doubleSeparator = "================================";

        let t = "";
        t += `${doubleSeparator}\n`;
        t += "        CIERRE DE CAJA        \n";
        t += `${doubleSeparator}\n\n`;

        t += `Caja:    ${shift.registerId || '01'}\n`;
        t += `Cajero:  ${userName}\n`;
        t += `Turno:   ${shift.id.substring(0, 8)}\n`;
        t += `Fecha:   ${now}\n\n`;

        t += `${separator}\n`;
        t += "APERTURA\n";
        t += `${separator}\n`;
        t += line("Fondo Inicial:", `$${Number(shift.initialAmount || 0).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "VENTAS DEL TURNO\n";
        t += `${separator}\n`;
        t += line("Efectivo USD:", `$${Number(stats.cashSalesTotal || 0).toFixed(2)}\n`);
        
        // Desglose digital si aplica
        Object.entries(expected).forEach(([method, val]) => {
            if (method === 'usd' || method === 'ves') return;
            if (val === 0) return;
            const label = method.charAt(0).toUpperCase() + method.slice(1);
            const prefix = (method === 'zelle') ? '$' : 'Bs';
            t += line(`${label}:`, `${prefix} ${Number(val).toFixed(2)}\n`);
        });
        t += "\n";

        t += `${separator}\n`;
        t += "GASTOS DE CAJA\n";
        t += `${separator}\n`;
        t += line("Total Gastos:", `$${Number(totalExpenses).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "MONTO ESPERADO\n";
        t += `${separator}\n`;
        t += line("USD Esperado:", `$${Number(expected.usd).toFixed(2)}\n`);
        t += line("VES Esperado:", `Bs ${Number(expected.ves).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "DECLARACIÓN CAJERO\n";
        t += `${separator}\n`;
        t += line("USD Declarado:", `$${Number(declared.usd).toFixed(2)}\n`);
        t += line("VES Declarado:", `Bs ${Number(declared.ves).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "DIFERENCIA\n";
        t += `${separator}\n`;
        const diffUSD = differences.usd;
        const diffVES = differences.ves;
        t += line("USD:", `${diffUSD >= 0 ? '+' : ''}${diffUSD.toFixed(2)}\n`);
        t += line("VES:", `${diffVES >= 0 ? '+' : ''}Bs ${diffVES.toFixed(2)}\n\n`);

        if (auditStatus === 'MISCLASSIFICATION') {
            t += `${doubleSeparator}\n`;
            t += "  ! ERROR DE CLASIFICACIÓN !  \n";
            t += " Dinero completo, métodos mal  \n";
            t += " seleccionados durante el día. \n";
            t += `${doubleSeparator}\n\n`;
        } else if (auditStatus === 'MISMATCH') {
            t += `${doubleSeparator}\n`;
            t += "  ! DIFERENCIA DETECTADA !  \n";
            t += `${doubleSeparator}\n\n`;
        } else {
            t += `${doubleSeparator}\n`;
            t += "      CUADRE PERFECTO       \n";
            t += `${doubleSeparator}\n\n`;
        }

        t += `${separator}\n`;
        t += "HASH DE AUDITORÍA\n";
        t += `${separator}\n`;
        t += `${hash.substring(0, 32)}...\n\n`;

        if (Array.isArray(itemsSummary) && itemsSummary.length > 0) {
            t += `${separator}\n`;
            t += "MERCANCÍA VENDIDA Y STOCK\n";
            t += `${separator}\n`;
            let totalSold = 0;
            itemsSummary.forEach(item => {
                const pres = item.presentationName ? ` (${item.presentationName})` : '';
                const nameStr = `${item.name}${pres}`.substring(0, 32);
                const sold = Number(item.quantitySold || 0).toFixed(2);
                const stock = Number(item.stockInPresentations !== undefined ? item.stockInPresentations : (item.currentStock || 0)).toFixed(2);
                totalSold += Number(item.quantitySold || 0);

                t += `${nameStr}\n`;
                t += `    Vend: ${sold.padEnd(8)} | Quedan: ${stock}\n`;
            });
            t += `${separator}\n`;
            t += `Total Renglones: ${itemsSummary.length}\n`;
            t += `Total Unidades: ${totalSold.toFixed(2)}\n\n`;
        }

        t += `${separator}\n`;
        t += "FIRMA CAJERO: _______________\n\n";
        t += "FIRMA SUPERVISOR: ___________\n\n";

        t += `${doubleSeparator}\n`;
        t += "    FIN DEL REPORTE (Z)       \n";
        t += `${doubleSeparator}\n`;

        return t;
    },

    /**
     * Genera el Reporte Diario de Auditoría (Resumen para el Dueño)
     */
    async generateDailyAuditReport(reqUser, dateStr) {
        const { companyId } = reqUser;
        const { CashDeclaration, CashShift, User } = require('../../database/models');
        const { Op } = require('sequelize');
        const puppeteer = require('puppeteer');

        const baseDate = dateStr ? new Date(`${String(dateStr).slice(0, 10)}T00:00:00`) : new Date();
        const startOfDay = new Date(new Date(baseDate).setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(new Date(baseDate).setHours(23, 59, 59, 999)).toISOString();

        // 1. Obtener todas las declaraciones del día
        const declarations = await CashDeclaration.findAll({
            where: {
                companyId,
                createdAt: { [Op.between]: [startOfDay, endOfDay] }
            },
            include: [{ model: CashShift, as: 'Shift' }],
            order: [['createdAt', 'ASC']]
        });

        if (declarations.length === 0) {
            throw new Error('No hay cierres registrados para la fecha seleccionada.');
        }

        // Resolver nombres de cajeros para el reporte PDF
        const userIds = [...new Set(declarations.map(d => d.userId).filter(Boolean))];
        const usersList = userIds.length > 0
            ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name', 'username'] })
            : [];
        const userNameById = new Map(usersList.map(u => [String(u.id), u.name || u.username || `Cajero ${u.id}`]));

        // 2. Calcular Métricas Agregadas
        const totalLossUSD = precision.add(declarations.map(d => Number(d.differenceUSD) < 0 ? Number(d.differenceUSD) : 0));
        const totalOverageUSD = precision.add(declarations.map(d => Number(d.differenceUSD) > 0 ? Number(d.differenceUSD) : 0));
        const netBalanceUSD = precision.add([totalLossUSD, totalOverageUSD]);

        // 3. Agrupar por Cajero
        const cashierMap = {};
        declarations.forEach(d => {
            if (!cashierMap[d.userId]) {
                const resolvedName = d.userName || d.Shift?.cashierName || userNameById.get(String(d.userId)) || `Cajero #${d.userId}`;
                cashierMap[d.userId] = { name: resolvedName, loss: 0, shifts: 0, matches: 0 };
            }
            cashierMap[d.userId].loss = precision.add([cashierMap[d.userId].loss, d.differenceUSD]);
            cashierMap[d.userId].shifts++;
            if (Number(d.differenceUSD) === 0 && Number(d.differenceVES) === 0) {
                cashierMap[d.userId].matches++;
            }
        });

        // 4. Determinar Semáforo
        let statusColor = '#10b981'; // Green
        let statusText = 'OPERACIÓN LIMPIA';
        if (netBalanceUSD < 0) {
            statusColor = '#ef4444'; // Red
            statusText = 'PÉRDIDA DETECTADA';
        } else if (netBalanceUSD > 0 || declarations.some(d => d.Shift?.status === 'forced_closed')) {
            statusColor = '#f59e0b'; // Amber
            statusText = 'RIESGO OPERATIVO';
        }

        // 5. Construir HTML para Puppeteer
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; color: #1e293b; padding: 40px; }
                .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; }
                .status-badge { 
                    display: inline-block; padding: 10px 20px; border-radius: 12px; 
                    color: white; font-weight: 900; text-transform: uppercase; letter-spacing: 2px;
                    background-color: ${statusColor};
                }
                .section { margin-bottom: 30px; }
                .section-title { font-size: 10px; font-weight: 900; color: #64748b; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px; border-left: 4px solid #3b82f6; padding-left: 10px; }
                .metric-card { background: #f8fafc; padding: 20px; border-radius: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
                .metric-label { font-weight: 700; color: #475569; }
                .metric-value { font-size: 20px; font-weight: 900; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th { text-align: left; font-size: 10px; text-transform: uppercase; color: #64748b; padding: 10px; border-bottom: 1px solid #e2e8f0; }
                td { padding: 12px 10px; font-size: 13px; border-bottom: 1px solid #f1f5f9; font-weight: 600; }
                .loss { color: #ef4444; }
                .match { color: #10b981; }
                .footer { margin-top: 50px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; }
                .insight { background: #fffbeb; border: 1px solid #fef3c7; padding: 15px; border-radius: 12px; margin-bottom: 10px; font-size: 13px; color: #92400e; font-weight: 600; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="status-badge">${statusText}</div>
                <h1 style="margin-top: 20px; font-weight: 900; letter-spacing: -1px;">REPORTE DIARIO DE AUDITORÍA</h1>
                <p style="font-weight: 700; color: #64748b;">${new Date(startOfDay).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

            <div class="section">
                <div class="section-title">Resultado General</div>
                <div class="metric-card">
                    <span class="metric-label">Balance Neto del Día</span>
                    <span class="metric-value ${netBalanceUSD < 0 ? 'loss' : 'match'}">${netBalanceUSD < 0 ? '-' : ''}$${Math.abs(netBalanceUSD).toFixed(2)}</span>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Análisis de Cajeros</div>
                <table>
                    <thead>
                        <tr>
                            <th>Cajero</th>
                            <th>Turnos</th>
                            <th>Precisión</th>
                            <th style="text-align: right;">Diferencia</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.values(cashierMap).map(c => `
                            <tr>
                                <td>${c.name}</td>
                                <td>${c.shifts}</td>
                                <td>${Math.round((c.matches / c.shifts) * 100)}%</td>
                                <td style="text-align: right;" class="${c.loss < 0 ? 'loss' : c.loss > 0 ? 'match' : ''}">
                                    ${c.loss > 0 ? '+' : ''}$${c.loss.toFixed(2)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <div class="section-title">Historial de Cierres</div>
                <table>
                    <thead>
                        <tr>
                            <th>Hora</th>
                            <th>Turno</th>
                            <th>Estado</th>
                            <th style="text-align: right;">Diferencia</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${declarations.map(d => `
                            <tr>
                                <td>${new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                <td>#${d.shiftId.substring(0, 8)}</td>
                                <td>${d.Shift?.status === 'forced_closed' ? '⚠️ FORZADO' : 'CERRADO'}</td>
                                <td style="text-align: right;" class="${Number(d.differenceUSD) < 0 ? 'loss' : Number(d.differenceUSD) > 0 ? 'match' : ''}">
                                    $${Number(d.differenceUSD).toFixed(2)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="footer">
                <p>Generado automáticamente por Isaac POS - Capa de Auditoría Antifraude</p>
                <p>Hash de Integridad del Día: ${(declarations[declarations.length - 1].hash || 'IMMUTABLE-LEDGER-SEAL').substring(0, 32)}</p>
            </div>
        </body>
        </html>
        `;

        // 6. Generar PDF con Puppeteer utilizando Chrome/Edge disponible
        const fs = require('fs');
        const candidatePaths = [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        ].filter(Boolean);

        let execPath = null;
        for (const p of candidatePaths) {
            try {
                if (fs.existsSync(p)) {
                    execPath = p;
                    break;
                }
            } catch (e) {}
        }

        const launchOptions = { 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
        };
        if (execPath) {
            launchOptions.executablePath = execPath;
        }

        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await browser.close();

        return Buffer.from(pdfBuffer);
    },
};
