const dgram = require('dgram');
const os = require('os');
const SecurityHelper = require('./SecurityHelper');
const logger = require('../utils/logger');

class LANClusterService {
    constructor() {
        this.socket = null;
        this.udpPort = parseInt(process.env.LAN_UDP_PORT || '41234', 10);
        this.httpPort = null;
        this.io = null;
        this.nodeId = `POS-${os.hostname()}-${Math.floor(1000 + Math.random() * 9000)}`;
        this.nodeName = process.env.POS_TERMINAL_NAME || `Caja ${os.hostname()}`;
        this.role = process.env.POS_NODE_ROLE || 'LAN_SPOKE'; // 'MASTER_CLOUD_HUB' vs 'LAN_SPOKE'
        this.peers = new Map(); // Map<nodeId, { nodeId, nodeName, ip, httpPort, role, lastSeen, status }>
        this.heartbeatInterval = null;
        this.pruneInterval = null;
        this.isInitialized = false;
    }

    /**
     * Devuelve la primera dirección IPv4 no interna de la máquina local.
     */
    getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }

    /**
     * Inicializa el servicio LAN Cluster con UDP Broadcast y Socket.io.
     * @param {Object} io - Instancia de Socket.io (o virtualIo hub)
     * @param {number} httpPort - Puerto HTTP de esta instancia
     */
    async init(io, httpPort) {
        if (this.isInitialized) return;
        this.io = io;
        this.httpPort = httpPort;

        try {
            this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            this.socket.on('error', (err) => {
                logger.warn(`[LAN_CLUSTER] UDP Socket error (${err.message}). Re-intentando enlace de descubrimiento...`);
                try { this.socket.close(); } catch (e) {}
            });

            this.socket.on('message', (msg, rinfo) => {
                this.handleIncomingPacket(msg, rinfo);
            });

            // Enlazar socket UDP
            this.socket.bind(this.udpPort, () => {
                this.socket.setBroadcast(true);
                logger.info(`[LAN_CLUSTER] 🌐 Nodo P2P inicializado en UDP Port ${this.udpPort} (IP: ${this.getLocalIP()}) -> NodeID: ${this.nodeId}`);
            });
        } catch (err) {
            logger.error(`[LAN_CLUSTER] Error al enlazar socket UDP: ${err.message}`);
        }

        // Iniciar bucle de latido (heartbeat) cada 8 segundos
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 8000);

        // Limpiar peers desconectados cada 12 segundos (stale tras 25s)
        this.pruneInterval = setInterval(() => {
            this.pruneStalePeers();
        }, 12000);

        this.isInitialized = true;
    }

    /**
     * Envía latido de descubrimiento UDP a la red local (Broadcast 255.255.255.255 o loopback).
     */
    sendHeartbeat() {
        if (!this.socket) return;
        const payload = JSON.stringify({
            type: 'LAN_HEARTBEAT',
            nodeId: this.nodeId,
            nodeName: this.nodeName,
            ip: this.getLocalIP(),
            httpPort: this.httpPort,
            role: this.role,
            timestamp: Date.now(),
            status: 'ONLINE'
        });

        const buffer = Buffer.from(payload);
        try {
            // Enviar a la dirección de difusión LAN
            this.socket.send(buffer, 0, buffer.length, this.udpPort, '255.255.255.255', (err) => {
                if (err && err.code !== 'EPERM' && err.code !== 'ENETUNREACH') {
                    // Ignore minor broadcast rejections on restricted Windows interfaces
                }
            });
            // También enviar a loopback (127.0.0.1) para pruebas multi-puerto en el mismo PC
            this.socket.send(buffer, 0, buffer.length, this.udpPort, '127.0.0.1', () => {});
        } catch (e) {
            // Ignore socket closed
        }
    }

    /**
     * Procesa paquetes UDP recibidos en LAN.
     */
    handleIncomingPacket(msg, rinfo) {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type !== 'LAN_HEARTBEAT') return;
            if (data.nodeId === this.nodeId) return; // Ignorar propio latido

            const peerKey = `${data.nodeId}`;
            const existing = this.peers.get(peerKey);
            const isNew = !existing;

            const peerInfo = {
                nodeId: data.nodeId,
                nodeName: data.nodeName || `Caja (${rinfo.address})`,
                ip: data.ip || rinfo.address,
                httpPort: data.httpPort || rinfo.port,
                role: data.role || 'LAN_SPOKE',
                status: data.status || 'ONLINE',
                lastSeen: Date.now()
            };

            this.peers.set(peerKey, peerInfo);

            if (isNew) {
                logger.info(`[LAN_CLUSTER] 🖥️ Nuevo nodo LAN descubierto: ${peerInfo.nodeName} (${peerInfo.ip}:${peerInfo.httpPort}) [${peerInfo.nodeId}]`);
                this.notifyTopologyChange();
            }
        } catch (err) {
            // Malformed UDP packet ignored
        }
    }

    /**
     * Elimina nodos que no han enviado latido en los últimos 25 segundos.
     */
    pruneStalePeers() {
        const now = Date.now();
        let changed = false;
        for (const [key, peer] of this.peers.entries()) {
            if (now - peer.lastSeen > 25000) {
                logger.info(`[LAN_CLUSTER] ⚠️ Nodo LAN desconectado o inactivo: ${peer.nodeName} [${peer.nodeId}]`);
                this.peers.delete(key);
                changed = true;
            }
        }
        if (changed) {
            this.notifyTopologyChange();
        }
    }

    /**
     * Emite evento de cambio en la topología a los clientes locales vía Socket.io.
     */
    notifyTopologyChange() {
        if (!this.io) return;
        const peersList = this.getPeers();
        this.io.emit('lan_peer_list_changed', {
            clusterSize: peersList.length + 1, // Peers + local node
            peers: peersList,
            localNode: {
                nodeId: this.nodeId,
                nodeName: this.nodeName,
                ip: this.getLocalIP(),
                httpPort: this.httpPort,
                role: this.role
            }
        });
    }

    /**
     * Obtiene la lista limpia de peers activos en el clúster local.
     */
    getPeers() {
        return Array.from(this.peers.values());
    }

    /**
     * Obtiene la estructura consolidada de la topología del clúster LAN local.
     */
    getClusterTopology() {
        const peersList = this.getPeers();
        return {
            clusterSize: peersList.length + 1,
            peers: peersList,
            localNode: {
                nodeId: this.nodeId,
                nodeName: this.nodeName,
                ip: this.getLocalIP(),
                httpPort: this.httpPort,
                role: this.role
            },
            isInitialized: this.isInitialized
        };
    }

    /**
     * Propaga un evento transaccional P2P (ej. actualización de stock o nueva venta) a todos los sockets conectados.
     */
    broadcastLANEvent(eventName, payload) {
        if (!this.io) return;
        try {
            const enrichedPayload = {
                ...payload,
                sourceNodeId: this.nodeId,
                broadcastTimestamp: Date.now()
            };
            this.io.emit(eventName, enrichedPayload);
            logger.info(`[LAN_CLUSTER] 📡 Evento P2P propagado a LAN -> ${eventName}`);
        } catch (err) {
            logger.error(`[LAN_CLUSTER] Error emitiendo evento P2P ${eventName}: ${err.message}`);
        }
    }

    /**
     * Detiene el socket y temporizadores (útil para pruebas o apagado del sistema).
     */
    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.pruneInterval) clearInterval(this.pruneInterval);
        if (this.socket) {
            try { this.socket.close(); } catch (e) {}
            this.socket = null;
        }
        this.peers.clear();
        this.isInitialized = false;
    }
}

// Export singleton instance
module.exports = new LANClusterService();
