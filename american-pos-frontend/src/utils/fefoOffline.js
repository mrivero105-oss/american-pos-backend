import db from '../db/localDb';

export async function processOfflineFEFO(cartItems, globalRecipe = null) {
  try {
    const saleRecord = {
      items: cartItems.map(item => ({
        id: item.id,
        nombre: item.nombre,
        precio: item.precio,
        quantity: item.quantity,
        es_controlado: item.es_controlado || false,
        recipe: item.recipe || globalRecipe || null
      })),
      total: cartItems.reduce((acc, item) => acc + Number(item.precio) * item.quantity, 0),
      status: 'pending_sync',
      created_at: new Date().toISOString()
    };

    const id = await db.sales.add(saleRecord);
    return { success: true, sale: { ...saleRecord, id } };
  } catch (error) {
    console.error('Error in processOfflineFEFO:', error);
    throw error;
  }
}
