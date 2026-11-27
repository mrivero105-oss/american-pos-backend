/**
 * Normalización y helpers canónicos de roles y permisos de negocio.
 * Separa explícitamente:
 * - Superadmin de plataforma (único con cruce de tenants vía x-company-id / RLS app.is_superadmin)
 * - Propietario de empresa (owner / dueño / dueno / master)
 * - Administrador de tienda (incluye propietarios)
 * - Supervisor o superior
 */

const PLATFORM_SUPERADMIN_ROLES = new Set(['superadmin']);
const OWNER_ROLE_ALIASES = new Set(['superadmin', 'owner', 'dueño', 'dueno', 'master']);
const ADMIN_ROLE_ALIASES = new Set(['superadmin', 'owner', 'dueño', 'dueno', 'master', 'admin']);
const SUPERVISOR_ROLE_ALIASES = new Set(['superadmin', 'owner', 'dueño', 'dueno', 'master', 'admin', 'supervisor']);

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function isPlatformSuperAdminRole(role) {
    return PLATFORM_SUPERADMIN_ROLES.has(normalizeRole(role));
}

function isCompanyOwnerRole(role) {
    return OWNER_ROLE_ALIASES.has(normalizeRole(role));
}

function isCompanyAdminRole(role) {
    return ADMIN_ROLE_ALIASES.has(normalizeRole(role));
}

function isSupervisorOrAboveRole(role) {
    return SUPERVISOR_ROLE_ALIASES.has(normalizeRole(role));
}

module.exports = {
    PLATFORM_SUPERADMIN_ROLES,
    OWNER_ROLE_ALIASES,
    ADMIN_ROLE_ALIASES,
    SUPERVISOR_ROLE_ALIASES,
    normalizeRole,
    isPlatformSuperAdminRole,
    isCompanyOwnerRole,
    isCompanyAdminRole,
    isSupervisorOrAboveRole
};
