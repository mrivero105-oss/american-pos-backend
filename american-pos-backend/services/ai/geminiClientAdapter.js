const { GoogleGenAI } = require('@google/genai');

const DEFAULT_PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_FALLBACK_MODEL = 'gemini-4-hydrogen';

const DEPRECATED_MODEL_PATTERN = /^(?:models\/)?(?:gemini-(?:1\.5|2\.0|2\.5)-|gemini-3\.1-flash-lite|gemini-3\.5-flash$|gemini-3\.7-flash$|gemini-3-flash-preview)/i;

/**
 * Normaliza un nombre de modelo Gemini y migra automáticamente identificadores deprecados
 * (p. ej. gemini-2.5-flash-lite / gemini-2.5-flash / gemini-2.0-flash heredados en .env viejos)
 * hacia modelos vigentes para evitar errores 404 NOT_FOUND en producción.
 */
function normalizeGeminiModelName(rawModel, { vision = false } = {}) {
    const clean = typeof rawModel === 'string' ? rawModel.trim().replace(/^models\//i, '') : '';
    if (!clean) return '';
    if (DEPRECATED_MODEL_PATTERN.test(clean)) {
        const mapped = vision ? DEFAULT_PRIMARY_MODEL : DEFAULT_PRIMARY_MODEL;
        console.warn(`[ISAAC AI] Modelo Gemini deprecado detectado ("${clean}"), redirigiendo automáticamente a "${mapped}".`);
        return mapped;
    }
    return clean;
}

/**
 * Normaliza entradas de contenido (string, Part, o arreglo mixto de strings y { inlineData })
 * al formato de partes estructuradas esperado por @google/genai v3 (generateContent).
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
 * Convierte partes estilo inlineData/text al formato Content de la Interactions API v1beta.
 */
function toInteractionContentParts(input) {
    const list = Array.isArray(input) ? input : [input];
    const parts = [];
    for (const part of list) {
        if (part === null || part === undefined) continue;
        if (typeof part === 'string') {
            parts.push({ type: 'text', text: part });
            continue;
        }
        if (typeof part === 'object') {
            if (typeof part.type === 'string') {
                parts.push(part);
                continue;
            }
            if (part.inlineData && part.inlineData.data) {
                const mime = String(part.inlineData.mimeType || 'application/octet-stream').toLowerCase();
                let blockType = 'document';
                if (mime.startsWith('image/')) blockType = 'image';
                else if (mime.startsWith('audio/')) blockType = 'audio';
                else if (mime.startsWith('video/')) blockType = 'video';
                parts.push({
                    type: blockType,
                    data: part.inlineData.data,
                    mime_type: mime
                });
                continue;
            }
            if (typeof part.text === 'string') {
                parts.push({ type: 'text', text: part.text });
            }
        }
    }
    return parts;
}

function toInteractionInput(input) {
    if (typeof input === 'string') {
        return input;
    }
    const parts = toInteractionContentParts(input);
    if (parts.length === 1 && parts[0].type === 'text') {
        return parts[0].text;
    }
    return parts;
}

function toInteractionSteps(history = [], nextMessage = null) {
    const steps = [];
    if (Array.isArray(history)) {
        for (const item of history) {
            if (!item || typeof item !== 'object') continue;
            const role = String(item.role || '').toLowerCase();
            const stepType = role === 'model' || role === 'assistant' ? 'model_output' : 'user_input';
            const contentParts = toInteractionContentParts(item.parts || item.content || []);
            if (contentParts.length > 0) {
                steps.push({ type: stepType, content: contentParts });
            }
        }
    }
    if (nextMessage !== null && nextMessage !== undefined) {
        const msgParts = toInteractionContentParts(nextMessage);
        if (msgParts.length > 0) {
            steps.push({ type: 'user_input', content: msgParts });
        }
    }
    return steps;
}

/**
 * Extrae el texto generado desde la respuesta de Interactions API o generateContent de @google/genai v3.
 */
function extractResponseText(response) {
    if (!response) return '';
    if (typeof response.output_text === 'string') {
        return response.output_text;
    }
    if (Array.isArray(response.steps)) {
        const textChunks = [];
        for (const step of response.steps) {
            if (step?.type === 'model_output' && Array.isArray(step.content)) {
                for (const block of step.content) {
                    if (block?.type === 'text' && typeof block.text === 'string') {
                        textChunks.push(block.text);
                    }
                }
            }
        }
        if (textChunks.length > 0) {
            return textChunks.join('');
        }
    }
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

/**
 * Sanitiza parámetros de muestreo deprecados en Gemini 3.5+ / Gemini 4 (temperature, top_p, top_k).
 */
function sanitizeGenerationConfig(generationConfig = {}) {
    if (!generationConfig || typeof generationConfig !== 'object') return {};
    const sanitized = { ...generationConfig };
    delete sanitized.temperature;
    delete sanitized.topP;
    delete sanitized.top_p;
    delete sanitized.topK;
    delete sanitized.top_k;
    return sanitized;
}

function buildConfig({ systemInstruction, generationConfig } = {}) {
    const cfg = sanitizeGenerationConfig(generationConfig);
    if (systemInstruction !== undefined && systemInstruction !== null && systemInstruction !== '') {
        cfg.systemInstruction = systemInstruction;
    }
    return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function buildInteractionRequest({ model, input, systemInstruction, generationConfig, stream = false } = {}) {
    const safeGenCfg = sanitizeGenerationConfig(generationConfig);
    const req = {
        model,
        input,
        store: false
    };
    if (stream) {
        req.stream = true;
    }
    if (systemInstruction !== undefined && systemInstruction !== null && systemInstruction !== '') {
        req.system_instruction = typeof systemInstruction === 'string'
            ? systemInstruction
            : String(systemInstruction);
    }
    if (safeGenCfg.responseMimeType === 'application/json' || safeGenCfg.response_mime_type === 'application/json') {
        req.response_format = {
            type: 'text',
            mime_type: 'application/json',
            ...(safeGenCfg.responseSchema ? { schema: safeGenCfg.responseSchema } : {})
        };
    }
    const interGenCfg = {};
    if (typeof safeGenCfg.maxOutputTokens === 'number' && safeGenCfg.maxOutputTokens > 0) {
        interGenCfg.max_output_tokens = safeGenCfg.maxOutputTokens;
    } else if (typeof safeGenCfg.max_output_tokens === 'number' && safeGenCfg.max_output_tokens > 0) {
        interGenCfg.max_output_tokens = safeGenCfg.max_output_tokens;
    }
    if (safeGenCfg.thinkingLevel || safeGenCfg.thinking_level) {
        interGenCfg.thinking_level = safeGenCfg.thinkingLevel || safeGenCfg.thinking_level;
    }
    if (Object.keys(interGenCfg).length > 0) {
        req.generation_config = interGenCfg;
    }
    return req;
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
 * Devuelve una lista ordenada y deduplicada de modelos Gemini vigentes (3.5 Flash-Lite + 4 Hydrogen),
 * remapeando automáticamente modelos legacy/deprecados (gemini-2.5/2.0/1.5) para evitar 404.
 */
function getCandidateModels({ preferred = null, vision = false } = {}) {
    const rawList = vision
        ? [preferred, process.env.GEMINI_VISION_MODEL, DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODEL]
        : [preferred, process.env.GEMINI_MODEL, DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODEL];
    const seen = new Set();
    const out = [];
    for (const item of rawList) {
        const clean = normalizeGeminiModelName(item, { vision });
        if (clean && !seen.has(clean)) {
            seen.add(clean);
            out.push(clean);
        }
    }
    return out;
}

/**
 * Envuelve una promesa con timeout garantizando clearTimeout en finally (cero fugas de timers).
 */
async function withTimeout(promise, timeoutMs = 8000, label = 'Timeout') {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} (${timeoutMs}ms)`)), timeoutMs);
                if (timer && typeof timer.unref === 'function') timer.unref();
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Adaptador centralizado sobre el SDK oficial @google/genai (^3.6.1).
 * Prioriza la Interactions API (v1beta, store: false) para texto, visión/PDF, audio y streaming,
 * con compatibilidad automática hacia atrás si un mock de pruebas solo implementa models.generateContent.
 */
function createGeminiClient(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new Error('apiKey de Gemini requerida para inicializar geminiClientAdapter.');
    }

    const ClientCtor = options.GoogleGenAIClass || GoogleGenAI;
    const rawClient = new ClientCtor({ apiKey: apiKey.trim(), apiVersion: 'v1beta' });
    const defaultModel = normalizeGeminiModelName(options.defaultModel || process.env.GEMINI_MODEL) || DEFAULT_PRIMARY_MODEL;
    const hasInteractionsApi = Boolean(rawClient?.interactions && typeof rawClient.interactions.create === 'function');

    async function generateContent({ model = defaultModel, contents, systemInstruction, generationConfig } = {}) {
        const targetModel = normalizeGeminiModelName(model) || defaultModel;

        if (hasInteractionsApi) {
            const req = buildInteractionRequest({
                model: targetModel,
                input: toInteractionInput(contents),
                systemInstruction,
                generationConfig
            });
            const raw = await rawClient.interactions.create(req);
            return wrapResponse(raw);
        }

        const config = buildConfig({ systemInstruction, generationConfig });
        const payload = {
            model: targetModel,
            contents: normalizeContents(contents)
        };
        if (config) {
            payload.config = config;
        }
        const raw = await rawClient.models.generateContent(payload);
        return wrapResponse(raw);
    }

    async function* generateContentStream({ model = defaultModel, contents, systemInstruction, generationConfig } = {}) {
        const targetModel = normalizeGeminiModelName(model) || defaultModel;

        if (hasInteractionsApi) {
            const req = buildInteractionRequest({
                model: targetModel,
                input: toInteractionInput(contents),
                systemInstruction,
                generationConfig,
                stream: true
            });
            const stream = await rawClient.interactions.create(req);
            for await (const event of stream) {
                if (event?.event_type === 'step.delta' && event?.delta?.type === 'text' && event.delta.text) {
                    yield event.delta.text;
                } else {
                    const fallbackText = extractResponseText(event);
                    if (fallbackText) yield fallbackText;
                }
            }
            return;
        }

        const config = buildConfig({ systemInstruction, generationConfig });
        const payload = {
            model: targetModel,
            contents: normalizeContents(contents)
        };
        if (config) {
            payload.config = config;
        }
        if (rawClient.models && typeof rawClient.models.generateContentStream === 'function') {
            const stream = await rawClient.models.generateContentStream(payload);
            for await (const chunk of stream) {
                const text = extractResponseText(chunk);
                if (text) yield text;
            }
            return;
        }
        const single = await generateContent({ model: targetModel, contents, systemInstruction, generationConfig });
        if (single.text) yield single.text;
    }

    function createChat({ model = defaultModel, systemInstruction, history = [], generationConfig } = {}) {
        const targetModel = normalizeGeminiModelName(model) || defaultModel;

        if (hasInteractionsApi) {
            const localHistory = Array.isArray(history) ? [...history] : [];
            return {
                async sendMessage(message) {
                    const steps = toInteractionSteps(localHistory, message);
                    const req = buildInteractionRequest({
                        model: targetModel,
                        input: steps,
                        systemInstruction,
                        generationConfig
                    });
                    const raw = await rawClient.interactions.create(req);
                    const wrapped = wrapResponse(raw);
                    localHistory.push({ role: 'user', parts: toInteractionContentParts(message) });
                    if (wrapped.text) {
                        localHistory.push({ role: 'model', parts: [{ type: 'text', text: wrapped.text }] });
                    }
                    return wrapped;
                },
                getHistory: () => [...localHistory]
            };
        }

        const config = buildConfig({ systemInstruction, generationConfig });
        const chatParams = {
            model: targetModel,
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
        const targetModel = normalizeGeminiModelName(model) || defaultModel;
        return {
            model: targetModel,
            generateContent: (contents) => generateContent({
                model: targetModel,
                contents,
                systemInstruction,
                generationConfig
            }),
            generateContentStream: (contents) => generateContentStream({
                model: targetModel,
                contents,
                systemInstruction,
                generationConfig
            }),
            startChat: ({ history = [], generationConfig: chatGenConfig } = {}) => createChat({
                model: targetModel,
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
        generateContentStream,
        createChat,
        getGenerativeModel
    };
}

module.exports = {
    DEFAULT_PRIMARY_MODEL,
    DEFAULT_FALLBACK_MODEL,
    normalizeGeminiModelName,
    createGeminiClient,
    normalizeContents,
    toInteractionContentParts,
    toInteractionSteps,
    extractResponseText,
    getCandidateModels,
    withTimeout
};
