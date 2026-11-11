const fs = require('fs');
const path = require('path');

const targetFiles = [
    'C:\\Users\\mrive\\AppData\\Roaming\\isaac-pos\\settings.json',
    'C:\\AndroidStudioProjects\\American POS PC\\american-pos-backend\\settings.json',
    'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS Ultra\\settings.json'
];

targetFiles.forEach(file => {
    if (!fs.existsSync(file)) {
        console.log('Skipping non-existent:', file);
        return;
    }
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const settings = JSON.parse(raw);

        // Update company '2' and 'default'
        const targets = ['2', 'default'];
        targets.forEach(key => {
            if (settings[key]) {
                const comp = settings[key];
                if (comp.businessInfo) {
                    comp.businessInfo.pagoMovilBank = '0102';
                    comp.businessInfo.pagoMovilPhone = '04248302226';
                    comp.businessInfo.pagoMovilId = 'V22650692';
                    comp.businessInfo.pagoMovilQrMode = 'AUTO';
                    if (!comp.businessInfo.phone || comp.businessInfo.phone.includes('/')) {
                        comp.businessInfo.phone = '04248302226';
                    }
                }
                if (Array.isArray(comp.paymentMethods)) {
                    comp.paymentMethods = comp.paymentMethods.map(m => {
                        if (m.id === 'pago_movil') {
                            return {
                                ...m,
                                name: 'Pago Móvil BDV',
                                pagoMovilBank: '0102',
                                pagoMovilPhone: '04248302226',
                                pagoMovilId: 'V22650692',
                                pagoMovilQrMode: 'AUTO',
                                pagoMovilQrImage: m.pagoMovilQrImage || ''
                            };
                        }
                        return m;
                    });
                }
            }
        });

        fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
        console.log('Successfully updated:', file);
    } catch (e) {
        console.error('Error updating', file, e.message);
    }
});
