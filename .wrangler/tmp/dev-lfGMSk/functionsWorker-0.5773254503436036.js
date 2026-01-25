var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-cC0m8p/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/pages-OfdtSe/functionsWorker-0.5773254503436036.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var urls2 = /* @__PURE__ */ new Set();
function checkURL2(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls2.has(url.toString())) {
      urls2.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL2, "checkURL");
__name2(checkURL2, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL2(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});
async function onRequestPost(context) {
  try {
    const { id } = context.params;
    const { email, receiptHtml } = await context.request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), { status: 400 });
    }
    const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwm1lzRdbfaY16qvYqB54yM911KeBBZQH0sppkg_jJHChQqx9Ne9w1d8khBmAPe84sFAg/exec";
    const googleResponse = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        subject: `Recibo de Compra #${id}`,
        html: receiptHtml || `<p>Recibo de compra #${id}</p>`
      })
    });
    if (!googleResponse.ok) {
      throw new Error(`Google Script Error: ${googleResponse.statusText}`);
    }
    const text = await googleResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { raw: text };
    }
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Email Function Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost, "onRequestPost");
__name2(onRequestPost, "onRequestPost");
var JWT_SECRET = "american-pos-secret-key-change-in-prod";
async function onRequestPost2(context) {
  try {
    const { email, password } = await context.request.json();
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400 });
    }
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).bind(email).all();
    const user = results[0];
    if (!user) {
      await new Promise((r) => setTimeout(r, 100));
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
    }
    const myText = new TextEncoder().encode(password);
    const myDigest = await crypto.subtle.digest(
      { name: "SHA-256" },
      myText
    );
    const hashArray = Array.from(new Uint8Array(myDigest));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hashHex !== user.password) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
    }
    if (user.status === "blocked") {
      return new Response(JSON.stringify({ error: "Cuenta bloqueada. Contacte al administrador." }), { status: 403 });
    }
    if (user.trial_expires_at) {
      const now = Date.now();
      if (now > user.trial_expires_at) {
        return new Response(JSON.stringify({ error: "El periodo de prueba ha expirado." }), { status: 403 });
      }
    }
    const { password: _, ...userWithoutPassword } = user;
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const payload = btoa(JSON.stringify({
      id: user.id,
      email: user.email,
      role: user.role || "user",
      iat: Math.floor(Date.now() / 1e3),
      exp: Math.floor(Date.now() / 1e3) + 60 * 60 * 24
      // 24 hours
    })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const signature = await sign(header + "." + payload, JWT_SECRET);
    const token = `${header}.${payload}.${signature}`;
    return new Response(JSON.stringify({
      success: true,
      user: userWithoutPassword,
      token
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost2, "onRequestPost2");
__name2(onRequestPost2, "onRequestPost");
async function sign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(message)
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(sign, "sign");
__name2(sign, "sign");
async function onRequestPost3(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
    }
    const body = await context.request.json();
    const actualCash = parseFloat(body.actualCash) || 0;
    const currentShift = await context.env.DB.prepare(
      "SELECT * FROM cash_shifts WHERE status = 'open' LIMIT 1"
    ).first();
    if (!currentShift) {
      return new Response(JSON.stringify({ message: "No hay caja abierta para cerrar" }), { status: 400 });
    }
    const salesQuery = await context.env.DB.prepare(
      "SELECT SUM(total) as totalSales FROM sales WHERE timestamp >= ?"
    ).bind(currentShift.openedAt).first();
    const movementsIn = await context.env.DB.prepare(
      "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'in'"
    ).bind(currentShift.id).first();
    const movementsOut = await context.env.DB.prepare(
      "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'out'"
    ).bind(currentShift.id).first();
    const totalSales = salesQuery.totalSales || 0;
    const totalIn = movementsIn.total || 0;
    const totalOut = movementsOut.total || 0;
    const expectedCash = (currentShift.startingCash || 0) + totalSales + totalIn - totalOut;
    const closedAt = (/* @__PURE__ */ new Date()).toISOString();
    const difference = actualCash - expectedCash;
    await context.env.DB.prepare(
      `UPDATE cash_shifts 
         SET status = 'closed', closedAt = ?, actualCash = ?, expectedCash = ?, difference = ?
         WHERE id = ?`
    ).bind(
      closedAt,
      actualCash,
      expectedCash,
      difference,
      currentShift.id
    ).run();
    return new Response(JSON.stringify({
      ...currentShift,
      status: "closed",
      closedAt,
      actualCash,
      expectedCash,
      difference
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost3, "onRequestPost3");
__name2(onRequestPost3, "onRequestPost");
async function onRequestGet(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
    }
    const { results: shifts } = await context.env.DB.prepare(
      "SELECT * FROM cash_shifts WHERE status = 'open' LIMIT 1"
    ).all();
    const currentShift = shifts[0];
    if (!currentShift) {
      return new Response(JSON.stringify(null), {
        headers: { "Content-Type": "application/json" }
      });
    }
    const salesQuery = await context.env.DB.prepare(
      "SELECT SUM(total) as totalSales FROM sales WHERE timestamp >= ?"
    ).bind(currentShift.openedAt).first();
    const movementsIn = await context.env.DB.prepare(
      "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'in'"
    ).bind(currentShift.id).first();
    const movementsOut = await context.env.DB.prepare(
      "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'out'"
    ).bind(currentShift.id).first();
    const totalSales = salesQuery.totalSales || 0;
    const totalIn = movementsIn.total || 0;
    const totalOut = movementsOut.total || 0;
    const expectedCash = (currentShift.startingCash || 0) + totalSales + totalIn - totalOut;
    return new Response(JSON.stringify({
      ...currentShift,
      totalSales,
      totalIn,
      totalOut,
      expectedCash
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet, "onRequestGet");
__name2(onRequestGet, "onRequestGet");
async function onRequestPost4(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
    }
    const body = await context.request.json();
    const currentShift = await context.env.DB.prepare(
      "SELECT id FROM cash_shifts WHERE status = 'open' LIMIT 1"
    ).first();
    if (!currentShift) {
      return new Response(JSON.stringify({ message: "Debe abrir la caja primero" }), { status: 400 });
    }
    const newMovement = {
      id: Date.now().toString(),
      shiftId: currentShift.id,
      type: body.type,
      // 'in' or 'out'
      amount: parseFloat(body.amount),
      reason: body.reason,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await context.env.DB.prepare(
      `INSERT INTO cash_movements (id, shiftId, type, amount, reason, timestamp) 
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      newMovement.id,
      newMovement.shiftId,
      newMovement.type,
      newMovement.amount,
      newMovement.reason,
      newMovement.timestamp
    ).run();
    return new Response(JSON.stringify(newMovement), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost4, "onRequestPost4");
__name2(onRequestPost4, "onRequestPost");
async function onRequestPost5(context) {
  try {
    if (!context.env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
    }
    const body = await context.request.json();
    const { results: openShifts } = await context.env.DB.prepare(
      "SELECT id FROM cash_shifts WHERE status = 'open'"
    ).all();
    if (openShifts.length > 0) {
      return new Response(JSON.stringify({ message: "Ya hay una caja abierta" }), { status: 400 });
    }
    const newShift = {
      id: Date.now().toString(),
      openedAt: (/* @__PURE__ */ new Date()).toISOString(),
      startingCash: parseFloat(body.amount) || 0,
      userId: body.userId || "admin",
      status: "open"
    };
    await context.env.DB.prepare(
      `INSERT INTO cash_shifts (id, openedAt, startingCash, userId, status, expectedCash, actualCash) 
         VALUES (?, ?, ?, ?, 'open', 0, 0)`
    ).bind(
      newShift.id,
      newShift.openedAt,
      newShift.startingCash,
      newShift.userId
    ).run();
    return new Response(JSON.stringify(newShift), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost5, "onRequestPost5");
__name2(onRequestPost5, "onRequestPost");
async function onRequestGet2(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response("Unauthorized", { status: 401 });
    const result = await context.env.DB.prepare(
      "SELECT businessInfo FROM users WHERE id = ?"
    ).bind(user.id).first();
    let info = {};
    if (result && result.businessInfo) {
      try {
        info = JSON.parse(result.businessInfo);
      } catch (e) {
        info = result.businessInfo;
      }
    }
    return new Response(JSON.stringify(info), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet2, "onRequestGet2");
__name2(onRequestGet2, "onRequestGet");
async function onRequestPost6(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response("Unauthorized", { status: 401 });
    const info = await context.request.json();
    await context.env.DB.prepare(
      "UPDATE users SET businessInfo = ? WHERE id = ?"
    ).bind(JSON.stringify(info), user.id).run();
    return new Response(JSON.stringify({ message: "Business info updated" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost6, "onRequestPost6");
__name2(onRequestPost6, "onRequestPost");
async function onRequestGet3(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response("Unauthorized", { status: 401 });
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM payment_methods WHERE userId = ?"
    ).bind(user.id).all();
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet3, "onRequestGet3");
__name2(onRequestGet3, "onRequestGet");
async function onRequestPost7(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response("Unauthorized", { status: 401 });
    const { paymentMethods } = await context.request.json();
    const statements = [
      context.env.DB.prepare("DELETE FROM payment_methods WHERE userId = ?").bind(user.id)
    ];
    for (const pm of paymentMethods) {
      statements.push(context.env.DB.prepare(
        "INSERT INTO payment_methods (id, name, type, currency, requires_reference, userId) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(pm.id, pm.name, pm.type || "custom", pm.currency || "USD", pm.requiresReference ? 1 : 0, user.id));
    }
    await context.env.DB.batch(statements);
    return new Response(JSON.stringify({ message: "Payment methods updated" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost7, "onRequestPost7");
__name2(onRequestPost7, "onRequestPost");
async function onRequestGet4(context) {
  try {
    const result = await context.env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'exchangeRate'"
    ).first();
    return new Response(JSON.stringify({ rate: parseFloat(result?.value || 1) }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet4, "onRequestGet4");
__name2(onRequestGet4, "onRequestGet");
async function onRequestPost8(context) {
  try {
    const { rate } = await context.request.json();
    await context.env.DB.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('exchangeRate', ?)"
    ).bind(String(rate)).run();
    return new Response(JSON.stringify({ message: "Rate updated" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost8, "onRequestPost8");
__name2(onRequestPost8, "onRequestPost");
async function onRequest(context) {
  return new Response("Hello from subdir");
}
__name(onRequest, "onRequest");
__name2(onRequest, "onRequest");
async function onRequestPut(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const id = context.params.id;
    const updates = await context.request.json();
    const keys = Object.keys(updates).filter((k) => k !== "id" && k !== "userId");
    if (keys.length === 0) return new Response("No updates provided", { status: 400 });
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => updates[k]);
    values.push(id);
    values.push(user.id);
    const query = `UPDATE customers SET ${setClause} WHERE id = ? AND userId = ?`;
    const info = await context.env.DB.prepare(query).bind(...values).run();
    if (info.meta.changes > 0) {
      return new Response(JSON.stringify({ message: "Customer updated" }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ error: "Customer not found or unauthorized" }), { status: 404 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPut, "onRequestPut");
__name2(onRequestPut, "onRequestPut");
async function onRequestDelete(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const id = context.params.id;
    const info = await context.env.DB.prepare("DELETE FROM customers WHERE id = ? AND userId = ?").bind(id, user.id).run();
    if (info.meta.changes > 0) {
      return new Response(JSON.stringify({ message: "Customer deleted" }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ error: "Customer not found or unauthorized" }), { status: 404 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestDelete, "onRequestDelete");
__name2(onRequestDelete, "onRequestDelete");
async function onRequestPut2(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const id = context.params.id;
    const updates = await context.request.json();
    const keys = Object.keys(updates).filter((k) => k !== "id" && k !== "userId");
    if (keys.length === 0) return new Response("No updates provided", { status: 400 });
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => {
      if (k === "isCustom" || k === "isSoldByWeight") return updates[k] ? 1 : 0;
      return updates[k];
    });
    values.push(id);
    values.push(user.id);
    const query = `UPDATE products SET ${setClause} WHERE id = ? AND userId = ?`;
    const info = await context.env.DB.prepare(query).bind(...values).run();
    if (info.meta.changes > 0) {
      return new Response(JSON.stringify({ message: "Product updated" }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ error: "Product not found or unauthorized" }), { status: 404 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPut2, "onRequestPut2");
__name2(onRequestPut2, "onRequestPut");
async function onRequestDelete2(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const id = context.params.id;
    const info = await context.env.DB.prepare("DELETE FROM products WHERE id = ? AND userId = ?").bind(id, user.id).run();
    if (info.meta.changes > 0) {
      return new Response(JSON.stringify({ message: "Product deleted" }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ error: "Product not found or unauthorized" }), { status: 404 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestDelete2, "onRequestDelete2");
__name2(onRequestDelete2, "onRequestDelete");
async function onRequest2(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: "User ID required" }), { status: 400 });
  }
  const user = context.data.user;
  if (!user || user.role !== "admin") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  if (request.method === "DELETE") {
    try {
      const res = await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
      if (res.success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to delete user" }), { status: 500 });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }
  if (request.method === "PUT") {
    try {
      const data = await request.json();
      const updates = [];
      const values = [];
      if (data.email) {
        updates.push("email = ?");
        values.push(data.email);
      }
      if (data.password) {
        updates.push("password = ?");
        values.push(data.password);
      }
      if (data.role) {
        updates.push("role = ?");
        values.push(data.role);
      }
      if (data.businessInfo) {
        updates.push("businessInfo = ?");
        values.push(JSON.stringify(data.businessInfo));
      }
      if (data.status) {
        updates.push("status = ?");
        values.push(data.status);
      }
      if (data.trialExpiresAt !== void 0) {
        updates.push("trial_expires_at = ?");
        values.push(data.trialExpiresAt);
      }
      if (updates.length === 0) {
        return new Response(JSON.stringify({ error: "No fields to update" }), { status: 400 });
      }
      values.push(id);
      const query = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
      const res = await env.DB.prepare(query).bind(...values).run();
      if (res.success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to update user" }), { status: 500 });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }
  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
__name(onRequest2, "onRequest2");
__name2(onRequest2, "onRequest");
async function onRequestGet5(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM customers WHERE userId = ? ORDER BY name ASC"
    ).bind(user.id).all();
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet5, "onRequestGet5");
__name2(onRequestGet5, "onRequestGet");
async function onRequestPost9(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const customer = await context.request.json();
    const id = customer.id || Date.now().toString();
    await context.env.DB.prepare(
      `INSERT INTO customers (id, name, idDocument, phone, email, address, userId) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      customer.name,
      customer.idDocument || "",
      customer.phone || "",
      customer.email || "",
      customer.address || "",
      user.id
    ).run();
    return new Response(JSON.stringify({ ...customer, id, userId: user.id }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost9, "onRequestPost9");
__name2(onRequestPost9, "onRequestPost");
async function onRequestGet6(context) {
  try {
    const user = context.data.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const revenueResult = await context.env.DB.prepare(
      "SELECT SUM(total) as totalRevenue FROM sales WHERE userId = ?"
    ).bind(user.id).first();
    const totalRevenue = revenueResult?.totalRevenue || 0;
    const countResult = await context.env.DB.prepare(
      "SELECT COUNT(*) as count FROM sales WHERE userId = ?"
    ).bind(user.id).first();
    const numberOfSales = countResult?.count || 0;
    const { results: lowStockItems } = await context.env.DB.prepare(
      "SELECT name, stockQuantity as stock FROM products WHERE stockQuantity <= 5 AND userId = ?"
    ).bind(user.id).all();
    const { results: salesTrend } = await context.env.DB.prepare(
      `SELECT date(timestamp) as date, SUM(total) as total 
         FROM sales 
         WHERE timestamp >= date('now', '-7 days') AND userId = ?
         GROUP BY date(timestamp) 
         ORDER BY date ASC`
    ).bind(user.id).all();
    const salesLast7Days = {
      labels: salesTrend.map((s) => s.date),
      data: salesTrend.map((s) => s.total)
    };
    return new Response(JSON.stringify({
      totalRevenue,
      numberOfSales,
      lowStockItems,
      salesLast7Days
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet6, "onRequestGet6");
__name2(onRequestGet6, "onRequestGet");
async function onRequestGet7(context) {
  try {
    const users = await context.env.DB.prepare("SELECT * FROM users").all();
    const products = await context.env.DB.prepare("SELECT * FROM products").all();
    const tableInfo = await context.env.DB.prepare("PRAGMA table_info(users)").all();
    return new Response(JSON.stringify({
      users: users.results,
      products: products.results,
      user_columns: tableInfo.results,
      db_binding: "OK"
    }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet7, "onRequestGet7");
__name2(onRequestGet7, "onRequestGet");
async function onRequestPost10(context) {
  try {
    const db = context.env.DB;
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN businessInfo TEXT").run();
    } catch (e) {
    }
    const existingAdmin = await db.prepare("SELECT * FROM users WHERE email = 'admin@test.com'").first();
    if (!existingAdmin) {
      await db.prepare(
        `INSERT INTO users (id, email, password, role, businessInfo) 
                 VALUES (?, ?, ?, ?, ?)`
      ).bind(
        "admin-id-123",
        "admin@test.com",
        "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
        // '123456' hashed
        "admin",
        JSON.stringify({ currency: "USD" })
      ).run();
    }
    const count = await db.prepare("SELECT COUNT(*) as c FROM products").first();
    if (count.c === 0) {
      await db.batch([
        db.prepare("INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, userId) VALUES ('prod-1', 'Harina PAN', 1.5, 60.0, 100, 'Alimentos', '7591001', '', 'admin-id-123')"),
        db.prepare("INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, userId) VALUES ('prod-2', 'Arroz Mary', 1.2, 48.0, 50, 'Alimentos', '7591002', '', 'admin-id-123')"),
        db.prepare("INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, userId) VALUES ('prod-3', 'Pasta Primor', 1.8, 72.0, 80, 'Alimentos', '7591003', '', 'admin-id-123')")
      ]);
    }
    return new Response(JSON.stringify({ message: "Seeding completed" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost10, "onRequestPost10");
__name2(onRequestPost10, "onRequestPost");
async function onRequestGet8(context) {
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
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM products WHERE userId = ? ORDER BY name ASC"
    ).bind(user.id).all();
    const products = results.map((p) => ({
      ...p,
      isCustom: Boolean(p.isCustom),
      stock: p.stockQuantity
    }));
    return new Response(JSON.stringify(products), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet8, "onRequestGet8");
__name2(onRequestGet8, "onRequestGet");
async function onRequestPost11(context) {
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
      `INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, isCustom, isSoldByWeight, userId) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      product.name,
      product.price,
      product.priceBs || null,
      product.stockQuantity || 0,
      product.category || "General",
      product.barcode || "",
      product.imageUri || "",
      product.isCustom ? 1 : 0,
      product.isSoldByWeight ? 1 : 0,
      user.id
      // Insert current user ID
    ).run();
    return new Response(JSON.stringify({ ...product, id, userId: user.id }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost11, "onRequestPost11");
__name2(onRequestPost11, "onRequestPost");
async function onRequestGet9(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM sales WHERE userId = ? ORDER BY timestamp DESC"
    ).bind(user.id).all();
    const sales = [];
    for (const sale of results) {
      const { results: items } = await context.env.DB.prepare(
        "SELECT * FROM sale_items WHERE saleId = ?"
      ).bind(sale.id).all();
      sales.push({ ...sale, items });
    }
    return new Response(JSON.stringify(sales), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet9, "onRequestGet9");
__name2(onRequestGet9, "onRequestGet");
async function onRequestPost12(context) {
  try {
    const user = context.data.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const sale = await context.request.json();
    const id = sale.id || Date.now().toString();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const statements = [];
    statements.push(context.env.DB.prepare(
      `INSERT INTO sales (id, timestamp, total, exchangeRate, paymentMethod, customerId, userId) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      timestamp,
      sale.total,
      sale.exchangeRate || 1,
      sale.paymentMethod || "Efectivo",
      sale.customerId || null,
      user.id
    ));
    for (const item of sale.items) {
      statements.push(context.env.DB.prepare(
        `INSERT INTO sale_items (saleId, productId, name, price, quantity) 
             VALUES (?, ?, ?, ?, ?)`
      ).bind(
        id,
        item.productId || item.id,
        item.name,
        item.price,
        item.quantity
      ));
      if (item.productId || item.id) {
        statements.push(context.env.DB.prepare(
          `UPDATE products SET stockQuantity = stockQuantity - ? WHERE id = ? AND userId = ?`
        ).bind(item.quantity, item.productId || item.id, user.id));
      }
    }
    await context.env.DB.batch(statements);
    return new Response(JSON.stringify({ ...sale, id, timestamp, userId: user.id }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost12, "onRequestPost12");
__name2(onRequestPost12, "onRequestPost");
async function onRequestGet10(context) {
  try {
    const user = context.data.user;
    if (!user || user.role !== "admin") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
    }
    const { results } = await context.env.DB.prepare(
      "SELECT id, email, role, businessInfo FROM users ORDER BY email ASC"
    ).all();
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestGet10, "onRequestGet10");
__name2(onRequestGet10, "onRequestGet");
async function onRequestPost13(context) {
  try {
    const user = context.data.user;
    if (!user || user.role !== "admin") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
    }
    const newUser = await context.request.json();
    if (!newUser.email || !newUser.password) {
      return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400 });
    }
    const myText = new TextEncoder().encode(newUser.password);
    const myDigest = await crypto.subtle.digest(
      { name: "SHA-256" },
      myText
    );
    const hashArray = Array.from(new Uint8Array(myDigest));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    const id = crypto.randomUUID();
    await context.env.DB.prepare(
      `INSERT INTO users (id, email, password, role, businessInfo) 
             VALUES (?, ?, ?, ?, ?)`
    ).bind(
      id,
      newUser.email,
      hashHex,
      newUser.role || "user",
      JSON.stringify(newUser.businessInfo || { currency: "USD" })
    ).run();
    return new Response(JSON.stringify({ success: true, id }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
__name(onRequestPost13, "onRequestPost13");
__name2(onRequestPost13, "onRequestPost");
async function onRequest3(context) {
  return new Response(JSON.stringify({ message: "Hello from Functions!" }), {
    headers: { "Content-Type": "application/json" }
  });
}
__name(onRequest3, "onRequest3");
__name2(onRequest3, "onRequest");
async function onRequest4(context) {
  try {
    const db = context.env.DB;
    const saleItemsInfo = await db.prepare("PRAGMA table_info(sale_items)").all();
    return new Response(JSON.stringify({
      sale_items: saleItemsInfo.results
    }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
}
__name(onRequest4, "onRequest4");
__name2(onRequest4, "onRequest");
async function onRequest5(context) {
  try {
    const db = context.env.DB;
    if (!db) return new Response("DB missing", { status: 500 });
    await db.prepare("PRAGMA foreign_keys = OFF").run();
    const backupUrl = "http://localhost:8080/products_backup.json";
    const response = await fetch(backupUrl);
    if (!response.ok) {
      return new Response(`Failed to fetch backup: ${response.statusText}`, { status: 500 });
    }
    const backupData = await response.json();
    const customers = backupData.db?.customers || [];
    const sales = backupData.db?.sales || [];
    const settings = backupData.settings;
    const email = "mrivero105@gmail.com";
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) {
      return new Response("User mrivero105@gmail.com not found", { status: 404 });
    }
    const userId = user.id;
    await db.prepare("DELETE FROM sale_items").run();
    await db.prepare("DELETE FROM sales").run();
    await db.prepare("DELETE FROM customers").run();
    let customerSuccess = 0;
    const customerStmt = db.prepare(
      "INSERT INTO customers (id, name, idDocument, phone, email, address, userId) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    if (customers.length > 0) {
      const batch = [];
      for (const c of customers) {
        batch.push(customerStmt.bind(
          c.id,
          c.name,
          c.idDocument || "",
          c.phone || "",
          c.email || "",
          c.address || "",
          userId
        ));
      }
      const CHUNK = 50;
      for (let i = 0; i < batch.length; i += CHUNK) {
        await db.batch(batch.slice(i, i + CHUNK));
      }
      customerSuccess = customers.length;
    }
    const referencedProductIds = /* @__PURE__ */ new Set();
    sales.forEach((s) => {
      if (s.items) {
        s.items.forEach((i) => {
          const pid = i.id || i.productId;
          if (pid) referencedProductIds.add(pid);
        });
      }
    });
    if (referencedProductIds.size > 0) {
      const productPlaceholderStmt = db.prepare(
        `INSERT OR IGNORE INTO products (id, name, price, stockQuantity, userId, category, barcode, imageUri, isCustom, isSoldByWeight) 
                 VALUES (?, 'Producto (Restaurado)', 0, 0, ?, 'General', '', '', 0, 0)`
      );
      const batch = [];
      for (const pid of referencedProductIds) {
        batch.push(productPlaceholderStmt.bind(pid, userId));
      }
      const CHUNK = 50;
      for (let i = 0; i < batch.length; i += CHUNK) {
        await db.batch(batch.slice(i, i + CHUNK));
      }
    }
    let salesSuccess = 0;
    let itemsSuccess = 0;
    const salesErrors = [];
    const exchangeRate = settings?.exchangeRate || 1;
    for (const s of sales) {
      try {
        await db.prepare(
          "INSERT INTO sales (id, timestamp, total, paymentMethod, customerId, userId, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          s.id,
          s.timestamp,
          s.total,
          s.paymentMethod || "cash",
          s.customerId || null,
          userId,
          s.exchangeRate || exchangeRate
        ).run();
        salesSuccess++;
        if (s.items && s.items.length > 0) {
          const itemStmts = s.items.map((item) => {
            return db.prepare(
              "INSERT INTO sale_items (saleId, productId, name, price, quantity) VALUES (?, ?, ?, ?, ?)"
            ).bind(
              s.id,
              item.id || item.productId,
              item.name,
              item.price,
              item.quantity
            );
          });
          await db.batch(itemStmts);
          itemsSuccess += s.items.length;
        }
      } catch (err) {
        salesErrors.push({ id: s.id, error: err.message });
        console.error(`Failed sale ${s.id}:`, err);
      }
    }
    if (settings && settings.businessInfo) {
      await db.prepare("UPDATE users SET businessInfo = ? WHERE id = ?").bind(
        JSON.stringify(settings.businessInfo),
        userId
      ).run();
    }
    return new Response(JSON.stringify({
      message: "Restore Full Completed",
      customers: customerSuccess,
      sales: salesSuccess,
      saleItems: itemsSuccess,
      userId,
      salesErrors
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
  }
}
__name(onRequest5, "onRequest5");
__name2(onRequest5, "onRequest");
async function onRequest6(context) {
  try {
    const db = context.env.DB;
    if (!db) return new Response("DB missing", { status: 500 });
    await db.prepare("PRAGMA foreign_keys = OFF").run();
    const backupUrl = "http://localhost:8080/products_backup.json";
    const response = await fetch(backupUrl);
    if (!response.ok) {
      return new Response(`Failed to fetch backup: ${response.statusText}`, { status: 500 });
    }
    const backupData = await response.json();
    const customers = backupData.db?.customers || [];
    const sales = backupData.db?.sales || [];
    const settings = backupData.settings;
    const email = "mrivero105@gmail.com";
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) {
      return new Response("User mrivero105@gmail.com not found", { status: 404 });
    }
    const userId = user.id;
    await db.prepare("DELETE FROM sale_items").run();
    await db.prepare("DELETE FROM sales").run();
    await db.prepare("DELETE FROM customers").run();
    let customerSuccess = 0;
    const customerStmt = db.prepare(
      "INSERT INTO customers (id, name, idDocument, phone, email, address, userId) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    if (customers.length > 0) {
      const batch = [];
      for (const c of customers) {
        batch.push(customerStmt.bind(
          c.id,
          c.name,
          c.idDocument || "",
          c.phone || "",
          c.email || "",
          c.address || "",
          userId
        ));
      }
      const CHUNK = 50;
      for (let i = 0; i < batch.length; i += CHUNK) {
        await db.batch(batch.slice(i, i + CHUNK));
      }
      customerSuccess = customers.length;
    }
    const referencedProductIds = /* @__PURE__ */ new Set();
    sales.forEach((s) => {
      if (s.items) {
        s.items.forEach((i) => {
          const pid = i.id || i.productId;
          if (pid) referencedProductIds.add(pid);
        });
      }
    });
    if (referencedProductIds.size > 0) {
      const productPlaceholderStmt = db.prepare(
        `INSERT OR IGNORE INTO products (id, name, price, stockQuantity, userId, category, barcode, imageUri, isCustom, isSoldByWeight) 
                 VALUES (?, 'Producto (Restaurado)', 0, 0, ?, 'General', '', '', 0, 0)`
      );
      const batch = [];
      for (const pid of referencedProductIds) {
        batch.push(productPlaceholderStmt.bind(pid, userId));
      }
      const CHUNK = 50;
      for (let i = 0; i < batch.length; i += CHUNK) {
        await db.batch(batch.slice(i, i + CHUNK));
      }
    }
    let salesSuccess = 0;
    let itemsSuccess = 0;
    const salesErrors = [];
    const exchangeRate = settings?.exchangeRate || 1;
    for (const s of sales) {
      try {
        await db.prepare(
          "INSERT INTO sales (id, timestamp, total, paymentMethod, customerId, userId, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          s.id,
          s.timestamp,
          s.total,
          s.paymentMethod || "cash",
          s.customerId || null,
          userId,
          s.exchangeRate || exchangeRate
        ).run();
        salesSuccess++;
        if (s.items && s.items.length > 0) {
          const itemStmts = s.items.map((item) => {
            return db.prepare(
              "INSERT INTO sale_items (saleId, productId, name, price, quantity) VALUES (?, ?, ?, ?, ?)"
            ).bind(
              s.id,
              item.id || item.productId,
              item.name,
              item.price,
              item.quantity
            );
          });
          await db.batch(itemStmts);
          itemsSuccess += s.items.length;
        }
      } catch (err) {
        salesErrors.push({ id: s.id, error: err.message });
        console.error(`Failed sale ${s.id}:`, err);
      }
    }
    if (settings && settings.businessInfo) {
      await db.prepare("UPDATE users SET businessInfo = ? WHERE id = ?").bind(
        JSON.stringify(settings.businessInfo),
        userId
      ).run();
    }
    return new Response(JSON.stringify({
      message: "Restore Full Completed",
      customers: customerSuccess,
      sales: salesSuccess,
      saleItems: itemsSuccess,
      userId,
      salesErrors
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
  }
}
__name(onRequest6, "onRequest6");
__name2(onRequest6, "onRequest");
async function onRequest7(context) {
  return new Response(JSON.stringify({ message: "Hello from test index" }), {
    headers: { "Content-Type": "application/json" }
  });
}
__name(onRequest7, "onRequest7");
__name2(onRequest7, "onRequest");
var JWT_SECRET2 = "american-pos-secret-key-change-in-prod";
async function onRequest8(context) {
  const { request, next } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/restore-settings")) {
    return handleCors(await next());
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized: No token provided" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  const token = authHeader.split(" ")[1];
  try {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) throw new Error("Invalid token format");
    const decodedPayload = JSON.parse(atob(payload));
    const expectedSignature = await sign2(header + "." + payload, JWT_SECRET2);
    if (signature !== expectedSignature) {
      throw new Error("Invalid signature");
    }
    context.data.user = decodedPayload;
  } catch (e) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  try {
    const response = await next();
    return handleCors(response);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
__name(onRequest8, "onRequest8");
__name2(onRequest8, "onRequest");
function handleCors(response) {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return newResponse;
}
__name(handleCors, "handleCors");
__name2(handleCors, "handleCors");
async function sign2(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(message)
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(sign2, "sign2");
__name2(sign2, "sign");
var routes = [
  {
    routePath: "/sales/:id/email",
    mountPath: "/sales/:id",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/auth/login",
    mountPath: "/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/cash/close",
    mountPath: "/cash",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/cash/current",
    mountPath: "/cash",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/cash/movement",
    mountPath: "/cash",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/cash/open",
    mountPath: "/cash",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/settings/business",
    mountPath: "/settings",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/settings/business",
    mountPath: "/settings",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/settings/payment-methods",
    mountPath: "/settings",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/settings/payment-methods",
    mountPath: "/settings",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/settings/rate",
    mountPath: "/settings",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/settings/rate",
    mountPath: "/settings",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  },
  {
    routePath: "/test/hello",
    mountPath: "/test",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/customers/:id",
    mountPath: "/customers",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/customers/:id",
    mountPath: "/customers",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut]
  },
  {
    routePath: "/products/:id",
    mountPath: "/products",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete2]
  },
  {
    routePath: "/products/:id",
    mountPath: "/products",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut2]
  },
  {
    routePath: "/users/:id",
    mountPath: "/users",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/customers",
    mountPath: "/customers",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/customers",
    mountPath: "/customers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost9]
  },
  {
    routePath: "/dashboard-summary",
    mountPath: "/",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/debug-db",
    mountPath: "/",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/debug-db",
    mountPath: "/",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost10]
  },
  {
    routePath: "/products",
    mountPath: "/products",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/products",
    mountPath: "/products",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost11]
  },
  {
    routePath: "/sales",
    mountPath: "/sales",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/sales",
    mountPath: "/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost12]
  },
  {
    routePath: "/users",
    mountPath: "/users",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  },
  {
    routePath: "/users",
    mountPath: "/users",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost13]
  },
  {
    routePath: "/hello",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/inspect-schema",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest4]
  },
  {
    routePath: "/restore-full",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest5]
  },
  {
    routePath: "/restore-full-v2",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest6]
  },
  {
    routePath: "/test",
    mountPath: "/test",
    method: "",
    middlewares: [],
    modules: [onRequest7]
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [onRequest8],
    modules: []
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-cC0m8p/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-cC0m8p/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=functionsWorker-0.5773254503436036.js.map
