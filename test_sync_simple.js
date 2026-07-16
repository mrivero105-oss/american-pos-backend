// Script simple para probar la sincronización del móvil sin dependencias externas

const http = require('http');

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve({
                        statusCode: res.statusCode,
                        data: parsed
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        data: responseData
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

async function testServerHealth() {
    console.log('1. Probando salud del servidor...');
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/hello',
            method: 'GET'
        });
        
        console.log('   ✅ Servidor funcionando:', response.data);
        return true;
    } catch (error) {
        console.log('   ❌ Error:', error.message);
        return false;
    }
}

async function testLogin() {
    console.log('\n2. Probando login...');
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, {
            email: 'admin@example.com', // Cambia esto
            password: 'password' // Cambia esto
        });
        
        console.log('   ✅ Respuesta del login:', response.statusCode);
        console.log('   Data:', JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200 && response.data.token) {
            return response.data.token;
        }
        return null;
    } catch (error) {
        console.log('   ❌ Error en login:', error.message);
        return null;
    }
}

async function testPublicSync(token, companyId = '1') {
    console.log('\n3. Probando sincronización pública...');
    try {
        const syncData = {
            sales: [
                {
                    id: 'test-mobile-sale-001',
                    customerId: '1',
                    customerName: 'Cliente Test Móvil',
                    total: 100.50,
                    items: [
                        {
                            id: 'item-001',
                            productId: '1',
                            name: 'Producto Test',
                            quantity: 2,
                            price: 50.25
                        }
                    ]
                }
            ]
        };
        
        const response = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/sales/public-sync',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-company-id': companyId
            }
        }, syncData);
        
        console.log('   ✅ Respuesta de sincronización:', response.statusCode);
        console.log('   Data:', JSON.stringify(response.data, null, 2));
        return response.statusCode === 200;
    } catch (error) {
        console.log('   ❌ Error en sincronización:', error.message);
        return false;
    }
}

async function testPublicList(token, companyId = '1') {
    console.log('\n4. Probando obtención de lista pública...');
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/sales/public-list',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-company-id': companyId
            }
        });
        
        console.log('   ✅ Respuesta de lista:', response.statusCode);
        console.log('   Data:', response.data ? `Array con ${Array.isArray(response.data) ? response.data.length : '?'} elementos` : 'No data');
        return response.statusCode === 200;
    } catch (error) {
        console.log('   ❌ Error obteniendo lista:', error.message);
        return false;
    }
}

async function runTests() {
    console.log('=== PRUEBAS DE SINCRONIZACIÓN MÓVIL ===\n');
    
    // 1. Verificar servidor
    const serverOk = await testServerHealth();
    if (!serverOk) {
        console.log('\n❌ El servidor no está funcionando. No se puede continuar.');
        return;
    }
    
    // 2. Probar login
    const token = await testLogin();
    if (!token) {
        console.log('\n⚠️ Login fallido. Esto podría ser porque las credenciales son incorrectas.');
        console.log('   Puedes probar manualmente:');
        console.log('   POST http://localhost:3005/auth/login');
        console.log('   Body: { "email": "tu-email", "password": "tu-password" }');
        
        // Probar sincronización sin token (solo con headers)
        console.log('\n5. Probando sincronización sin token (solo con headers)...');
        await testPublicSync('dummy-token', '1');
        return;
    }
    
    // 3. Probar sincronización con token
    const syncOk = await testPublicSync(token, '1');
    
    // 4. Probar obtención de lista
    const listOk = await testPublicList(token, '1');
    
    console.log('\n=== RESUMEN ===');
    console.log('Servidor:', serverOk ? '✅' : '❌');
    console.log('Login:', token ? '✅' : '❌');
    console.log('Sincronización:', syncOk ? '✅' : '❌');
    console.log('Lista de ventas:', listOk ? '✅' : '❌');
    
    console.log('\n=== POSIBLES SOLUCIONES ===');
    console.log('1. Verifica que el dispositivo móvil tenga acceso a la red local (mismo WiFi).');
    console.log('2. Verifica que la IP del servidor sea correcta en la app móvil.');
    console.log('3. Revisa los logs del servidor para ver errores específicos.');
    console.log('4. Verifica que el usuario tenga permisos adecuados en la empresa.');
    console.log('5. Prueba reiniciar tanto el servidor como la app móvil.');
}

// Ejecutar pruebas
runTests().catch(console.error);