import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { Loader } from 'lucide-react';

export default function ProtectedRoute({ masterOnly = false, adminOnly = false, requiredPermission = null }) {
    const { user, loading, hasPermission } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">
                <Loader className="animate-spin text-primary-500" size={48} />
            </div>
        );
    }

    // If no user is logged in, redirect to login page
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    const getFallbackRoute = () => {
        if (hasPermission('canAccessPOS')) return '/pos';
        if (hasPermission('canManageInventory')) return '/inventory';
        if (hasPermission('canManageCashShift')) return '/cash-register';
        if (hasPermission('canManageCustomers')) return '/customers';
        if (hasPermission('canViewSalesHistory')) return '/sales-manager';
        if (hasPermission('canManageSuppliers')) return '/suppliers';
        if (hasPermission('canViewReports')) return '/dashboard';
        return '/login';
    };

    // Master enforcement (Hardcoded to mrivero105@gmail.com)
    if (masterOnly && user.email !== 'mrivero105@gmail.com') {
        console.warn('MasterGate: Access denied for', user.email);
        return <Navigate to={getFallbackRoute()} replace />;
    }

    // Admin enforcement (Allows admin, superadmin, owner, and dueño)
    if (adminOnly && !['admin', 'superadmin', 'owner', 'dueño'].includes((user.role || '').toLowerCase())) {
        console.warn('AdminGate: Access denied for', user.username, 'with role', user.role);
        return <Navigate to={getFallbackRoute()} replace />;
    }

    // Permission enforcement
    if (requiredPermission) {
        const hasAccess = Array.isArray(requiredPermission)
            ? requiredPermission.some(p => hasPermission(p))
            : hasPermission(requiredPermission);

        if (!hasAccess) {
            console.warn('PermissionGate: Access denied for permission:', requiredPermission);
            return <Navigate to={getFallbackRoute()} replace />;
        }
    }

    // Otherwise rendered nested routes
    return <Outlet />;
}
