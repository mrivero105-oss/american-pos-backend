const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = new Sequelize(
    process.env.DB_NAME || 'americanpos',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false
    }
);

async function setupOutbox() {
    try {
        console.log('[OUTBOX SETUP] Conectando a PostgreSQL local...');
        await sequelize.authenticate();
        console.log('[OUTBOX SETUP] Conectado exitosamente.');

        console.log('[OUTBOX SETUP] Creando tabla sync_outbox...');
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS sync_outbox (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                entity_name VARCHAR(50) NOT NULL,
                entity_id VARCHAR(100) NOT NULL,
                operation VARCHAR(10) NOT NULL DEFAULT 'INSERT',
                payload JSONB NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                retry_count INT DEFAULT 0,
                last_error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                synced_at TIMESTAMPTZ
            );
        `);

        console.log('[OUTBOX SETUP] Creando índices...');
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending 
            ON sync_outbox(created_at ASC) 
            WHERE status = 'PENDING';
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity 
            ON sync_outbox(entity_name, entity_id);
        `);

        // Comprobación
        const [result] = await sequelize.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'sync_outbox';
        `);

        if (result.length > 0) {
            console.log('✅ TABLA_SYNC_OUTBOX_CREADA_CON_EXITO');
        } else {
            throw new Error('La tabla no aparece en information_schema');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ ERROR_SETUP_OUTBOX:', error.message);
        process.exit(1);
    }
}

setupOutbox();
