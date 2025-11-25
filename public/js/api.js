'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
    };
}

// Helper function to handle auth errors
function handleAuthError(response) {
    if (response.status === 401) {
        localStorage.removeItem('authToken');
        window.location.href = 'login.html';
        throw new Error('Unauthorized');
    }
}


export const api = {
    products: {
        getAll: async () => {
            const response = await fetch(`${API_BASE_URL}/products`, {
                headers: await getAuthHeaders()
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error fetching products');
            return response.json();
        },
        create: async (product) => {
            const response = await fetch(`${API_BASE_URL}/products`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify(product)
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error creating product');
            return response.json();
        },
        update: async (id, product) => {
            const response = await fetch(`${API_BASE_URL}/products/${id}`, {
                method: 'PUT',
                headers: await getAuthHeaders(),
                body: JSON.stringify(product)
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error updating product');
            return response.json();
        },
        delete: async (id) => {
            const response = await fetch(`${API_BASE_URL}/products/${id}`, {
                method: 'DELETE',
                headers: await getAuthHeaders()
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error deleting product');
            return response.json();
        }
    },
    sales: {
        create: async (saleData) => {
            const response = await fetch(`${API_BASE_URL}/sales`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify(saleData)
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error creating sale');
            return response.json();
        },
        getAll: async (date = null) => {
            let url = `${API_BASE_URL}/sales`;
            if (date) url += `?date=${date}`;
            const response = await fetch(url, {
                headers: await getAuthHeaders()
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error fetching sales');
            return response.json();
        },
        emailReceipt: async (saleId, email) => {
            const response = await fetch(`${API_BASE_URL}/sales/${saleId}/email`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify({ email })
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error sending email');
            return response.json();
        }
    },
    dashboard: {
        getSummary: async (date = null) => {
            let url = `${API_BASE_URL}/dashboard-summary`;
            if (date) url += `?date=${date}`;
            const response = await fetch(url, {
                headers: await getAuthHeaders()
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error fetching dashboard summary');
            return response.json();
        }
    },
    settings: {
        getRate: async () => {
            const response = await fetch(`${API_BASE_URL}/settings/rate`, {
                headers: await getAuthHeaders()
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error fetching rate');
            return response.json();
        },
        updateRate: async (rate) => {
            const response = await fetch(`${API_BASE_URL}/settings/rate`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify({ rate })
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Error updating rate');
            return response.json();
        },
        getBusinessInfo: async () => {
            const headers = await getAuthHeaders();
            const response = await fetch(`${API_BASE_URL}/settings/business`, { headers });
            handleAuthError(response);
            if (!response.ok) throw new Error('Failed to fetch business info');
            return response.json();
        },
        updateBusinessInfo: async (info) => {
            const headers = await getAuthHeaders();
            const response = await fetch(`${API_BASE_URL}/settings/business`, {
                method: 'POST',
                headers,
                body: JSON.stringify(info)
            });
            handleAuthError(response);
            if (!response.ok) throw new Error('Failed to update business info');
            return response.json();
        },
        getPaymentMethods: async () => {
            const res = await fetch(`${API_BASE_URL}/settings/payment-methods`, {
                headers: await getAuthHeaders()
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al obtener métodos de pago');
            return res.json();
        },
        updatePaymentMethods: async (paymentMethods) => {
            const res = await fetch(`${API_BASE_URL}/settings/payment-methods`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify({ paymentMethods })
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al actualizar métodos de pago');
            return res.json();
        }
    },
    customers: {
        getAll: async () => {
            const res = await fetch(`${API_BASE_URL}/customers`, {
                headers: await getAuthHeaders()
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al obtener clientes');
            return res.json();
        },
        getById: async (id) => {
            const res = await fetch(`${API_BASE_URL}/customers/${id}`, {
                headers: await getAuthHeaders()
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al obtener cliente');
            return res.json();
        },
        create: async (customerData) => {
            const res = await fetch(`${API_BASE_URL}/customers`, {
                method: 'POST',
                headers: await getAuthHeaders(),
                body: JSON.stringify(customerData)
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al crear cliente');
            return res.json();
        },
        update: async (id, customerData) => {
            const res = await fetch(`${API_BASE_URL}/customers/${id}`, {
                method: 'PUT',
                headers: await getAuthHeaders(),
                body: JSON.stringify(customerData)
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al actualizar cliente');
            return res.json();
        },
        delete: async (id) => {
            const res = await fetch(`${API_BASE_URL}/customers/${id}`, {
                method: 'DELETE',
                headers: await getAuthHeaders()
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al borrar cliente');
            return res.json();
        },
        getSales: async (id) => {
            const res = await fetch(`${API_BASE_URL}/customers/${id}/sales`, {
                headers: await getAuthHeaders()
            });
            handleAuthError(res);
            if (!res.ok) throw new Error('Error al obtener ventas del cliente');
            return res.json();
        }
    }
};
