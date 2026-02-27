CREATE TABLE IF NOT EXISTS "user_profile_settings" (
  "user_id" TEXT PRIMARY KEY,
  "badge_key" TEXT,
  "badge_text" TEXT,
  "preferred_language" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "fk_user_profile_settings_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "chk_user_profile_settings_preferred_language"
    CHECK ("preferred_language" IS NULL OR "preferred_language" IN ('en', 'zh'))
);
