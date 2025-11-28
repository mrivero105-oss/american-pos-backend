export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM products ORDER BY name ASC"
    ).all();

    // Parse boolean/JSON fields if necessary and map stockQuantity to stock
    const products = results.map(p => ({
      ...p,
      isCustom: Boolean(p.isCustom),
      stock: p.stockQuantity // Map DB column to frontend expected property
    }));

    return new Response(JSON.stringify(products), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const product = await context.request.json();
    const id = product.id || Date.now().toString();

    await context.env.DB.prepare(
      `INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, isCustom) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      product.name,
      product.price,
      product.priceBs || null,
      product.stockQuantity || 0,
      product.category || 'General',
      product.barcode || '',
      product.imageUri || '',
      product.isCustom ? 1 : 0
    ).run();

    return new Response(JSON.stringify({ ...product, id }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
