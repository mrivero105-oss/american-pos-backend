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
                logger.warn(`[LAN_CLUSTER] UDP Socket error (${err.message}). Re-intentando enlace de descubrimiento en 5s...`);
                try { this.socket.close(); } catch (e) {}
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                if (this.pruneInterval) clearInterval(this.pruneInterval);
                setTimeout(() => {
                    this.isInitialized = false;
                    this.init(this.io, this.httpPort);
                }, 5000);
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
     * Calcula firma HMAC-SHA256 para paquetes de descubrimiento UDP en LAN.
     */
    computePacketSignature({ type, nodeId, ip, httpPort, role, timestamp }) {
        const crypto = require('crypto');
        const secret = process.env.LAN_CLUSTER_SECRET || 'isaac_pos_lan_cluster_hmac_v1';
        const canonical = `${type}|${nodeId}|${ip}|${httpPort}|${role}|${timestamp}`;
        return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    }

    /**
     * Envía latido de descubrimiento UDP a la red local (Broadcast 255.255.255.255 o loopback).
     */
    sendHeartbeat() {
        if (!this.socket) return;
        const ts = Date.now();
        const ip = this.getLocalIP();
        const sig = this.computePacketSignature({
            type: 'LAN_HEARTBEAT',
            nodeId: this.nodeId,
            ip,
            httpPort: this.httpPort,
            role: this.role,
            timestamp: ts
        });
        const payload = JSON.stringify({
            type: 'LAN_HEARTBEAT',
            nodeId: this.nodeId,
            nodeName: this.nodeName,
            ip,
            httpPort: this.httpPort,
            role: this.role,
            timestamp: ts,
            status: 'ONLINE',
            sig
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
            if (!data.nodeId || typeof data.nodeId !== 'string' || data.nodeId.length > 128) return;
            if (data.nodeId === this.nodeId) return; // Ignorar propio latido

            // Verificar firma HMAC-SHA256 del paquete UDP para prevenir Server Spoofing en LAN
            const expectedSig = this.computePacketSignature({
                type: data.type,
                nodeId: data.nodeId,
                ip: data.ip,
                httpPort: data.httpPort,
                role: data.role,
                timestamp: data.timestamp
            });
            if (!data.sig || data.sig !== expectedSig) {
                logger.warn(`[LAN_CLUSTER] Paquete UDP rechazado desde ${rinfo.address}: firma HMAC inválida.`);
                return;
            }

            const peerKey = `${data.nodeId}`;
            const existing = this.peers.get(peerKey);
            const isNew = !existing;

            const safePort = parseInt(data.httpPort, 10);
            const validPort = (!isNaN(safePort) && safePort > 0 && safePort <= 65535) ? safePort : rinfo.port;
            const safeNodeName = String(data.nodeName || `Caja (${rinfo.address})`).replace(/[<>"']/g, '').slice(0, 64);
            const safeIp = String(data.ip || rinfo.address).replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45);

            const peerInfo = {
                nodeId: data.nodeId,
                nodeName: safeNodeName,
                ip: safeIp,
                httpPort: validPort,
                role: data.role === 'MASTER_CLOUD_HUB' ? 'MASTER_CLOUD_HUB' : 'LAN_SPOKE',
                status: data.status === 'ONLINE' ? 'ONLINE' : 'ONLINE',
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
