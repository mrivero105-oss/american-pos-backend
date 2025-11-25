export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
};

export const formatDate = (dateInput) => {
    if (!dateInput) return '';

    let date;
    // Handle Firestore Timestamp object (from REST API)
    if (dateInput && typeof dateInput === 'object' && dateInput._seconds) {
        date = new Date(dateInput._seconds * 1000);
    } else {
        date = new Date(dateInput);
    }

    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

export const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};
