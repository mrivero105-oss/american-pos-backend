const { GoogleGenAI } = require('@google/genai');

/**
 * Normaliza entradas de contenido (string, Part, o arreglo mixto de strings y { inlineData })
 * al formato de partes estructuradas esperado por @google/genai v3.
 */
function normalizeContents(input) {
    if (typeof input === 'string') {
        return input;
    }
    if (Array.isArray(input)) {
        return input
            .filter((part) => part !== null && part !== undefined)
            .map((part) => {
                if (typeof part === 'string') {
                    return { text: part };
                }
                if (part && typeof part === 'object') {
                    if (part.inlineData) {
                        return {
                            inlineData: {
                                data: part.inlineData.data,
                                mimeType: part.inlineData.mimeType
                            }
                        };
                    }
                    if (typeof part.text === 'string') {
                        return { text: part.text };
                    }
                }
                return part;
            });
    }
    return input;
}

/**
 * Extrae el texto generado desde la respuesta de @google/genai v3 de forma resiliente.
 */
function extractResponseText(response) {
    if (!response) return '';
    if (typeof response.text === 'string') {
        return response.text;
    }
    if (typeof response.text === 'function') {
        return String(response.text() || '');
    }
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
        return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    }
    return '';
}

function buildConfig({ systemInstruction, generationConfig } = {}) {
    const cfg = {};
    if (generationConfig && typeof generationConfig === 'object') {
        Object.assign(cfg, generationConfig);
    }
    if (systemInstruction !== undefined && systemInstruction !== null && systemInstruction !== '') {
        cfg.systemInstruction = systemInstruction;
    }
    return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function wrapResponse(raw) {
    const textValue = extractResponseText(raw);
    return {
        text: textValue,
        raw,
        response: {
            text: () => textValue
        }
    };
}

/**
 * Adaptador centralizado sobre el SDK oficial @google/genai (^3.6.1).
 * Acepta `GoogleGenAIClass` opcional para inyección en pruebas unitarias sin tráfico de red.
 */
function createGeminiClient(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new Error('apiKey de Gemini requerida para inicializar geminiClientAdapter.');
    }

    const ClientCtor = options.GoogleGenAIClass || GoogleGenAI;
    const rawClient = new ClientCtor({ apiKey: apiKey.trim() });
    const defaultModel = options.defaultModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

    async function generateContent({ model = defaultModel, contents, systemInstruction, generationConfig } = {}) {
        const config = buildConfig({ systemInstruction, generationConfig });
        const payload = {
            model,
            contents: normalizeContents(contents)
        };
        if (config) {
            payload.config = config;
        }
        const raw = await rawClient.models.generateContent(payload);
        return wrapResponse(raw);
    }

    function createChat({ model = defaultModel, systemInstruction, history = [], generationConfig } = {}) {
        const config = buildConfig({ systemInstruction, generationConfig });
        const chatParams = {
            model,
            history: Array.isArray(history) ? history : []
        };
        if (config) {
            chatParams.config = config;
        }
        const chat = rawClient.chats.create(chatParams);

        return {
            async sendMessage(message) {
                const raw = await chat.sendMessage({
                    message: normalizeContents(message)
                });
                return wrapResponse(raw);
            },
            getHistory: typeof chat.getHistory === 'function' ? () => chat.getHistory() : () => []
        };
    }

    function getGenerativeModel({ model = defaultModel, systemInstruction, generationConfig } = {}) {
        return {
            model,
            generateContent: (contents) => generateContent({
                model,
                contents,
                systemInstruction,
                generationConfig
            }),
            startChat: ({ history = [], generationConfig: chatGenConfig } = {}) => createChat({
                model,
                systemInstruction,
                history,
                generationConfig: { ...(generationConfig || {}), ...(chatGenConfig || {}) }
            })
        };
    }

    return {
        rawClient,
        defaultModel,
        generateContent,
        createChat,
        getGenerativeModel
    };
}

module.exports = {
    createGeminiClient,
    normalizeContents,
    extractResponseText
};
