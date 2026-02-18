ALTER TABLE users
  ALTER COLUMN openid DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'WECHAT',
  ADD COLUMN IF NOT EXISTS field_of_study TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_email_key'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_provider_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_auth_provider_check
      CHECK (auth_provider IN ('WECHAT', 'EMAIL'));
  END IF;
END $$;

UPDATE users
SET auth_provider = 'WECHAT'
WHERE auth_provider IS NULL OR auth_provider = '';
