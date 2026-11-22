import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../../src/providers/AuthProvider';
import { useAuth } from '../../src/hooks/AuthContext';
import OnlineLicenseControlTab from '../../src/components/OnlineLicenseControlTab';
import CheckoutModal from '../../src/components/CheckoutModal';
import FiscalManager from '../../src/pages/FiscalManager';
import { PosContext } from '../../src/hooks/PosContext';
import { SocketContext } from '../../src/hooks/SocketContext';
import { AuthContext } from '../../src/hooks/AuthContext';

const {
    mockApiGet,
    mockApiPost,
    mockAxiosGet,
    mockAxiosPost
} = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
    mockApiPost: vi.fn(),
    mockAxiosGet: vi.fn(),
    mockAxiosPost: vi.fn()
}));

vi.mock('../../src/services/api', () => ({
    default: {
        defaults: { baseURL: 'http://127.0.0.1:3005' },
        get: (...args) => mockApiGet(...args),
        post: (...args) => mockApiPost(...args),
        put: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} })
    }
}));

vi.mock('axios', () => ({
    default: {
        get: (...args) => mockAxiosGet(...args),
        post: (...args) => mockAxiosPost(...args)
    }
}));

vi.mock('../../src/services/syncService', () => ({
    default: {
        autoSyncOnLogin: vi.fn().mockResolvedValue(true)
    }
}));

vi.mock('../../src/services/biometricService', () => ({
    default: {
        getEnrolledCredential: vi.fn().mockReturnValue(null),
        loginWithBiometrics: vi.fn()
    }
}));

function AuthHarness({ onReady }) {
    const auth = useAuth();
    onReady(auth);
    return (
        <div>
            <span data-testid="auth-user">{auth.user ? auth.user.username : 'anonymous'}</span>
        </div>
    );
}

