/**
 * productFamilies.js
 * Utilidades para detectar y agrupar productos que corresponden a una misma
 * familia pero difieren en gramaje o presentación (ej: Café 50g, 100g, 200g).
 * Permite mantener el inventario individual e independiente de cada SKU/paquete
 * mientras unifica la experiencia visual en el POS y Estaciones de Venta.
 */

// Regex para detectar gramajes o volúmenes comunes (aislados o pegados)
const GRAM_VOLUME_REGEX = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(k?g|gr|gramos?|kilos?|ml|l|lt|litros?|cc|oz|lb)(?:\s|$|[),.-])/i;

// Regex para detectar tamaños descriptivos textuales (Pequeño, Mediano, Grande, etc.)
const SIZE_WORDS_REGEX = /(?:^|\s)(pequeñ[oa]s?|median[oa]s?|grandes?|chic[oa]s?|mini|maxi|familiar(?:es)?|personal(?:es)?|individual(?:es)?)(?:\s|$|[),.-])/i;

// Regex para detectar calibres o tipos explícitos (ej: Tipo A, Tipo B, Tipo AA, Tipo AAA, Clase A, Calibre 1)
const TYPE_REGEX = /(?:^|\s|\()(?:tipo|clase|grado|calibre)\s+([A-D]{1,4}|[0-9]{1,4}|jumbo|extra|super)\b(?:\s|\)|$|[),.-])/i;

// Regex para productos donde el calibre de letra está directamente ligado a la palabra huevo/huevos (ej: "Huevos A", "Huevos AA", "Huevos B")
const DIRECT_EGG_GRADE_REGEX = /(?:^|\s)(?:huevos?)\s+([A-D]{1,3}|jumbo|extra)\b(?:\s|\)|$|[),.-])/i;

/**
 * Normaliza la unidad de medida o tamaño y extrae el peso ordenable
 */
