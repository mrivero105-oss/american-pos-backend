// Script para probar sincronización con firma HMAC correcta

const crypto = require('crypto');
const http = require('http');

const SYNC_SECRET = 'AMERICAN_POS_SYNC_SECRET_KEY_2024'; // Debe coincidir con .env

function generateHMAC(timestamp, bodyString) {
    const payload = `${timestamp}.${bodyString}`;
    const hmac = crypto.createHmac('sha256', SYNC_SECRET);
    hmac.update(payload);
    return hmac.digest('hex');
}

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
            req.write(data);
        }
        
        req.end();
    });
}

async function testPublicSyncWithHMAC() {
    console.log('=== PRUEBA DE SINCRONIZACIÓN CON FIRMA HMAC ===\n');
    
    const syncData = {
        sales: [
            {
                id: 'test-mobile-sale-' + Date.now(),
                customerId: '1',
                customerName: 'Cliente Test Móvil',
                total: 100.50,
                items: [
                    {
                        id: 'item-' + Date.now(),
                        productId: '1',
                        name: 'Producto Test',
                        quantity: 2,
                        price: 50.25
                    }
                ]
            }
        ]
    };
    
    const bodyString = JSON.stringify(syncData);
    const timestamp = Date.now().toString();
    const signature = generateHMAC(timestamp, bodyString);
    
    console.log('Datos de prueba:');
    console.log('- Timestamp:', timestamp);
    console.log('- Body length:', bodyString.length);
    console.log('- Signature:', signature.substring(0, 20) + '...');
    console.log('- Company ID: 1');
    
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/sales/public-sync',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-company-id': '1',
                'x-sync-timestamp': timestamp,
                'x-sync-signature': signature
            }
        }, bodyString);
        
        console.log('\n✅ Respuesta del servidor:');
        console.log('- Status:', response.statusCode);
        console.log('- Data:', JSON.stringify(response.data, null, 2));
        
        return response.statusCode === 200;
    } catch (error) {
        console.log('\n❌ Error:', error.message);
        return false;
    }
}

async function testPublicListWithToken() {
    console.log('\n=== PRUEBA DE OBTENCIÓN DE LISTA CON TOKEN ===\n');
    
    // Primero necesitamos un token válido. Vamos a intentar obtener uno.
    // Necesitamos credenciales reales. Voy a intentar con valores por defecto.
    
    const loginData = {
        email: 'admin@example.com',
        password: 'admin123' // Intento común
    };
    
    try {
        console.log('Intentando login...');
        const loginResponse = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, JSON.stringify(loginData));
        
        console.log('Respuesta login:', loginResponse.statusCode);
        
        if (loginResponse.statusCode === 200 && loginResponse.data.token) {
            const token = loginResponse.data.token;
            console.log('Token obtenido:', token.substring(0, 20) + '...');
            
            // Ahora probar obtener la lista
            const listResponse = await makeRequest({
                hostname: 'localhost',
                port: 3005,
                path: '/sales/public-list',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-company-id': '1'
                }
            });
            
            console.log('\n✅ Respuesta de lista:');
            console.log('- Status:', listResponse.statusCode);
            console.log('- Tiene datos:', Array.isArray(listResponse.data));
            
            return listResponse.statusCode === 200;
        } else {
            console.log('Login fallido. Prueba manual:');
            console.log('POST http://localhost:3005/auth/login');
            console.log('Body: { "email": "tu-email", "password": "tu-password" }');
            return false;
        }
    } catch (error) {
        console.log('Error:', error.message);
        return false;
    }
}

async function testWithoutHMAC() {
    console.log('\n=== PRUEBA SIN FIRMA HMAC (para comparar) ===\n');
    
    const syncData = {
        sales: []
    };
    
    const bodyString = JSON.stringify(syncData);
    
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: 3005,
            path: '/sales/public-sync',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-company-id': '1'
                // Sin headers de firma HMAC
            }
        }, bodyString);
        
        console.log('Respuesta sin HMAC:');
        console.log('- Status:', response.statusCode);
        console.log('- Data:', JSON.stringify(response.data, null, 2));
        
        return response.statusCode;
    } catch (error) {
        console.log('Error:', error.message);
        return null;
    }
}

async function runAllTests() {
    console.log('🚀 INICIANDO PRUEBAS DE SINCRONIZACIÓN MÓVIL\n');
    
    console.log('1. Probando sincronización SIN firma HMAC:');
    const withoutHMAC = await testWithoutHMAC();
    
    console.log('\n2. Probando sincronización CON firma HMAC:');
    const withHMAC = await testPublicSyncWithHMAC();
    
    console.log('\n3. Probando obtención de lista con token:');
    const listTest = await testPublicListWithToken();
    
    console.log('\n=== RESUMEN FINAL ===');
    console.log('Sincronización sin HMAC:', withoutHMAC === 401 ? '❌ Falló (esperado)' : `✅ ${withoutHMAC} (inesperado)`);
    console.log('Sincronización con HMAC:', withHMAC ? '✅ Éxito' : '❌ Falló');
    console.log('Lista con token:', listTest ? '✅ Éxito' : '❌ Falló');
    
    console.log('\n=== RECOMENDACIONES ===');
    if (!withHMAC) {
        console.log('1. Verifica que SYNC_SECRET_KEY en .env sea: AMERICAN_POS_SYNC_SECRET_KEY_2024');
        console.log('2. Revisa los logs del servidor para ver errores específicos');
        console.log('3. Verifica que el servidor esté escuchando en el puerto correcto');
        console.log('4. Prueba con la app móvil y revisa la consola del navegador (F12)');
    }
    
    if (withHMAC) {
        console.log('\n🎉 ¡La sincronización con HMAC funciona!');
        console.log('El problema podría estar en:');
        console.log('1. La app móvil no está generando la firma HMAC correctamente');
        console.log('2. La app móvil está usando un SYNC_SECRET diferente');
        console.log('3. Problemas de red entre el móvil y el servidor');
        console.log('4. La app móvil necesita reiniciarse o reinstalarse');
    }
}

// Ejecutar pruebas
runAllTests().catch(console.error);