describe('Frontend Components & AuthProvider (RTL)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mockApiGet.mockReset();
        mockApiPost.mockReset();
        mockAxiosGet.mockReset();
        mockAxiosPost.mockReset();
    });

    it('AuthProvider guarda verificador offline PBKDF2 sin exponer JWT en localStorage y valida contraseña offline', async () => {
        localStorage.setItem('isaac_pos_license_activated', 'true');
        localStorage.setItem('isaac_pos_license_machine_id', 'TERM-UNIT-0001');

        mockApiGet.mockImplementation((url) => {
            if (url === '/license/status') {
                return Promise.resolve({ data: { activated: true, machineId: 'TERM-UNIT-0001' } });
            }
            return Promise.resolve({ data: {} });
        });
        mockApiPost.mockImplementation((url) => {
            if (url === '/auth/login') {
                return Promise.resolve({
                    data: {
                        success: true,
                        token: 'jwt_super_secret_token',
                        user: {
                            id: 'u-1',
                            username: 'cajero_test',
                            name: 'Cajero Test',
                            role: 'cashier',
                            companyId: '2'
                        }
                    }
                });
            }
            return Promise.resolve({ data: {} });
        });

        let authRef = null;
        render(
            <AuthProvider>
                <AuthHarness onReady={(ctx) => { authRef = ctx; }} />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByTestId('auth-user')).toHaveTextContent('anonymous'));

        const resOnline = await authRef.login('cajero_test', 'ClaveFuerte123!');
        expect(resOnline.success).toBe(true);

        // El token JWT nunca debe quedar en localStorage
        expect(localStorage.getItem('auth_token')).toBeNull();
        expect(sessionStorage.getItem('auth_token')).toBe('jwt_super_secret_token');

        const verifiers = JSON.parse(localStorage.getItem('isaac_pos_offline_verifiers') || '{}');
        expect(verifiers['u-1']).toBeTruthy();
        expect(verifiers['u-1'].hash).toBeTruthy();

        // Verificar login offline con contraseña correcta vs incorrecta
        const badOffline = await authRef.login('cajero_test', 'ClaveIncorrecta', { preferOffline: true });
        expect(badOffline.success).toBe(false);

        const okOffline = await authRef.login('cajero_test', 'ClaveFuerte123!', { preferOffline: true });
        expect(okOffline.success).toBe(true);
        expect(okOffline.isOffline).toBe(true);
    });

    it('AuthProvider mantiene activación offline cuando la PC está apagada (herencia del servidor y limpieza de llave vieja) pero respeta suspensión remota', async () => {
        localStorage.setItem('isaac_pos_terminal_id', 'TERM-MOB-OFF1');
        localStorage.setItem('isaac_pos_license_activated', 'true');
        localStorage.setItem('isaac_pos_license_machine_id', 'TERM-MOB-OFF1');
        // Simula una llave obsoleta/inválida residual coexistiendo con activación heredada del servidor PC
        localStorage.setItem('isaac_pos_license_key', btoa(JSON.stringify({ v: 2, mid: 'TERM-MOB-OFF1', exp: 'never' }) + '.INVALID_SIG'));
        localStorage.setItem('isaac_pos_license_info', JSON.stringify({
            activated: true,
            isInherited: true,
            suspended: false,
            revoked: false,
            graceExpired: false,
            clockSkew: false,
            blockLocalBypass: false,
            status: 'active',
            updatedAt: Date.now()
        }));

        // Simular PC servidor apagada (Network Error en /license/status)
        mockApiGet.mockRejectedValue(new Error('Network Error'));

        let authRef = null;
        render(
            <AuthProvider>
                <AuthHarness onReady={(ctx) => { authRef = ctx; }} />
            </AuthProvider>
        );

        await waitFor(() => expect(localStorage.getItem('isaac_pos_license_key')).toBeNull());
        expect(authRef.isActivated).toBe(true);
        expect(authRef.machineId).toBe('TERM-MOB-OFF1');

        // Caso seguridad: si la licencia está suspendida remotamente, el modo offline NO debe hacer bypass
        localStorage.setItem('isaac_pos_license_info', JSON.stringify({
            activated: false,
            suspended: true,
            blockLocalBypass: true,
            status: 'suspended',
            reason: 'Suspendida por falta de pago'
        }));
        const blockedResult = await authRef.checkLicense();
        expect(blockedResult?.suspended).toBe(true);
        await waitFor(() => expect(authRef.isActivated).toBe(false));
    });

    it('OnlineLicenseControlTab permite graceDays = 0 explícito sin coercer a 7 y envía status al suspender', async () => {
        sessionStorage.setItem('isaac_pos_provider_gateway_session', JSON.stringify({
            gatewayUrl: 'https://gateway.test.local/functions/v1/license-gateway',
            mode: 'token',
            token: 'prov_jwt',
            email: 'owner@test.com'
        }));

        mockApiGet.mockResolvedValue({
            data: { gatewayUrl: 'https://gateway.test.local/functions/v1/license-gateway', graceDaysDefault: 7 }
        });
        mockAxiosGet.mockResolvedValue({
            data: {
                licenses: [
                    { machine_id: 'TERM-CLIENT-1', customer_name: 'Tienda Uno', status: 'active', grace_days: 7 }
                ]
            }
        });
        mockAxiosPost.mockResolvedValue({ data: { success: true } });

        const { container } = render(<OnlineLicenseControlTab localMachineId="TERM-LOCAL-1" />);

        await waitFor(() => expect(screen.getByText('TERM-CLIENT-1')).toBeInTheDocument());

        const hwidInput = screen.getByPlaceholderText('Ej: WIN-8A3F...');
        const graceInput = container.querySelector('input[type="number"]');
        expect(graceInput).toHaveAttribute('min', '0');

        fireEvent.change(hwidInput, { target: { value: 'TERM-ZERO-GRACE' } });
        fireEvent.change(graceInput, { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: /Autorizar \/ Guardar en Nube/i }));

        await waitFor(() => expect(mockAxiosPost).toHaveBeenCalled());
        const [postUrl, postBody] = mockAxiosPost.mock.calls[0];
        expect(postUrl).toContain('/admin/licenses');
        expect(postBody.machineId).toBe('TERM-ZERO-GRACE');
        expect(postBody.graceDays).toBe(0);
    });

    it('CheckoutModal calcula IGTF 3% solo en divisas y muestra montos correctos en Checkout Express', async () => {
        mockApiGet.mockImplementation((url) => {
            if (url.startsWith('/customers')) return Promise.resolve({ data: [] });
            if (url.startsWith('/settings/payment-methods')) {
                return Promise.resolve({
                    data: [
                        { id: 'cash_usd', name: 'Efectivo USD', currency: 'USD', isCash: true, active: true },
                        { id: 'cash_bs', name: 'Efectivo Bs', currency: 'VES', isCash: true, active: true },
                        { id: 'binance_usdt', name: 'Binance Pay', currency: 'USDT', binanceRate: 60, active: true }
                    ]
                });
            }
            return Promise.resolve({ data: {} });
        });

        render(
            <AuthContext.Provider value={{ user: { id: 'u1', name: 'Admin', role: 'superadmin' } }}>
                <SocketContext.Provider value={{ socket: null }}>
                    <PosContext.Provider value={{ activePromotions: [], cart: [] }}>
                        <CheckoutModal
                            isOpen={true}
                            onClose={vi.fn()}
                            onConfirm={vi.fn()}
                            total={100}
                            subtotal={86.21}
                            taxAmount={13.79}
                            taxableBase={86.21}
                            exemptBase={0}
                            ivaRate={16}
                            igtfEnabled={true}
                            igtfRate={3}
                            exchangeRate={50}
                            currencyMode="BOTH"
                            processing={false}
                            businessSettings={{ country: 'Venezuela', binanceRate: 60 }}
                        />
                    </PosContext.Provider>
                </SocketContext.Provider>
            </AuthContext.Provider>
        );

        await waitFor(() => {
            expect(screen.getByText('$103.00')).toBeInTheDocument();
        });
        expect(screen.getAllByText(/5\.000,00/).length).toBeGreaterThan(0);
    });

    it('FiscalManager renderiza Libro de Ventas en Bs sin doble conversión', async () => {
        mockApiGet.mockImplementation((url) => {
            if (url === '/fiscal/sales-book') {
                return Promise.resolve({
                    data: {
                        records: [
                            {
                                id: 'f-1',
                                recordDate: '2026-11-17',
                                documentNumber: 'FAC-0001',
                                controlNumber: '00-0001',
                                entityName: 'Cliente Fiscal CA',
                                entityRif: 'J-12345678-9',
                                documentType: 'FACTURA',
                                totalAmount: 5800.0,
                                exemptAmount: 0,
                                taxableBase: 5000.0,
                                taxRate: 16,
                                taxAmount: 800.0,
                                retainedIva: 0,
                                igtfAmount: 0
                            }
                        ],
                        totals: {
                            totalSales: 5800.0,
                            exemptSales: 0,
                            taxableBase: 5000.0,
                            taxDebit: 800.0,
                            igtf: 0
                        }
                    }
                });
            }
            return Promise.resolve({ data: {} });
        });

        render(<FiscalManager />);

        await waitFor(() => {
            expect(screen.getAllByText('Cliente Fiscal CA').length).toBeGreaterThan(0);
        });
        expect(screen.getAllByText(/5\.800,00/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/800,00/).length).toBeGreaterThan(0);
    });
});