export function parsePresentation(name = '') {
    if (!name || typeof name !== 'string') return null;

    let label = null;
    let sortWeight = 0;
    let baseName = name;

    const gramMatch = name.match(GRAM_VOLUME_REGEX);
    if (gramMatch) {
        const rawNumber = gramMatch[1].replace(',', '.');
        const num = parseFloat(rawNumber);
        const unitRaw = gramMatch[2].toLowerCase();

        let canonicalUnit = unitRaw;
        let factor = 1;

        if (unitRaw === 'g' || unitRaw === 'gr' || unitRaw.startsWith('gram')) {
            canonicalUnit = 'g';
            factor = 1;
        } else if (unitRaw === 'kg' || unitRaw.startsWith('kilo')) {
            canonicalUnit = 'kg';
            factor = 1000;
        } else if (unitRaw === 'ml' || unitRaw === 'cc') {
            canonicalUnit = 'ml';
            factor = 1;
        } else if (unitRaw === 'l' || unitRaw === 'lt' || unitRaw.startsWith('litro')) {
            canonicalUnit = 'L';
            factor = 1000;
        } else if (unitRaw === 'oz') {
            canonicalUnit = 'oz';
            factor = 28.35;
        } else if (unitRaw === 'lb') {
            canonicalUnit = 'lb';
            factor = 453.59;
        }

        sortWeight = num * factor;
        // Respetar decimales exactos hasta 3 dígitos sin redondeo destructivo (ej: 1.25L, 1.75L, 2.25L)
        const formattedNum = parseFloat(num.toFixed(3));
        label = `${formattedNum}${canonicalUnit}`;

        // Remover la coincidencia exacta de gramaje del nombre base
        baseName = baseName.replace(gramMatch[0], ' ');
    } else {
        const sizeMatch = name.match(SIZE_WORDS_REGEX);
        if (sizeMatch) {
            const word = sizeMatch[1].toLowerCase();
            if (word.startsWith('peque') || word.startsWith('chic') || word === 'mini') {
                label = 'Pequeño';
                sortWeight = 10;
            } else if (word.startsWith('med')) {
                label = 'Mediano';
                sortWeight = 20;
            } else if (word.startsWith('gran') || word === 'maxi' || word.startsWith('fam')) {
                label = 'Grande';
                sortWeight = 30;
            } else if (word.startsWith('pers') || word.startsWith('indiv')) {
                label = 'Individual';
                sortWeight = 15;
            } else {
                label = word.charAt(0).toUpperCase() + word.slice(1);
                sortWeight = 15;
            }
            baseName = baseName.replace(sizeMatch[0], ' ');
        } else {
            const typeMatch = name.match(TYPE_REGEX);
            if (typeMatch) {
                const rawVal = typeMatch[1].toUpperCase();
                label = `Tipo ${rawVal}`;
                if (rawVal === 'AAA' || rawVal === 'JUMBO') sortWeight = 1;
                else if (rawVal === 'AA' || rawVal === 'EXTRA') sortWeight = 2;
                else if (rawVal === 'A' || rawVal === 'SUPER') sortWeight = 3;
                else if (rawVal === 'B') sortWeight = 4;
                else if (rawVal === 'C') sortWeight = 5;
                else if (rawVal === 'D') sortWeight = 6;
                else if (!isNaN(Number(rawVal))) sortWeight = Number(rawVal);
                else sortWeight = 10;

                baseName = baseName.replace(typeMatch[0], ' ');
            } else {
                const eggMatch = name.match(DIRECT_EGG_GRADE_REGEX);
                if (eggMatch) {
                    const rawVal = eggMatch[1].toUpperCase();
                    label = `Tipo ${rawVal}`;
                    if (rawVal === 'AAA' || rawVal === 'JUMBO') sortWeight = 1;
                    else if (rawVal === 'AA' || rawVal === 'EXTRA') sortWeight = 2;
                    else if (rawVal === 'A') sortWeight = 3;
                    else if (rawVal === 'B') sortWeight = 4;
                    else if (rawVal === 'C') sortWeight = 5;
                    else if (rawVal === 'D') sortWeight = 6;
                    else sortWeight = 10;

                    baseName = baseName.replace(eggMatch[0], 'Huevos ');
                }
            }
        }
    }

    if (!label) return null;

    baseName = baseName
        .replace(/\(\s*\)/g, ' ')
        .replace(/\[\s*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[-–—/,.]\s*$/, '')
        .trim();

    return {
        baseName,
        label,
        sortWeight
    };
}

/**
 * Normaliza una cadena para comparación (sin acentos, minúsculas, sin espacios dobles)
 */
export function normalizeFamilyKey(str = '') {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Agrupa una lista de productos en familias cuando comparten nombre base y categoría
 * @param {Array} products Lista plana de productos
 * @returns {Array} Lista con productos individuales y familias unificadas
 */
export function groupProductsByFamily(products = []) {
    if (!Array.isArray(products) || products.length === 0) return [];

    // Diccionario temporal de grupos por clave normalizada
    const groups = new Map();
    // Lista de productos que no pertenecen a ninguna familia
    const singles = [];

    products.forEach((prod) => {
        if (!prod || !prod.name) return;

        const pres = parsePresentation(prod.name);
        if (!pres) {
            singles.push(prod);
            return;
        }

        // Usar baseNorm directamente si tiene suficiente longitud para no mezclar nombres genéricos
        const baseNorm = normalizeFamilyKey(pres.baseName);
        const catNorm = normalizeFamilyKey(prod.category || 'general');
        // Si el nombre base tiene más de 4 caracteres, unifica independientemente de discordancias menores de categoría
        const groupKey = baseNorm.length >= 4 ? baseNorm : `${catNorm}::${baseNorm}`;

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                baseName: pres.baseName,
                category: prod.category && prod.category.toLowerCase() !== 'general' ? prod.category : null,
                items: []
            });
        }

        const currentGroup = groups.get(groupKey);
        // Si el grupo no tiene categoría específica y este producto sí, adoptamos la categoría más específica
        if (!currentGroup.category && prod.category && prod.category.toLowerCase() !== 'general') {
            currentGroup.category = prod.category;
        }

        currentGroup.items.push({
            product: prod,
            label: pres.label,
            sortWeight: pres.sortWeight
        });
    });

    const result = [];

    // Procesar grupos detectados
    groups.forEach((group) => {
        if (group.items.length >= 2) {
            // Se unifica en familia porque tiene 2 o más presentaciones
            const sortedItems = [...group.items].sort((a, b) => a.sortWeight - b.sortWeight);
            const variants = sortedItems.map(item => ({
                ...item.product,
                presentationLabel: item.label,
                sortWeight: item.sortWeight
            }));

            // Encontrar la imagen más adecuada entre las variantes
            const representativeImg = variants.find(v => v.imageUrl || v.imageUri)?.imageUrl ||
                                     variants.find(v => v.imageUrl || v.imageUri)?.imageUri || null;

            // Variante predeterminada: la que tenga stock o la primera
            const defaultVariant = variants.find(v => Number(v.stockQuantity) > 0) || variants[0];

            result.push({
                // Delegamos propiedades representativas a la variante activa como base
                ...defaultVariant,
                isFamily: true,
                familyId: `family-${normalizeFamilyKey(group.baseName)}`,
                name: group.baseName,
                category: group.category || defaultVariant.category,
                imageUrl: representativeImg || defaultVariant.imageUrl,
                variants,
                _familyVariants: variants,
                defaultVariant
            });
        } else {
            // Si solo hay 1 producto con ese gramaje, se mantiene como producto regular
            group.items.forEach(item => result.push(item.product));
        }
    });

    // Añadir los productos que no tenían variante de gramaje
    singles.forEach(prod => result.push(prod));

    return result;
}

