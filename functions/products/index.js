export async function onRequestGet(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // AUTH CHECK: middleware should have injected user
    const user = context.data.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    // Parse URL params
    const url = new URL(context.request.url);
    const page = parseInt(url.searchParams.get("page")) || 1;
    const limit = parseInt(url.searchParams.get("limit")) || 0; // 0 = all

    let products = [];
    let total = 0;

    if (limit > 0) {
      // Pagination Mode
      const offset = (page - 1) * limit;

      const { results } = await context.env.DB.prepare(
        "SELECT * FROM products ORDER BY name ASC LIMIT ? OFFSET ?"
      ).bind(limit, offset).all();

      products = results;

      // Get total count
      // Note: This is an extra query. D1 is fast enough.
      const countResult = await context.env.DB.prepare(
        "SELECT COUNT(*) as count FROM products"
      ).first();
      total = countResult.count;

      // Parse boolean/JSON fields
      products = products.map(p => ({
        ...p,
        isCustom: Boolean(p.isCustom),
        stock: p.stock
      }));

      return new Response(JSON.stringify({
        products,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      }), {
        headers: { "Content-Type": "application/json" },
      });

    } else {
      // Legacy Mode (All)
      const { results } = await context.env.DB.prepare(
        "SELECT * FROM products ORDER BY name ASC"
      ).all();

      products = results.map(p => ({
        ...p,
        isCustom: Boolean(p.isCustom),
        stock: p.stock
      }));

      // If page param exists but limit is 0/missing, return object wrapper for consistency with local?
      // Local logic: if (req.query.page) return object.
      if (url.searchParams.has("page")) {
        return new Response(JSON.stringify({
          products,
          total: products.length,
          page: 1,
          totalPages: 1
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(products), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const user = context.data.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const product = await context.request.json();
    const id = product.id || Date.now().toString();

    await context.env.DB.prepare(
      `INSERT INTO products (id, name, price, priceBs, stock, category, barcode, imageUri, isCustom, isSoldByWeight) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      product.name,
      product.price,
      product.priceBs || null,
      product.stock || 0,
      product.category || 'General',
      product.barcode || '',
      product.imageUri || '',
      product.isCustom ? 1 : 0,
      product.isSoldByWeight ? 1 : 0
    ).run();

    return new Response(JSON.stringify({ ...product, id, userId: user.id }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
