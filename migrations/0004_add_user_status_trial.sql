-- Add status and trial_expires_at to users table
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN trial_expires_at INTEGER;
