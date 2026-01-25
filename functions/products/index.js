export async function onRequestGet(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // TEMPORARY: Bypass auth check for debugging
    // const user = context.data.user;
    // if (!user) {
    //   return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    // }

    const url = new URL(context.request.url);
    const page = parseInt(url.searchParams.get("page")) || 1;
    const limit = parseInt(url.searchParams.get("limit")) || 0; // 0 = all
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");

    let products = [];
    let total = 0;

    // Build WHERE clause dynamically
    let whereClauses = [];
    let params = [];

    if (category && category !== 'Todas') {
      whereClauses.push("category = ?");
      params.push(category);
    }

    if (search) {
      const term = `%${search}%`;
      whereClauses.push("(name LIKE ? OR barcode LIKE ?)");
      params.push(term, term);
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    if (limit > 0) {
      // Pagination Mode
      const offset = (page - 1) * limit;

      // Main Query
      // NOTE: We must clone params for the count query before adding limit/offset
      const countParams = [...params];

      // Add limit/offset to main params
      const mainParams = [...params, limit, offset];

      const { results } = await context.env.DB.prepare(
        `SELECT * FROM products ${whereSQL} ORDER BY name ASC LIMIT ? OFFSET ?`
      ).bind(...mainParams).all();

      products = results;

      // Get total count with filters
      const countResult = await context.env.DB.prepare(
        `SELECT COUNT(*) as count FROM products ${whereSQL}`
      ).bind(...countParams).first();
      total = countResult.count;

      // Parse boolean/JSON fields
      products = products.map(p => ({
        ...p,
        isCustom: Boolean(p.isCustom),
        stock: p.stockQuantity // Alias for frontend compatibility
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
      // Legacy Mode (All) - still respecting filters!
      const { results } = await context.env.DB.prepare(
        `SELECT * FROM products ${whereSQL} ORDER BY name ASC`
      ).bind(...params).all();

      products = results.map(p => ({
        ...p,
        isCustom: Boolean(p.isCustom),
        stock: p.stockQuantity // Alias for frontend compatibility
      }));

      // If page param exists but limit is 0/missing, return object wrapper
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
      `INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, isCustom) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      product.name,
      product.price,
      product.priceBs || null,
      product.stock || 0,
      product.category || 'General',
      product.barcode || '',
      product.imageUri || '',
      product.isCustom ? 1 : 0
    ).run();

    return new Response(JSON.stringify({ ...product, id, userId: user.id }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