/**
 * Consolida automáticamente las unidades de un mismo producto en el carrito
 * hacia sus empaques mayoristas (Presentations, Bulto, Medio Bulto) usando
 * una descomposición voraz (de mayor a menor factor de conversión).
 *
 * Ejemplo (Huevos con Medio Cartón x15 y Cartón x30):
 * - 15 unidades -> 1x Medio Cartón (15 und)
 * - 17 unidades -> 1x Medio Cartón (15 und) + 2x Unidad
 * - 30 unidades -> 1x Cartón (30 und)
 */
export function consolidateLooseUnitsToWholesale(cartList, product) {
    if (!Array.isArray(cartList) || !product) return cartList;
    if (product.isSoldByWeight || product.stockUnit === 'kg' || product.isCustom) {
        return cartList;
    }

    const baseId = product.productId || product.id;
    if (!baseId) return cartList;

    // Filtrar líneas del carrito que pertenecen a este producto físico
    const matchingIndices = [];
    for (let i = 0; i < cartList.length; i++) {
        const it = cartList[i];
        if (!it.isCustom && (it.productId === baseId || it.id === baseId)) {
            matchingIndices.push(i);
        }
    }
    if (matchingIndices.length === 0) return cartList;

    const sampleItem = cartList[matchingIndices[0]];
    const getPresUnits = (pr) => {
        const fc = Number(pr?.factorConversion);
        if (fc > 0) return fc;
        const match = String(pr?.name || '').match(/(\d+(?:\.\d+)?)\s*(?:un|und|unid|unidades|pza|pzas)/i);
        if (match) return Number(match[1]);
        return 0;
    };

    const rawPres = Array.isArray(product.Presentations) && product.Presentations.length > 0
        ? product.Presentations
        : (Array.isArray(sampleItem.Presentations) ? sampleItem.Presentations : []);

    const baseName = sampleItem.originalName || product.originalName || product.name || sampleItem.name;
    const baseUnitPrice = Number(
        product.basePrice ?? sampleItem.basePrice ?? product.price ?? sampleItem.price
    ) || 0;

    const tierByFactor = new Map();
    const isPromoPresentation = (pr) => /oferta|promo|descuento|especial|rebaja|liquidaci/i.test(String(pr?.name || ''));
    const formatPresDisplayName = (prName, factor) => {
        const cleanPrName = String(prName || '').trim();
        const hasFactorInName = /\(\d+/.test(cleanPrName) || /x\s*\d+/i.test(cleanPrName);
        return hasFactorInName ? `${baseName} (${cleanPrName})` : `${baseName} (${cleanPrName} x${factor})`;
    };

    if (rawPres.length > 0) {
        rawPres.forEach(pr => {
            const factor = getPresUnits(pr);
            const price = Number(pr.price);
            if (factor > 1 && price > 0) {
                const candidate = {
                    type: 'pres',
                    factor,
                    price,
                    pres: pr,
                    isPromo: isPromoPresentation(pr),
                    isDefault: Boolean(pr.isDefaultSale),
                    cartItemId: `${baseId}__pres_${pr.id}`,
                    displayName: formatPresDisplayName(pr.name, factor)
                };
                const existing = tierByFactor.get(factor);
                if (!existing) {
                    tierByFactor.set(factor, candidate);
                } else {
                    // Cuando existen múltiples presentaciones con el mismo factor (ej. "Caja" vs "Huevos Oferta"),
                    // la auto-consolidación de unidades sueltas debe usar el empaque estándar/regular y nunca
                    // sobreescribir ni regalar automáticamente una presentación de oferta.
                    const shouldReplace =
                        (candidate.isDefault && !existing.isDefault) ||
                        (!candidate.isPromo && existing.isPromo) ||
                        (candidate.isPromo === existing.isPromo && candidate.isDefault === existing.isDefault && candidate.price > existing.price);
                    if (shouldReplace) {
                        tierByFactor.set(factor, candidate);
                    }
                }
            }
        });
    } else {
        const unitsPerBulk = Number(product.unitsPerBulk || sampleItem.unitsPerBulk || 1);
        const unitsPerMidBulk = Number(product.unitsPerMidBulk || sampleItem.unitsPerMidBulk || 0);

        if (unitsPerBulk > 1) {
            const bulkUnitName = product.bulkUnitName || sampleItem.bulkUnitName || 'Bulto';
            const bulkPrice = Number(product.bulkPrice || sampleItem.bulkPrice) > 0
                ? Number(product.bulkPrice || sampleItem.bulkPrice)
                : (baseUnitPrice * unitsPerBulk);
            tierByFactor.set(unitsPerBulk, {
                type: 'bulk',
                factor: unitsPerBulk,
                price: bulkPrice,
                cartItemId: `${baseId}__bulk`,
                displayName: formatPresDisplayName(bulkUnitName, unitsPerBulk)
            });
        }
        if (unitsPerMidBulk > 1) {
            const midBulkUnitName = product.midBulkUnitName || sampleItem.midBulkUnitName || 'Media';
            const midBulkPrice = Number(product.midBulkPrice || sampleItem.midBulkPrice) > 0
                ? Number(product.midBulkPrice || sampleItem.midBulkPrice)
                : (baseUnitPrice * unitsPerMidBulk);
            tierByFactor.set(unitsPerMidBulk, {
                type: 'mid',
                factor: unitsPerMidBulk,
                price: midBulkPrice,
                cartItemId: `${baseId}__mid`,
                displayName: formatPresDisplayName(midBulkUnitName, unitsPerMidBulk)
            });
        }
    }

    const tiers = Array.from(tierByFactor.values()).sort((a, b) => b.factor - a.factor);
    if (tiers.length === 0) return cartList;

    // Separar las líneas seleccionadas explícitamente por el cajero (ej. "Caja" o "Huevos Oferta")
    // de las líneas de unidades sueltas o auto-consolidadas desde unidades sueltas.
    const explicitLines = [];
    const consolidatableIndices = [];
    let hasLooseUnitLine = false;

    for (const idx of matchingIndices) {
        const it = cartList[idx];
        const isLooseUnit = !it.presentationId && !it.isBulk && !it.isMidBulk && (Number(it.factorConversion) || 1) === 1;
        if (isLooseUnit) {
            hasLooseUnitLine = true;
            consolidatableIndices.push(idx);
        } else if (it.isAutoConsolidated) {
            consolidatableIndices.push(idx);
        } else {
            explicitLines.push({ ...it });
        }
    }

    // Si no hay unidades sueltas ni líneas auto-consolidadas, respetar las presentaciones explícitas intactas
    if (consolidatableIndices.length === 0) {
        return cartList;
    }

    // Calcular el total de unidades físicas acumuladas únicamente en líneas auto-consolidables
    let totalConsolidatableUnits = 0;
    for (const idx of consolidatableIndices) {
        const it = cartList[idx];
        const qty = Number(it.quantity) || 0;
        const factor = Number(it.factorConversion) || 1;
        totalConsolidatableUnits += qty * factor;
    }

    const minFactor = tiers[tiers.length - 1].factor;
    // Si solo hay una línea de unidades sueltas y aún no alcanza el empaque mínimo, no hay cambios
    if (
        consolidatableIndices.length === 1 &&
        hasLooseUnitLine &&
        totalConsolidatableUnits < minFactor
    ) {
        return cartList;
    }

    // Plantilla limpia del producto base
    const baseTemplate = {
        ...sampleItem,
        id: baseId,
        productId: baseId,
        name: baseName,
        originalName: baseName,
        basePrice: baseUnitPrice,
        price: baseUnitPrice,
        Presentations: rawPres.length > 0 ? rawPres : sampleItem.Presentations
    };

    let remainingUnits = totalConsolidatableUnits;
    const autoConsolidatedLines = [];

    for (const tier of tiers) {
        if (remainingUnits >= tier.factor) {
            const packs = Math.floor(remainingUnits / tier.factor);
            remainingUnits = remainingUnits % tier.factor;

            // Si ya existe una línea explícita con este mismo cartItemId, sumar los paquetes allí
            const existingExplicit = explicitLines.find(line => line.id === tier.cartItemId);
            if (existingExplicit) {
                existingExplicit.quantity = (Number(existingExplicit.quantity) || 0) + packs;
            } else {
                autoConsolidatedLines.push({
                    ...baseTemplate,
                    id: tier.cartItemId,
                    productId: baseId,
                    name: tier.displayName,
                    originalName: baseName,
                    price: tier.price,
                    presentationId: tier.type === 'pres' ? tier.pres.id : null,
                    presentationName: tier.type === 'pres' ? tier.pres.name : null,
                    factorConversion: tier.factor,
                    isBulk: tier.type === 'bulk',
                    isMidBulk: tier.type === 'mid',
                    isAutoConsolidated: true,
                    quantity: packs
                });
            }
        }
    }

    if (remainingUnits > 0) {
        autoConsolidatedLines.push({
            ...baseTemplate,
            id: baseId,
            productId: baseId,
            name: baseName,
            originalName: baseName,
            price: baseUnitPrice,
            presentationId: null,
            presentationName: null,
            factorConversion: 1,
            isBulk: false,
            isMidBulk: false,
            isAutoConsolidated: false,
            quantity: remainingUnits
        });
    }

    const finalProductLines = [...explicitLines, ...autoConsolidatedLines];

    // Reemplazar las líneas de este producto en la posición de su primera aparición
    const firstPos = matchingIndices[0];
    const matchingSet = new Set(matchingIndices);
    const updated = [];

    for (let i = 0; i < cartList.length; i++) {
        if (i === firstPos) {
            updated.push(...finalProductLines);
        } else if (!matchingSet.has(i)) {
            updated.push(cartList[i]);
        }
    }

    return updated;
}
