/**
 * SemanticSearchService.js
 * Motor Híbrido de Búsqueda Semántica con IA y Trigramas en PostgreSQL 16.
 * Utiliza embeddings vectoriales de Gemini (text-embedding-004) con extensión pgvector
 * e índice HNSW, con conmutación por error a pg_trgm difuso sin fricción.
 */

const { sequelize } = require('../database/connection');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class SemanticSearchService {
    constructor() {
        this.genAI = null;
        this.embeddingModel = null;
        this.isPgVectorAvailable = false;
        this.checkedAvailability = false;
    }

    /**
     * Inicializa el cliente de Gemini para generación de embeddings
     */
    initAI() {
        const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (apiKey && apiKey.trim() !== '') {
            try {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
            } catch (err) {
                console.warn('[SemanticSearch] Error inicializando modelo de embeddings:', err.message);
            }
        }
    }

    /**
     * Verifica si la extensión pgvector está habilitada en la base de datos
     */
    async checkVectorSupport() {
        if (this.checkedAvailability) return this.isPgVectorAvailable;
        try {
            const [extRes] = await sequelize.query("SELECT 1 FROM pg_extension WHERE extname = 'vector';");
            this.isPgVectorAvailable = extRes.length > 0;
            this.checkedAvailability = true;
        } catch (_e) {
            this.isPgVectorAvailable = false;
            this.checkedAvailability = true;
        }
        return this.isPgVectorAvailable;
    }

    /**
     * Genera el vector embedding (dimensión 768) de un texto usando Gemini
     */
    async generateEmbedding(text) {
        if (!text || typeof text !== 'string' || text.trim() === '') return null;
        if (!this.embeddingModel) this.initAI();
        if (!this.embeddingModel) return null;

        try {
            const cleanText = text.trim().slice(0, 500);
            const result = await this.embeddingModel.embedContent(cleanText);
            return result?.embedding?.values || null;
        } catch (err) {
            console.warn('[SemanticSearch] Error generando embedding:', err.message);
            return null;
        }
    }

    /**
     * Búsqueda híbrida de productos: Vectorial (si está activa) o Trigramas (pg_trgm)
     */
    async searchProducts(query, companyId = '2', limit = 10) {
        if (!query || typeof query !== 'string') return [];
        const cleanQuery = query.trim();
        const hasVector = await this.checkVectorSupport();

        // 1. Ruta de alta inteligencia con pgvector si está activo y hay API Key de Gemini
        if (hasVector) {
            const queryVector = await this.generateEmbedding(cleanQuery);
            if (queryVector && Array.isArray(queryVector)) {
                try {
                    const vectorStr = `[${queryVector.join(',')}]`;
                    const [vectorResults] = await sequelize.query(`
                        SELECT 
                            id, 
                            name, 
                            barcode, 
                            price, 
                            "stockQuantity", 
                            category, 
                            principio_activo,
                            ROUND((1 - (embedding <=> :vectorStr::vector))::numeric, 4) AS score
                        FROM "Products"
                        WHERE "companyId" = :companyId
                          AND embedding IS NOT NULL
                        ORDER BY embedding <=> :vectorStr::vector ASC
                        LIMIT :limit;
                    `, {
                        replacements: {
                            vectorStr,
                            companyId: String(companyId),
                            limit: parseInt(limit, 10) || 10
                        }
                    });

                    if (vectorResults && vectorResults.length > 0) {
                        return vectorResults.map(p => ({
                            ...p,
                            matchType: 'SEMANTIC_VECTOR'
                        }));
                    }
                } catch (vErr) {
                    console.warn('[SemanticSearch] Fallback a trigramas por error en consulta vectorial:', vErr.message);
                }
            }
        }

        // 2. Ruta de alto rendimiento por trigramas (pg_trgm + unaccent)
        try {
            const [trgmResults] = await sequelize.query(`
                SELECT 
                    id, 
                    name, 
                    barcode, 
                    price, 
                    "stockQuantity", 
                    category, 
                    principio_activo,
                    ROUND(similarity(public.immutable_unaccent(lower(name)), public.immutable_unaccent(lower(:query)))::numeric, 4) AS score
                FROM "Products"
                WHERE "companyId" = :companyId
                  AND (
                      public.immutable_unaccent(lower(name)) % public.immutable_unaccent(lower(:query))
                      OR public.immutable_unaccent(lower(COALESCE(principio_activo, ''))) % public.immutable_unaccent(lower(:query))
                      OR barcode ILIKE :wildcard
                      OR public.immutable_unaccent(lower(name)) ILIKE public.immutable_unaccent(lower(:wildcard))
                  )
                ORDER BY score DESC, "stockQuantity" DESC
                LIMIT :limit;
            `, {
                replacements: {
                    query: cleanQuery,
                    wildcard: `%${cleanQuery}%`,
                    companyId: String(companyId),
                    limit: parseInt(limit, 10) || 10
                }
            });

            return (trgmResults || []).map(p => ({
                ...p,
                matchType: 'SYNTACTIC_TRIGRAM'
            }));
        } catch (tErr) {
            console.error('[SemanticSearch] Error en búsqueda por trigramas:', tErr.message);
            return [];
        }
    }
}

const service = new SemanticSearchService();
module.exports = service;
