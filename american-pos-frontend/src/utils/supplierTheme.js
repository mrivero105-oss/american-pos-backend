export const getSupplierInitials = (name) => {
    if (!name || typeof name !== 'string') return 'PR';
    const clean = name
        .replace(/\b(c\.?a\.?|s\.?a\.?|s\.?r\.?l\.?|c\.?v\.?|llc|inc|corp|de|del|la|las|los|y|and)\b/gi, '')
        .trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
};

const SUPPLIER_THEMES = [
    { bg: 'from-blue-600 via-indigo-600 to-violet-700', text: 'text-white', glow: 'shadow-indigo-500/20' },
    { bg: 'from-emerald-600 via-teal-600 to-cyan-700', text: 'text-white', glow: 'shadow-teal-500/20' },
    { bg: 'from-violet-600 via-purple-600 to-fuchsia-700', text: 'text-white', glow: 'shadow-purple-500/20' },
    { bg: 'from-amber-500 via-orange-600 to-rose-600', text: 'text-white', glow: 'shadow-amber-500/20' },
    { bg: 'from-rose-600 via-pink-600 to-rose-700', text: 'text-white', glow: 'shadow-rose-500/20' },
    { bg: 'from-cyan-600 via-sky-600 to-blue-700', text: 'text-white', glow: 'shadow-cyan-500/20' },
    { bg: 'from-teal-600 via-emerald-600 to-green-700', text: 'text-white', glow: 'shadow-emerald-500/20' },
    { bg: 'from-slate-700 via-slate-800 to-slate-900', text: 'text-white', glow: 'shadow-slate-500/20' }
];

export const getSupplierTheme = (name = '') => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % SUPPLIER_THEMES.length;
    return SUPPLIER_THEMES[index];
};
