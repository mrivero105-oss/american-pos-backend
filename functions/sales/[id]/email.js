export async function onRequestPost(context) {
    try {
        const { id } = context.params;
        const { email, receiptHtml } = await context.request.json();

        if (!email) {
            return new Response(JSON.stringify({ error: "Email is required" }), { status: 400 });
        }

        const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwm1lzRdbfaY16qvYqB54yM911KeBBZQH0sppkg_jJHChQqx9Ne9w1d8khBmAPe84sFAg/exec";

        // Forward request to Google Apps Script
        const googleResponse = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                subject: `Recibo de Compra #${id}`,
                html: receiptHtml || `<p>Recibo de compra #${id}</p>`
            })
        });

        if (!googleResponse.ok) {
            throw new Error(`Google Script Error: ${googleResponse.statusText}`);
        }

        // Google Script usually returns a redirect or JSON. 
        // We assume success if the fetch didn't throw.
        const text = await googleResponse.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = { raw: text };
        }

        return new Response(JSON.stringify({ success: true, data }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        console.error('Email Function Error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
