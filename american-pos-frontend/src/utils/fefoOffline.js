import db from '../db/localDb';
import primaryDb from '../services/db';

export async function processOfflineFEFO(cartItems, globalRecipe = null, paymentData = {}) {
  try {
    const nowIso = new Date().toISOString();
    const txId = paymentData.clientTransactionId || `off_fefo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const totalAmount = cartItems.reduce((acc, item) => acc + Number(item.precio ?? item.price ?? 0) * (Number(item.quantity) || 1), 0);

    const saleRecord = {
      id: txId,
      clientTransactionId: txId,
      items: cartItems.map(item => ({
        id: item.id,
        productId: item.productId || item.id,
        nombre: item.nombre || item.name,
        name: item.name || item.nombre,
        precio: Number(item.precio ?? item.price ?? 0),
        price: Number(item.price ?? item.precio ?? 0),
        quantity: Number(item.quantity) || 1,
        es_controlado: item.es_controlado || false,
        recipe: item.recipe || globalRecipe || null
      })),
      total: totalAmount,
      subtotal: totalAmount,
      paymentMethod: paymentData.paymentMethod || 'cash',
      paymentMethods: Array.isArray(paymentData.paymentMethods) && paymentData.paymentMethods.length > 0
        ? paymentData.paymentMethods
        : [{ method: paymentData.paymentMethod || 'cash', amount: totalAmount, currency: 'USD' }],
      status: 'pending_sync',
      date: nowIso,
      created_at: nowIso
    };

    const id = await db.sales.add(saleRecord);
    await primaryDb.put('sales', { ...saleRecord, id: id || txId }).catch(() => {});
    return { success: true, sale: { ...saleRecord, id: id || txId } };
  } catch (error) {
    console.error('Error in processOfflineFEFO:', error);
    throw error;
  }
}
