-- Migration to add Cash Register tables
-- Created for American POS logic

CREATE TABLE IF NOT EXISTS cash_shifts (
    id TEXT PRIMARY KEY,
    openedAt TEXT NOT NULL,
    closedAt TEXT,
    startingCash REAL NOT NULL DEFAULT 0,
    expectedCash REAL NOT NULL DEFAULT 0,
    actualCash REAL NOT NULL DEFAULT 0,
    difference REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
    userId TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id TEXT PRIMARY KEY,
    shiftId TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('in', 'out')),
    amount REAL NOT NULL,
    reason TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (shiftId) REFERENCES cash_shifts(id)
);

-- Index for faster open shift lookup
CREATE INDEX IF NOT EXISTS idx_cash_shifts_status ON cash_shifts(status);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shiftId ON cash_movements(shiftId);
