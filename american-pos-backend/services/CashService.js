const shiftService = require('./cash/CashShiftService');
const reconciliationService = require('./cash/CashReconciliationService');
const reportService = require('./cash/CashReportService');

/**
 * Fachada principal de Caja.
 * Delega las operaciones a sub-servicios especializados preservando el enlace `this`
 * para mantener polimorfismo e inyección de mocks/spies en pruebas de integración.
 */
class CashService {
    getCurrentShift(userId, companyId, registerId = '1') {
        return shiftService.getCurrentShift.call(this, userId, companyId, registerId);
    }

    getActiveShifts(companyId) {
        return shiftService.getActiveShifts.call(this, companyId);
    }

    getAdminLiveCashDashboard(companyId, requestingUser = null) {
        return reconciliationService.getAdminLiveCashDashboard.call(this, companyId, requestingUser);
    }

    getCashierAuditFile(userId, companyId) {
        return reconciliationService.getCashierAuditFile.call(this, userId, companyId);
    }

    forceCloseShift(adminUser, shiftId, reason = 'Cierre administrativo forzado') {
        return reconciliationService.forceCloseShift.call(this, adminUser, shiftId, reason);
    }

    openShift(reqUser, openingData) {
        return shiftService.openShift.call(this, reqUser, openingData);
    }

    closeShift(reqUser, closingData) {
        return reconciliationService.closeShift.call(this, reqUser, closingData);
    }

    closeShiftBlind(reqUser, closingData) {
        return reconciliationService.closeShiftBlind.call(this, reqUser, closingData);
    }

    getShiftProductsSummary(shiftOrId, companyId, transaction = null) {
        return shiftService.getShiftProductsSummary.call(this, shiftOrId, companyId, transaction);
    }

    generateZReportText(shift, data) {
        return reportService.generateZReportText.call(this, shift, data);
    }

    getShiftStats(userId, openedAt, companyId, registerId = '1', transaction = null, closedAt = null, shiftId = null, branchId = null) {
        return shiftService.getShiftStats.call(this, userId, openedAt, companyId, registerId, transaction, closedAt, shiftId, branchId);
    }

    getLastClosedShift(companyId, registerId = '1') {
        return shiftService.getLastClosedShift.call(this, companyId, registerId);
    }

    addMovement(reqUser, movementData) {
        return shiftService.addMovement.call(this, reqUser, movementData);
    }

    _logAudit(reqUser, action, description, entityId, oldValue, newValue, transaction = null) {
        return reconciliationService._logAudit.call(this, reqUser, action, description, entityId, oldValue, newValue, transaction);
    }

    getAuditSummary(reqUser) {
        return reconciliationService.getAuditSummary.call(this, reqUser);
    }

    _detectAuditPatterns(alerts, ranking) {
        return reconciliationService._detectAuditPatterns.call(this, alerts, ranking);
    }

    getAuditHistory(reqUser, page = 1, limit = 20) {
        return reconciliationService.getAuditHistory.call(this, reqUser, page, limit);
    }

    generateDailyAuditReport(reqUser, dateStr) {
        return reportService.generateDailyAuditReport.call(this, reqUser, dateStr);
    }
}

module.exports = new CashService();
