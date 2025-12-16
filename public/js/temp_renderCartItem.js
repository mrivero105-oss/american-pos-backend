renderCartItem(item) {
    const isWeighted = item.isWeighted || item.measurement === 'kg';
    const step = isWeighted ? '0.001' : '1';
    const quantityDisplay = isWeighted ? parseFloat(item.quantity).toFixed(3) : item.quantity;
    const weightTag = isWeighted ? '<span class="text-xs bg-blue-100 text-blue-800 px-1 rounded ml-1">Peso</span>' : '';

    return `
                <div class="cart-item flex justify-between items-center p-3 mb-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500 transition-colors" data-id="${item.id}">
                    <div class="flex-1">
                        <div class="flex items-center">
                            <h4 class="font-medium text-slate-900 dark:text-white">${item.name}</h4>
                            ${weightTag}
                        </div>
                        <div class="text-sm text-slate-500 dark:text-slate-400">
                            $${parseFloat(item.price).toFixed(2)} x 
                            <input type="number" class="qty-input w-16 px-1 py-0.5 text-center border rounded mx-1 bg-white dark:bg-slate-600 dark:text-white" 
                                value="${quantityDisplay}" step="${step}" min="${step}">
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-slate-900 dark:text-white">$${(item.price * item.quantity).toFixed(2)}</p>
                        <div class="flex items-center justify-end gap-1 mt-1">
                            <button class="decrease-qty p-1 text-slate-400 hover:text-red-500 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path></svg>
                            </button>
                            <button class="increase-qty p-1 text-slate-400 hover:text-green-500 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            </button>
                            <button class="remove-item p-1 text-slate-400 hover:text-red-500 transition-colors ml-1">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>
                            `;
}

