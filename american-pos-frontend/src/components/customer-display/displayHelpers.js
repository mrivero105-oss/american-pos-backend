export const VALID_ARCH_THEMES = ['studio', 'swiss', 'titanium'];

export const normalizeArchTheme = (raw) => {
    if (VALID_ARCH_THEMES.includes(raw)) return raw;
    if (raw === 'swiss') return 'swiss';
    if (raw === 'oled' || raw === 'dark') return 'titanium';
    if (raw === 'light') return 'studio';
    return 'studio';
};

export const DEFAULT_DISPLAY_CONFIG = {
    layoutMode: 'split',
    intervalSeconds: 8,
    imageFit: 'contain',
    autoIncludePromotions: true,
    autoIncludeProducts: true,
    maxAutoProducts: 10,
    institutionalTagline: 'Precios calculados a tasa oficial vigente',
    slides: []
};

export const getBusinessInitials = (name) => {
    const clean = String(name || 'POS').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
};

export const buildPromoBadge = (promo) => {
    if (!promo) return 'OFERTA ACTIVA';
    const type = String(promo.type || '').toUpperCase();
    if (type === 'BUY_X_GET_Y' && promo.buyQuantity > 0 && promo.payQuantity > 0) {
        return `PROMOCIÓN ${promo.buyQuantity}x${promo.payQuantity}`;
    }
    if ((type === 'PERCENTAGE' || type === 'PERCENT_DISCOUNT' || promo.discountPercentage > 0) && promo.discountPercentage > 0) {
        return `-${promo.discountPercentage}% DESCUENTO`;
    }
    if (promo.fixedPrice && Number(promo.fixedPrice) > 0) {
        return 'PRECIO ESPECIAL';
    }
    if (type.includes('COMBO')) {
        return 'COMBO ESPECIAL';
    }
    return 'PROMOCIÓN VIGENTE';
};

export const getDisplayThemeTokens = (archTheme) => {
    const isStudio = archTheme === 'studio';
    const isSwiss = archTheme === 'swiss';
    const isTitanium = archTheme === 'titanium';

    return {
        isStudio,
        isSwiss,
        isTitanium,
        rootBg: isTitanium
            ? 'bg-[#090B0E] text-[#F1F5F9]'
            : isSwiss
                ? 'bg-[#F7F8FA] text-[#090D14]'
                : 'bg-[#EFF2F6] text-[#0B0F17]',
        headerStyle: isTitanium
            ? 'bg-[#0E1217] border-[#212834] text-[#F8FAFC] divide-[#212834]'
            : isSwiss
                ? 'bg-white border-[#C8D0DC] text-[#090D14] divide-[#C8D0DC]'
                : 'bg-[#0A0D12] border-[#1E2530] text-white divide-[#1E2530]',
        headerMuted: isSwiss ? 'text-[#5A6577]' : 'text-[#8E9BAE]',
        stagePanelStyle: isTitanium
            ? 'bg-[#0E1217] border-[#212834] text-[#F8FAFC]'
            : isSwiss
                ? 'bg-white border-[#C8D0DC] text-[#090D14]'
                : 'bg-white border-[#D4DCE6] text-[#0B0F17]',
        railPanelStyle: isTitanium
            ? 'bg-[#11161D] border-[#212834] text-[#F8FAFC] divide-[#212834]'
            : isSwiss
                ? 'bg-[#F7F8FA] border-[#C8D0DC] text-[#090D14] divide-[#C8D0DC]'
                : 'bg-[#0A0D12] border-[#1E2530] text-white divide-[#1E2530]',
        railMuted: isSwiss ? 'text-[#5A6577]' : 'text-[#8E9BAE]',
        footerStyle: isTitanium
            ? 'bg-[#0E1217] border-[#212834] text-[#8B96A8]'
            : isSwiss
                ? 'bg-white border-[#C8D0DC] text-[#5A6577]'
                : 'bg-[#0A0D12] border-[#1E2530] text-[#94A3B8]'
    };
};
