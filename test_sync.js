// Script para probar la sincronización del móvil

const axios = require('axios');

async function testLogin() {
    try {
        console.log('Probando login...');
        const response = await axios.post('http://localhost:3005/auth/login', {
            email: 'admin@example.com', // Cambia esto según tus credenciales
            password: 'password' // Cambia esto según tus credenciales
        });
        
        console.log('Login exitoso:', response.data);
        return response.data.token;
    } catch (error) {
        console.error('Error en login:', error.response?.data || error.message);
        return null;
    }
}

async function testSync(token, companyId) {
    try {
        console.log('\nProbando sincronización...');
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

        const response = await axios.post('http://localhost:3005/sales/public-sync', syncData, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-company-id': companyId,
                'Content-Type': 'application/json'
            }
        });

        console.log('Sincronización exitosa:', response.data);
        return true;
    } catch (error) {
        console.error('Error en sincronización:', error.response?.data || error.message);
        return false;
    }
}

async function testPublicList(token, companyId) {
    try {
        console.log('\nProbando obtención de lista de ventas...');
        const response = await axios.get('http://localhost:3005/sales/public-list', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-company-id': companyId
            }
        });

        console.log('Lista obtenida exitosamente:', response.data.length, 'ventas');
        return true;
    } catch (error) {
        console.error('Error obteniendo lista:', error.response?.data || error.message);
        return false;
    }
}

async function runTests() {
    console.log('=== PRUEBAS DE SINCRONIZACIÓN MÓVIL ===\n');
    
    // Primero probar login
    const token = await testLogin();
    if (!token) {
        console.log('Login fallido. No se puede continuar con las pruebas.');
        return;
    }

    // Para propósitos de prueba, asumimos companyId = 1
    const companyId = '1';
    
    // Probar sincronización
    const syncSuccess = await testSync(token, companyId);
    
    // Probar obtención de lista
    const listSuccess = await testPublicList(token, companyId);
    
    console.log('\n=== RESUMEN ===');
    console.log('Login:', token ? 'Éxito' : 'Fallido');
    console.log('Sincronización:', syncSuccess ? 'Éxito' : 'Fallido');
    console.log('Obtención de lista:', listSuccess ? 'Éxito' : 'Fallido');
}

// Ejecutar pruebas si se llama directamente
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { testLogin, testSync, testPublicList };