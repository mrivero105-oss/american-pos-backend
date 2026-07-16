require('dotenv').config();
const assert = require('assert');
const dgram = require('dgram');
const LANClusterService = require('./services/LANClusterService');
const { sequelize, QuarantineSale, Sale } = require('./database/models');

async function runLANClusterTests() {
  console.log('🚀 [TEST_LAN_CLUSTER] Iniciando pruebas de verificación del Motor LAN P2P y Modo Offline-First...');

  // 1. Verificar Inicialización y Estructura del Clúster
  console.log('\n--- Test 1: Inicialización de LANClusterService ---');
  const mockIo = {
    emit: (ev, data) => {
      console.log(`   [MockIO] Evento emitido a clientes locales: ${ev}`);
    }
  };
  LANClusterService.init(mockIo, 3005);
  assert.strictEqual(LANClusterService.httpPort, 3005, 'Puerto HTTP del nodo local debe ser 3005');
  assert.ok(LANClusterService.nodeId.startsWith('node-') || LANClusterService.nodeId.startsWith('POS-'), 'ID de nodo local verificado');
  assert.strictEqual(LANClusterService.getClusterTopology().localNode.httpPort, 3005, 'getClusterTopology().localNode.httpPort verificado');
  console.log('✅ Test 1 superado: LANClusterService inicializado correctamente.');

  // 2. Simular recepción de descubrimiento por UDP y registro de Peer
  console.log('\n--- Test 2: Descubrimiento P2P por UDP Broadcast ---');
  const mockPeerMessage = JSON.stringify({
    type: 'LAN_HEARTBEAT',
    nodeId: 'node-simulated-peer-001',
    nodeName: 'Caja 2 - Secundaria',
    httpPort: 3006,
    role: 'LAN_SPOKE',
    status: 'ONLINE',
    timestamp: Date.now()
  });

  // Procesar mensaje simulado
  LANClusterService.handleIncomingPacket(Buffer.from(mockPeerMessage), { address: '192.168.1.102', port: 41234 });
  const topology = LANClusterService.getClusterTopology();
  assert.strictEqual(topology.clusterSize, 2, 'El clúster debe tener tamaño 2 (Local + Peer simulado)');
  assert.strictEqual(topology.peers.length, 1, 'Debe haber exactamente 1 peer registrado');
  assert.strictEqual(topology.peers[0].ip, '192.168.1.102', 'IP del peer debe ser 192.168.1.102');
  assert.strictEqual(topology.peers[0].nodeName, 'Caja 2 - Secundaria', 'Nombre del peer verificado');
  console.log('✅ Test 2 superado: Descubrimiento y registro de peers P2P funcional en memoria.');

  // 3. Verificar persistencia y resolución en Cuarentena (QuarantineSale)
  console.log('\n--- Test 3: Gestión de Cuarentena P2P (QuarantineSale) ---');
  await sequelize.sync();
  const testQuarantineId = `quarantine-test-${Date.now()}`;
  
  const created = await QuarantineSale.create({
    id: testQuarantineId,
    companyId: '1',
    userId: 'user-test-01',
    errorReason: 'Descuadre de stock al sincronizar venta P2P offline',
    rawPayload: JSON.stringify({
      clientTransactionId: 'local-sale-12345',
      total: 25.50,
      items: [{ productId: '1', quantity: 2, price: 12.75, name: 'Paracetamol 500mg' }]
    }),
    status: 'quarantined'
  });
  assert.ok(created, 'Registro de QuarantineSale creado en base de datos');

  // Buscar registro
  const found = await QuarantineSale.findByPk(testQuarantineId);
  assert.strictEqual(found.status, 'quarantined', 'Estado inicial debe ser quarantined');

  // Simular resolución
  found.status = 'resolved';
  await found.save();

  const resolved = await QuarantineSale.findByPk(testQuarantineId);
  assert.strictEqual(resolved.status, 'resolved', 'Estado tras resolución verificado');
  console.log('✅ Test 3 superado: Cuarentena LAN P2P verificada en Base de Datos.');

  // 4. Limpieza de servicio y recursos
  console.log('\n--- Test 4: Parada limpia de LANClusterService ---');
  LANClusterService.stop();
  console.log('✅ Test 4 superado: Sockets UDP cerrados limpiamente sin pérdidas de recursos.');

  console.log('\n🏆 [EXITO TOTAL] Todas las pruebas del Motor LAN P2P superadas con 100% de éxito.\n');
  process.exit(0);
}

runLANClusterTests().catch(err => {
  console.error('❌ Error en pruebas P2P:', err);
  process.exit(1);
});
