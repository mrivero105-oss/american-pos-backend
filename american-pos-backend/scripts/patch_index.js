const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.js');
let content = fs.readFileSync(file, 'utf8');

const target = "BCVAutoSyncService.init(virtualIo);\n                } catch (bcvErr) {\n                    console.warn('⚠️ Error al iniciar BCVAutoSyncService:', bcvErr.message);\n                }";
const insertion = target + "\n\n                // Initialize Supabase Cloud Sync Worker (Outbox Processor 24/7)\n                try {\n                    const SupabaseSyncService = require('./services/SupabaseSyncService');\n                    SupabaseSyncService.start(15000);\n                    console.log('✅ Supabase Cloud Sync Worker iniciado (24/7).');\n                } catch (syncWorkerErr) {\n                    console.warn('⚠️ Error al iniciar SupabaseSyncService:', syncWorkerErr.message);\n                }";

if (content.includes(target)) {
    content = content.replace(target, insertion);
    fs.writeFileSync(file, content, 'utf8');
    console.log('INDEX_JS_PATCHED_SUCCESSFULLY');
} else {
    console.error('Target string not found in index.js');
    process.exit(1);
}
