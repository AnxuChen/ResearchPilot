import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import pdfParse from "pdf-parse";
import { Pool } from "pg";
import XLSX from "xlsx";

const app = express();
app.use(express.json({ limit: "80mb" }));

const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || "change_this_jwt_secret";
const wechatAppId = process.env.WECHAT_APP_ID || "";
const wechatAppSecret = process.env.WECHAT_APP_SECRET || "";
const openAlexApiKey = process.env.OPENALEX_API_KEY || "";
const DEFAULT_LLM_MODEL_POOL = [
  "gpt-5.2-chat-latest",
  "minimax-m2.5",
  "gpt-5",
];
const llmApiKey = process.env.LLM_API_KEY || "";
const llmBaseUrl = process.env.LLM_BASE_URL || "https://api.chatanywhere.tech/";
const configuredLlmModelPool = parseLlmModelPool(process.env.LLM_MODEL_POOL || "");
const legacyReviewModelName = String(process.env.REVIEW_MODEL_NAME || "").trim();
const llmModelPool = configuredLlmModelPool.length
  ? configuredLlmModelPool
  : legacyReviewModelName
    ? [legacyReviewModelName, ...DEFAULT_LLM_MODEL_POOL].filter(
        (model, index, arr) => arr.indexOf(model) === index
      )
    : DEFAULT_LLM_MODEL_POOL.slice();
const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS || 90000);
const llmPerModelTimeoutMs = Number(process.env.LLM_PER_MODEL_TIMEOUT_MS || 30000);
const defaultFeedKeywords =
  process.env.DEFAULT_FEED_KEYWORDS ||
  "large language model, retrieval augmented generation, computer vision";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const PAPER_ACTION_TYPES = new Set(["PASS", "MARK", "READ"]);
const LAB_TOOL_TYPES = new Set([
  "ACADEMIC_PLS",
  "CITATIONS",
  "DATA_VIZ",
  "REVIEW_SIMULATOR",
]);
const SUPPORTED_PROFILE_LANGUAGES = new Set(["en", "zh"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROJECT_COLOR_THEMES = new Set([
  "green",
  "purple",
  "yellow",
  "blue",
  "orange",
]);
const SUPPORTED_MANUSCRIPT_EXTENSIONS = new Set(["pdf", "txt", "md"]);
const MAX_MANUSCRIPT_BASE64_CHARS = 70 * 1024 * 1024;
const MAX_REMOTE_MANUSCRIPT_BYTES = 55 * 1024 * 1024;
const MAX_MANUSCRIPT_CHARS_FOR_REVIEW = 24000;
const SUPPORTED_DATAVIZ_EXTENSIONS = new Set(["csv", "json", "xls", "xlsx"]);
const SUPPORTED_DATAVIZ_CHART_TYPES = new Set(["line", "bar", "scatter", "heatmap"]);
const MAX_DATAVIZ_SAMPLE_ROWS = 220;
const MAX_DATAVIZ_COLUMNS = 24;
const MAX_ACADEMIC_TEXT_CHARS = 20000;
const MAX_CITATION_TEXT_CHARS = 12000;
const ALLOWED_REMOTE_HOST_SUFFIXES = [".myqcloud.com", ".tcb.qcloud.la"];
const REVIEW_TASK_TTL_MS = 2 * 60 * 60 * 1000;
const DATAVIZ_TASK_TTL_MS = 2 * 60 * 60 * 1000;
const reviewTasks = new Map();
const dataVizTasks = new Map();
const DEFAULT_PROJECT_DEADLINES = [
  {
    abbr: "CVPR",
    fullName: "Computer Vision and Pattern Recognition",
    location: "Seattle, USA",
    startDate: "2026-06-17",
    deadline: "2026-02-22",
    progress: 90,
    note: "Abstract registration is closed. Full paper submission only.",
    colorTheme: "orange",
  },
  {
    abbr: "NeurIPS",
    fullName: "Neural Information Processing Systems",
    location: "Vancouver, Canada",
    startDate: "2026-12-01",
    deadline: "2026-03-06",
    progress: 85,
    note: "",
    colorTheme: "green",
  },
  {
    abbr: "CHI",
    fullName: "Human Factors in Computing Systems",
    location: "Yokohama, JP",
    startDate: "2026-05-01",
    deadline: "2026-04-06",
    progress: 40,
    note: "",
    colorTheme: "purple",
  },
  {
    abbr: "ICLR",
    fullName: "International Conference on Learning Representations",
    location: "Vienna, Austria",
    startDate: "2026-05-21",
    deadline: "2026-05-21",
    progress: 25,
    note: "",
    colorTheme: "yellow",
  },
  {
    abbr: "AAAI",
    fullName: "Association for the Advancement of AI",
    location: "Philadelphia, USA",
    startDate: "2026-07-20",
    deadline: "2026-07-20",
    progress: 10,
    note: "",
    colorTheme: "blue",
  },
];

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseLlmModelPool(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const items = raw
    .split(/[,\n]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return items.filter((item, index) => items.indexOf(item) === index);
}

function getPrimaryLlmModel() {
  return llmModelPool[0] || "";
}

function normalizeKeywords(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCommentSortBy(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "likes" || raw === "like") return "likes";
  return "time";
}

function normalizeSortOrder(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "asc") return "ASC";
  return "DESC";
}

function normalizeCitationStyle(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "AUTO";
  if (raw === "APA7" || raw === "APA") return "APA7";
  if (raw === "MLA9" || raw === "MLA") return "MLA9";
  if (raw === "CHICAGO") return "CHICAGO";
  return "AUTO";
}

function normalizeChartType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "line";
  if (SUPPORTED_DATAVIZ_CHART_TYPES.has(raw)) return raw;
  return "line";
}

function normalizeLabToolType(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (LAB_TOOL_TYPES.has(raw)) return raw;
  return "";
}

function normalizePreferredLanguage(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (SUPPORTED_PROFILE_LANGUAGES.has(raw)) return raw;
  return null;
}

function normalizeProfileBadgeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.slice(0, 48);
}

function normalizeProfileBadgeText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.slice(0, 24);
}

function sanitizeRecentTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function buildRecentPreview(value, maxLength = 160) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function mapLabRecentRow(row) {
  const inputPayload =
    row?.input_payload && typeof row.input_payload === "object" ? row.input_payload : {};
  const outputPayload =
    row?.output_payload && typeof row.output_payload === "object" ? row.output_payload : {};
  const toolType = normalizeLabToolType(row?.tool_type);

  let inputPreview = "";
  let outputPreview = "";
  if (toolType === "ACADEMIC_PLS") {
    inputPreview = buildRecentPreview(inputPayload?.text || "");
    outputPreview = buildRecentPreview(outputPayload?.polishedText || "");
  } else if (toolType === "CITATIONS") {
    inputPreview = buildRecentPreview(inputPayload?.text || "");
    outputPreview = buildRecentPreview(outputPayload?.formattedText || "");
  } else if (toolType === "DATA_VIZ") {
    inputPreview = buildRecentPreview(
      `${inputPayload?.fileName || ""} ${inputPayload?.chartType || ""}`
    );
    outputPreview = buildRecentPreview(
      `${outputPayload?.title || ""} ${outputPayload?.summary || ""}`
    );
  } else if (toolType === "REVIEW_SIMULATOR") {
    const reviewPayload =
      outputPayload?.review && typeof outputPayload.review === "object"
        ? outputPayload.review
        : outputPayload;
    inputPreview = buildRecentPreview(inputPayload?.fileName || "");
    outputPreview = buildRecentPreview(
      `${reviewPayload?.decision || ""} ${reviewPayload?.score ?? ""} ${reviewPayload?.summary || ""}`
    );
  } else {
    inputPreview = buildRecentPreview(JSON.stringify(inputPayload));
    outputPreview = buildRecentPreview(JSON.stringify(outputPayload));
  }

  return {
    id: row.id,
    toolType,
    title: row.title || "",
    inputPayload,
    outputPayload,
    inputPreview,
    outputPreview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isLabRecentToolTypeConstraintError(err) {
  if (!err) return false;
  const code = String(err?.code || "").trim();
  const detail = `${err?.message || ""} ${err?.detail || ""}`.toLowerCase();
  if (code === "23514" && detail.includes("chk_lab_recent_records_tool_type")) {
    return true;
  }
  return detail.includes("chk_lab_recent_records_tool_type");
}

let ensureLabRecentToolTypeConstraintPromise = null;

async function ensureLabRecentToolTypeConstraint() {
  if (ensureLabRecentToolTypeConstraintPromise) {
    return ensureLabRecentToolTypeConstraintPromise;
  }
  ensureLabRecentToolTypeConstraintPromise = (async () => {
    await pool.query(
      `
        ALTER TABLE lab_recent_records
        DROP CONSTRAINT IF EXISTS chk_lab_recent_records_tool_type;
      `
    );
    await pool.query(
      `
        ALTER TABLE lab_recent_records
        ADD CONSTRAINT chk_lab_recent_records_tool_type
        CHECK (tool_type IN ('ACADEMIC_PLS', 'CITATIONS', 'DATA_VIZ', 'REVIEW_SIMULATOR'));
      `
    );
  })();

  try {
    await ensureLabRecentToolTypeConstraintPromise;
  } finally {
    ensureLabRecentToolTypeConstraintPromise = null;
  }
}

let ensureUserProfileSettingsTablePromise = null;

async function ensureUserProfileSettingsTable() {
  if (ensureUserProfileSettingsTablePromise) {
    return ensureUserProfileSettingsTablePromise;
  }
  ensureUserProfileSettingsTablePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profile_settings (
        user_id TEXT PRIMARY KEY
          REFERENCES users(id) ON DELETE CASCADE,
        badge_key TEXT,
        badge_text TEXT,
        preferred_language TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_user_profile_settings_preferred_language
          CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'zh'))
      );
    `);
  })();

  try {
    await ensureUserProfileSettingsTablePromise;
  } finally {
    ensureUserProfileSettingsTablePromise = null;
  }
}

function mapUserProfileSettingsRow(row) {
  return {
    badgeKey: row?.badge_key ? String(row.badge_key).trim() : null,
    badgeText: row?.badge_text ? String(row.badge_text).trim() : null,
    preferredLanguage: row?.preferred_language
      ? normalizePreferredLanguage(row.preferred_language)
      : null,
  };
}

async function getUserProfileSettingsByUserId(userId) {
  if (!userId) return null;
  await ensureUserProfileSettingsTable();
  const result = await pool.query(
    `
      SELECT
        user_id,
        badge_key,
        badge_text,
        preferred_language,
        created_at,
        updated_at
      FROM user_profile_settings
      WHERE user_id = $1
      LIMIT 1;
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function upsertUserProfileSettingsByUserId({
  userId,
  hasBadgeKey,
  badgeKey,
  hasBadgeText,
  badgeText,
  hasPreferredLanguage,
  preferredLanguage,
}) {
  if (!userId) return null;
  if (!hasBadgeKey && !hasBadgeText && !hasPreferredLanguage) {
    return getUserProfileSettingsByUserId(userId);
  }

  await ensureUserProfileSettingsTable();
  const result = await pool.query(
    `
      INSERT INTO user_profile_settings (
        user_id,
        badge_key,
        badge_text,
        preferred_language
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE
      SET
        badge_key = CASE WHEN $5::boolean THEN EXCLUDED.badge_key ELSE user_profile_settings.badge_key END,
        badge_text = CASE WHEN $6::boolean THEN EXCLUDED.badge_text ELSE user_profile_settings.badge_text END,
        preferred_language = CASE
          WHEN $7::boolean THEN EXCLUDED.preferred_language
          ELSE user_profile_settings.preferred_language
        END,
        updated_at = NOW()
      RETURNING
        user_id,
        badge_key,
        badge_text,
        preferred_language,
        created_at,
        updated_at;
    `,
    [
      userId,
      badgeKey,
      badgeText,
      preferredLanguage,
      hasBadgeKey,
      hasBadgeText,
      hasPreferredLanguage,
    ]
  );
  return result.rows[0] || null;
}

async function saveLabRecentRecord({
  userId,
  toolType,
  title = "",
  inputPayload = {},
  outputPayload = {},
}) {
  const normalizedToolType = normalizeLabToolType(toolType);
  if (!userId || !normalizedToolType) return;

  const values = [
    crypto.randomUUID(),
    userId,
    normalizedToolType,
    sanitizeRecentTitle(title),
    JSON.stringify(inputPayload || {}),
    JSON.stringify(outputPayload || {}),
  ];
  const insertSql = `
    INSERT INTO lab_recent_records (
      id,
      user_id,
      tool_type,
      title,
      input_payload,
      output_payload
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb);
  `;

  try {
    await pool.query(insertSql, values);
  } catch (err) {
    if (
      normalizedToolType === "REVIEW_SIMULATOR" &&
      isLabRecentToolTypeConstraintError(err)
    ) {
      await ensureLabRecentToolTypeConstraint();
      await pool.query(insertSql, values);
    } else {
      throw err;
    }
  }

  // Keep only the latest 30 records per user+tool to control growth.
  await pool.query(
    `
      DELETE FROM lab_recent_records
      WHERE id IN (
        SELECT id
        FROM lab_recent_records
        WHERE user_id = $1
          AND tool_type = $2
        ORDER BY created_at DESC
        OFFSET 30
      );
    `,
    [userId, normalizedToolType]
  );
}

async function listLabRecentRecords({ userId, toolType, limit }) {
  const normalizedToolType = normalizeLabToolType(toolType);
  if (!userId || !normalizedToolType) return [];
  const safeLimit = parsePositiveInt(limit, 10, 30);

  const result = await pool.query(
    `
      SELECT
        id,
        user_id,
        tool_type,
        title,
        input_payload,
        output_payload,
        created_at,
        updated_at
      FROM lab_recent_records
      WHERE user_id = $1
        AND tool_type = $2
      ORDER BY created_at DESC
      LIMIT $3;
    `,
    [userId, normalizedToolType, safeLimit]
  );

  return result.rows.map(mapLabRecentRow);
}

async function deleteLabRecentRecord({ userId, toolType, recordId }) {
  const normalizedToolType = normalizeLabToolType(toolType);
  const normalizedRecordId = String(recordId || "").trim();
  if (!userId || !normalizedToolType || !normalizedRecordId) {
    return false;
  }

  const result = await pool.query(
    `
      DELETE FROM lab_recent_records
      WHERE id = $1
        AND user_id = $2
        AND tool_type = $3
      RETURNING id;
    `,
    [normalizedRecordId, userId, normalizedToolType]
  );

  return Boolean(result.rows[0]?.id);
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeProjectDate(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw createHttpError(400, "invalid_project_date");
    }
    return null;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createHttpError(400, "invalid_project_date");
  }
  const parsedDate = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    throw createHttpError(400, "invalid_project_date");
  }
  return normalized;
}

function normalizeProjectProgress(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) return 0;
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createHttpError(400, "invalid_project_progress");
  }
  const normalized = Math.round(numeric);
  if (normalized < 0 || normalized > 100) {
    throw createHttpError(400, "invalid_project_progress");
  }
  return normalized;
}

function normalizeProjectColorTheme(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) return "green";
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!PROJECT_COLOR_THEMES.has(normalized)) {
    throw createHttpError(400, "invalid_project_color_theme");
  }
  return normalized;
}

function normalizeProjectText(value, {
  required = false,
  maxLength = 128,
  allowEmpty = false,
  field = "invalid_project_field",
} = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw createHttpError(400, field);
  }
  const normalized = String(value).trim();
  if (!normalized && !allowEmpty) {
    throw createHttpError(400, field);
  }
  if (normalized.length > maxLength) {
    throw createHttpError(400, field);
  }
  return normalized;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function parseProjectDeadlinePayload(body, { partial = false } = {}) {
  const raw = body || {};
  const payload = {};

  if (!partial || hasOwn(raw, "abbr")) {
    payload.abbr = normalizeProjectText(raw.abbr, {
      required: !partial,
      maxLength: 24,
      allowEmpty: false,
      field: "invalid_project_abbr",
    });
  }

  if (!partial || hasOwn(raw, "fullName")) {
    payload.fullName = normalizeProjectText(raw.fullName, {
      required: !partial,
      maxLength: 256,
      allowEmpty: false,
      field: "invalid_project_full_name",
    });
  }

  if (!partial || hasOwn(raw, "location")) {
    payload.location = normalizeProjectText(raw.location, {
      required: false,
      maxLength: 128,
      allowEmpty: true,
      field: "invalid_project_location",
    });
    if (payload.location === null) payload.location = "";
  }

  if (!partial || hasOwn(raw, "startDate")) {
    payload.startDate = normalizeProjectDate(raw.startDate, { required: false });
  }

  if (!partial || hasOwn(raw, "deadline")) {
    payload.deadline = normalizeProjectDate(raw.deadline, { required: true });
  }

  if (!partial || hasOwn(raw, "progress")) {
    payload.progress = normalizeProjectProgress(raw.progress, {
      required: !partial,
    });
    if (payload.progress === null) payload.progress = 0;
  }

  if (!partial || hasOwn(raw, "note")) {
    payload.note = normalizeProjectText(raw.note, {
      required: false,
      maxLength: 1000,
      allowEmpty: true,
      field: "invalid_project_note",
    });
    if (payload.note === null) payload.note = "";
  }

  if (!partial || hasOwn(raw, "colorTheme")) {
    payload.colorTheme = normalizeProjectColorTheme(raw.colorTheme, {
      required: !partial,
    });
    if (!payload.colorTheme) payload.colorTheme = "green";
  }

  return payload;
}

function mapProjectDeadlineRow(row) {
  const formatDateOnly = (value) => {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.slice(0, 10);
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  };

  const startDate = formatDateOnly(row?.start_date);
  const deadline = formatDateOnly(row?.deadline);
  const year = startDate ? startDate.slice(0, 4) : deadline ? deadline.slice(0, 4) : "";

  return {
    id: row.id,
    abbr: row.abbr || "",
    year,
    fullName: row.full_name || "",
    location: row.location || "",
    startDate,
    deadline,
    progress: Number.isFinite(row.progress) ? row.progress : Number(row.progress || 0),
    note: row.note || "",
    colorTheme: row.color_theme || "green",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, storedDigestHex] = parts;
  if (!salt || !storedDigestHex) return false;
  const derivedHex = crypto.scryptSync(password, salt, 64).toString("hex");
  const storedBuffer = Buffer.from(storedDigestHex, "hex");
  const derivedBuffer = Buffer.from(derivedHex, "hex");
  if (storedBuffer.length !== derivedBuffer.length) return false;
  return crypto.timingSafeEqual(storedBuffer, derivedBuffer);
}

function buildAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      openid: user.openid || undefined,
      email: user.email || undefined,
    },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

function buildUserPayload(user, profileSettings = null) {
  const settings = mapUserProfileSettingsRow(profileSettings || null);
  return {
    id: user.id,
    openid: user.openid || null,
    email: user.email || null,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    authProvider: user.auth_provider || null,
    fieldOfStudy: user.field_of_study || null,
    badgeKey: settings.badgeKey,
    badgeText: settings.badgeText,
    preferredLanguage: settings.preferredLanguage,
  };
}

function isAllowedAvatarUrl(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return true;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function createHttpError(status, message, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.publicMessage = message;
  err.detail = detail;
  return err;
}

function extractLlmProviderError(payload, statusCode) {
  if (payload?.error?.message) return String(payload.error.message);
  if (payload?.errors?.message) return String(payload.errors.message);
  if (payload?.message) return String(payload.message);
  return `llm_http_${statusCode}`;
}

function buildLlmChatCompletionsUrl(rawBaseUrl) {
  const base = String(rawBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "https://api-inference.modelscope.cn/v1/chat/completions";
  if (/\/v1\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function extFromFileName(fileName = "") {
  const safe = String(fileName || "").trim().toLowerCase();
  if (!safe.includes(".")) return "";
  return safe.split(".").pop() || "";
}

function decodeBase64Buffer(contentBase64) {
  if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
    throw createHttpError(400, "invalid_content_base64");
  }
  if (contentBase64.length > MAX_MANUSCRIPT_BASE64_CHARS) {
    throw createHttpError(400, "manuscript_too_large");
  }

  try {
    const buffer = Buffer.from(contentBase64.trim(), "base64");
    if (!buffer || !buffer.length) {
      throw new Error("empty_buffer");
    }
    return buffer;
  } catch {
    throw createHttpError(400, "invalid_content_base64");
  }
}

function isAllowedRemoteManuscriptHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  return ALLOWED_REMOTE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

async function fetchRemoteFileBuffer(fileUrl) {
  let urlObj;
  try {
    urlObj = new URL(String(fileUrl || "").trim());
  } catch {
    throw createHttpError(400, "invalid_file_url");
  }

  if (urlObj.protocol !== "https:") {
    throw createHttpError(400, "invalid_file_url_protocol");
  }
  if (!isAllowedRemoteManuscriptHost(urlObj.hostname)) {
    throw createHttpError(400, "invalid_file_url_host");
  }

  const resp = await fetch(urlObj.toString(), { method: "GET" });
  if (!resp.ok) {
    throw createHttpError(400, "file_download_failed", `http_${resp.status}`);
  }

  const contentLength = Number(resp.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_MANUSCRIPT_BYTES) {
    throw createHttpError(400, "manuscript_too_large");
  }

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw createHttpError(400, "manuscript_content_empty");
  }
  if (buffer.length > MAX_REMOTE_MANUSCRIPT_BYTES) {
    throw createHttpError(400, "manuscript_too_large");
  }
  return buffer;
}

async function extractManuscriptText({
  fileName,
  mimeType,
  extension,
  contentBase64,
  fileUrl,
}) {
  const derivedExt = String(extension || "").toLowerCase() || extFromFileName(fileName);
  if (!SUPPORTED_MANUSCRIPT_EXTENSIONS.has(derivedExt)) {
    throw createHttpError(400, "unsupported_file_type");
  }

  let buffer;
  if (typeof contentBase64 === "string" && contentBase64.trim()) {
    buffer = decodeBase64Buffer(contentBase64);
  } else if (typeof fileUrl === "string" && fileUrl.trim()) {
    buffer = await fetchRemoteFileBuffer(fileUrl);
  } else {
    throw createHttpError(400, "invalid_payload");
  }

  const normalizedMimeType = String(mimeType || "").toLowerCase();

  let manuscriptText = "";
  if (derivedExt === "pdf" || normalizedMimeType.includes("pdf")) {
    try {
      const parsed = await pdfParse(buffer);
      manuscriptText = String(parsed?.text || "");
    } catch (err) {
      throw createHttpError(400, "pdf_parse_failed", String(err?.message || err));
    }
  } else {
    manuscriptText = buffer.toString("utf8");
  }

  const cleaned = manuscriptText
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned || cleaned.length < 60) {
    throw createHttpError(400, "manuscript_content_too_short");
  }

  return {
    text: cleaned.slice(0, MAX_MANUSCRIPT_CHARS_FOR_REVIEW),
    extension: derivedExt,
  };
}

function parseJsonFromLlmContent(content) {
  const raw = String(content || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {}

  const markdownJsonMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (markdownJsonMatch?.[1]) {
    try {
      return JSON.parse(markdownJsonMatch[1].trim());
    } catch {}
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonLike = raw.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonLike);
    } catch {}
  }

  return null;
}

function normalizeStringArray(input, maxLength = 5) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxLength);
}

function normalizeDecision(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("reject")) return "REJECT";
  if (lower.includes("accept")) return "ACCEPT";
  return "REJECT";
}

function normalizeScore(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 10 && n <= 100) n /= 10;
  return Math.max(0, Math.min(10, Number(n.toFixed(1))));
}

function normalizeReviewResult(rawResult) {
  const raw = rawResult || {};
  return {
    decision: normalizeDecision(raw.decision),
    score: normalizeScore(raw.score),
    summary: String(raw.summary || "").trim(),
    strengths: normalizeStringArray(raw.strengths),
    weaknesses: normalizeStringArray(raw.weaknesses),
    suggestions: normalizeStringArray(raw.suggestions),
  };
}

function normalizeAiReadingSummaryText(value, maxLength = 2200) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noCodeFence = raw
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return noCodeFence.slice(0, maxLength);
}

function buildPaperAiReadingFallback(row, language = "en") {
  const isZh = language === "zh";
  const title = String(row?.title || "").trim() || (isZh ? "未命名论文" : "Untitled paper");
  const venue = String(row?.venue || "").trim() || (isZh ? "未知来源" : "Unknown venue");
  const year = Number.isFinite(row?.year) ? row.year : null;
  const citationCount = Number.isFinite(row?.citation_count)
    ? row.citation_count
    : Number(row?.citation_count || 0);
  const abstract = String(row?.abstract || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);

  if (isZh) {
    return [
      `1. 核心观点：该论文《${title}》围绕研究问题提出了解决思路。`,
      `2. 研究价值：工作发表于 ${venue}${year ? `（${year}）` : ""}，当前引用约 ${citationCount} 次。`,
      `3. 方法与发现：${abstract || "当前数据未提供足够摘要信息，请阅读原文获取完整细节。"}`
    ].join("\n");
  }

  return [
    `1. Core idea: The paper "${title}" proposes an approach to tackle its target problem.`,
    `2. Why it matters: It is associated with ${venue}${year ? ` (${year})` : ""} and has about ${citationCount} citations.`,
    `3. Methods/findings: ${abstract || "Metadata is limited, so please refer to the full paper for complete details."}`
  ].join("\n");
}

async function generatePaperAiReadingSummary({ row, language = "en" }) {
  const normalizedLanguage = normalizePreferredLanguage(language) || "en";
  const isZh = normalizedLanguage === "zh";

  const title = String(row?.title || "").trim();
  const authors = Array.isArray(row?.authors)
    ? row.authors
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 12)
        .join(", ")
    : "";
  const tags = Array.isArray(row?.tags)
    ? row.tags
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 10)
        .join(", ")
    : "";
  const venue = String(row?.venue || "").trim();
  const year = Number.isFinite(row?.year) ? row.year : "";
  const citationCount = Number.isFinite(row?.citation_count)
    ? row.citation_count
    : Number(row?.citation_count || 0);
  const abstract = String(row?.abstract || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
  const summaryBg = String(row?.summary_bg || "").trim();
  const summaryMethod = String(row?.summary_method || "").trim();
  const summaryContrib = String(row?.summary_contrib || "").trim();

  const completion = await requestLlmCompletion({
    temperature: 0.2,
    maxTokens: 760,
    timeoutMs: 45000,
    messages: [
      {
        role: "system",
        content: isZh
          ? "你是资深学术阅读助手。只能基于给定元数据总结，不要编造事实。输出纯文本，不要使用 Markdown 代码块。"
          : "You are an expert academic reading assistant. Summarize strictly from provided metadata and do not invent facts. Output plain text only.",
      },
      {
        role: "user",
        content: isZh
          ? [
              "请输出简洁的 AI 阅读概要，使用中文，结构为 3 行：",
              "1. 核心观点",
              "2. 研究价值",
              "3. 方法与发现",
              "每行控制在 1-2 句，总长度不超过 320 字。",
              "",
              `标题: ${title || "未知"}`,
              `作者: ${authors || "未知"}`,
              `年份: ${year || "未知"}`,
              `发表来源: ${venue || "未知"}`,
              `引用数: ${citationCount}`,
              `主题标签: ${tags || "未知"}`,
              `摘要: ${abstract || "未知"}`,
              `背景摘要(可选): ${summaryBg || "无"}`,
              `方法摘要(可选): ${summaryMethod || "无"}`,
              `贡献摘要(可选): ${summaryContrib || "无"}`,
            ].join("\n")
          : [
              "Return a concise AI reading note in English with exactly 3 lines:",
              "1. Core idea",
              "2. Why it matters",
              "3. Methods and findings",
              "Each line should be 1-2 sentences. Keep total length under 220 words.",
              "",
              `Title: ${title || "Unknown"}`,
              `Authors: ${authors || "Unknown"}`,
              `Year: ${year || "Unknown"}`,
              `Venue: ${venue || "Unknown"}`,
              `Citation count: ${citationCount}`,
              `Tags: ${tags || "Unknown"}`,
              `Abstract: ${abstract || "Unknown"}`,
              `Background summary (optional): ${summaryBg || "N/A"}`,
              `Method summary (optional): ${summaryMethod || "N/A"}`,
              `Contribution summary (optional): ${summaryContrib || "N/A"}`,
            ].join("\n"),
      },
    ],
  });

  const summary = normalizeAiReadingSummaryText(completion.content);
  if (!summary) {
    throw createHttpError(502, "llm_response_invalid");
  }

  return {
    summary,
    llmMeta: {
      model: completion.model,
      endpoint: completion.endpoint,
      attemptedModels: completion.attemptedModels || [],
    },
  };
}

function purgeExpiredReviewTasks() {
  const now = Date.now();
  for (const [taskId, task] of reviewTasks.entries()) {
    const updatedAtMs = new Date(task.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) continue;
    if (now - updatedAtMs > REVIEW_TASK_TTL_MS) {
      reviewTasks.delete(taskId);
    }
  }
}

function buildReviewTaskPayload(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    fileName: task.fileName,
    error: task.error || null,
    review: task.review || null,
  };
}

function createReviewTask({ userId, fileName, mimeType, extension, fileUrl }) {
  purgeExpiredReviewTasks();
  const nowIso = new Date().toISOString();
  const taskId = crypto.randomUUID();
  const task = {
    taskId,
    userId,
    fileName,
    mimeType,
    extension,
    fileUrl,
    status: "PENDING",
    error: null,
    review: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  reviewTasks.set(taskId, task);
  return task;
}

async function runReviewTask(taskId) {
  const task = reviewTasks.get(taskId);
  if (!task) return;

  task.status = "RUNNING";
  task.updatedAt = new Date().toISOString();

  try {
    const manuscript = await extractManuscriptText({
      fileName: task.fileName,
      mimeType: task.mimeType,
      extension: task.extension,
      fileUrl: task.fileUrl,
    });
    const reviewResult = await generateAiReviewFromManuscript(manuscript.text);
    task.status = "DONE";
    task.review = reviewResult.review;
    task.error = null;
    task.updatedAt = new Date().toISOString();
    try {
      await saveLabRecentRecord({
        userId: task.userId,
        toolType: "REVIEW_SIMULATOR",
        title: `Review: ${String(task.fileName || "manuscript").slice(0, 64)}`,
        inputPayload: {
          fileName: task.fileName,
          mimeType: task.mimeType || "",
          extension: manuscript.extension,
        },
        outputPayload: {
          review: task.review,
          decision: task.review?.decision || "",
          score: task.review?.score ?? 0,
        },
      });
    } catch {}
  } catch (err) {
    task.status = "FAILED";
    task.error = err?.publicMessage || "review_simulation_failed";
    task.updatedAt = new Date().toISOString();
  }
}

async function generateAiReviewFromManuscript(manuscriptText) {
  const completion = await requestLlmCompletion({
    temperature: 0.2,
    maxTokens: 1200,
    messages: [
      {
        role: "system",
        content:
          "You are a strict but constructive academic reviewer. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Review this manuscript and return JSON with fields: decision (ACCEPT or REJECT), score (0-10), summary, strengths (array), weaknesses (array), suggestions (array).\n\nManuscript:\n${manuscriptText}`,
      },
    ],
  });

  const parsed = parseJsonFromLlmContent(completion.content);
  if (!parsed) {
    throw createHttpError(502, "llm_response_invalid");
  }

  return {
    review: normalizeReviewResult(parsed),
    llmMeta: {
      model: completion.model,
      endpoint: completion.endpoint,
      attemptedModels: completion.attemptedModels || [],
    },
  };
}

async function requestLlmCompletion({
  messages,
  temperature = 0.2,
  maxTokens = 1200,
  responseFormat = null,
  timeoutMs = null,
}) {
  if (!llmApiKey) {
    throw createHttpError(500, "llm_config_missing");
  }
  if (!llmModelPool.length) {
    throw createHttpError(500, "llm_model_pool_empty");
  }
  const endpoint = buildLlmChatCompletionsUrl(llmBaseUrl);

  const baseBody = {
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (responseFormat) {
    baseBody.response_format = responseFormat;
  }

  const timeoutBudgetMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : Number.isFinite(llmTimeoutMs) && llmTimeoutMs > 0
      ? llmTimeoutMs
      : 90000;
  const perModelTimeoutCap = Number.isFinite(llmPerModelTimeoutMs) && llmPerModelTimeoutMs > 0
    ? llmPerModelTimeoutMs
    : timeoutBudgetMs;
  const startedAt = Date.now();
  const attemptErrors = [];

  for (let i = 0; i < llmModelPool.length; i += 1) {
    const model = llmModelPool[i];
    if (!model) continue;

    const elapsed = Date.now() - startedAt;
    const remainingBudget = timeoutBudgetMs - elapsed;
    if (remainingBudget <= 0) {
      attemptErrors.push({ model, reason: "timeout_budget_exhausted" });
      continue;
    }

    const singleAttemptTimeout = Math.max(
      1200,
      Math.min(remainingBudget, perModelTimeoutCap)
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), singleAttemptTimeout);
    let resp;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llmApiKey}`,
        },
        body: JSON.stringify({
          ...baseBody,
          model,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        attemptErrors.push({ model, reason: "llm_timeout" });
      } else {
        attemptErrors.push({
          model,
          reason: String(err?.message || err).replace(/\s+/g, " ").slice(0, 220),
        });
      }
      continue;
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }

    if (!resp.ok) {
      const providerError = extractLlmProviderError(payload, resp.status);
      attemptErrors.push({
        model,
        reason: String(providerError).replace(/\s+/g, " ").slice(0, 220),
      });
      continue;
    }

    let content = payload?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      content = content.map((item) => item?.text || "").join("\n");
    }
    if (typeof content !== "string") {
      content = payload?.choices?.[0]?.text || "";
    }
    if (!String(content || "").trim()) {
      attemptErrors.push({ model, reason: "llm_response_empty" });
      continue;
    }

    return {
      content: String(content || ""),
      payload,
      endpoint,
      model,
      attemptedModels: llmModelPool.slice(0, i + 1),
    };
  }

  const detail = attemptErrors
    .map((item) => `${item.model}:${item.reason}`)
    .join(" | ")
    .slice(0, 1500);
  const allTimeout =
    attemptErrors.length > 0 &&
    attemptErrors.every(
      (item) =>
        item.reason === "llm_timeout" || item.reason === "timeout_budget_exhausted"
    );
  if (allTimeout) {
    throw createHttpError(504, "llm_timeout", detail || "all_models_timeout");
  }
  throw createHttpError(502, "llm_request_failed", detail || "all_models_failed");
}

function normalizeAcademicPolishResult(raw, fallbackText) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  const polishedText = String(candidate.polishedText || fallbackText || "").trim();
  if (!polishedText) {
    throw createHttpError(502, "llm_response_invalid");
  }
  return {
    polishedText,
    improvements: normalizeStringArray(candidate.improvements, 8),
    tone: String(candidate.tone || "ACADEMIC").trim().toUpperCase(),
  };
}

async function generateAcademicPolish(text) {
  const completion = await requestLlmCompletion({
    temperature: 0.15,
    maxTokens: 1400,
    messages: [
      {
        role: "system",
        content:
          "You are an expert academic writing assistant. Improve clarity, grammar, coherence, and formal tone while preserving meaning. Reply JSON only.",
      },
      {
        role: "user",
        content:
          "Polish the following academic text. Return JSON with fields: polishedText (string), improvements (array of short strings), tone (string).\n\nText:\n" +
          text,
      },
    ],
  });
  const parsed = parseJsonFromLlmContent(completion.content);
  if (parsed) return normalizeAcademicPolishResult(parsed, text);

  // Fallback: if provider returns plain text, treat it as polished output.
  return normalizeAcademicPolishResult(
    {
      polishedText: completion.content,
      improvements: [],
      tone: "ACADEMIC",
    },
    text
  );
}

function normalizeCitationResult(raw, fallbackLines, styleRequested) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  const formattedReferences = Array.isArray(candidate.formattedReferences)
    ? candidate.formattedReferences
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];
  const lines = formattedReferences.length ? formattedReferences : fallbackLines;
  return {
    styleRequested: normalizeCitationStyle(styleRequested),
    styleUsed: normalizeCitationStyle(candidate.styleUsed || styleRequested || "AUTO"),
    detectedStyle: normalizeCitationStyle(candidate.detectedStyle || "AUTO"),
    formattedReferences: lines,
    formattedText: lines.join("\n"),
    notes: normalizeStringArray(candidate.notes, 6),
  };
}

function splitCitationLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120);
}

function buildHeuristicCitationLines(rawText, style) {
  const normalizedStyle = normalizeCitationStyle(style);
  const lines = splitCitationLines(rawText);
  return lines.map((line, index) => {
    const normalizedLine = String(line || "").replace(/\s+/g, " ").trim();
    if (!normalizedLine) return "";
    if (normalizedStyle === "MLA9" || normalizedStyle === "CHICAGO") {
      return normalizedLine.endsWith(".") ? normalizedLine : `${normalizedLine}.`;
    }
    if (normalizedStyle === "APA7") {
      return normalizedLine.endsWith(".") ? normalizedLine : `${normalizedLine}.`;
    }
    return lines.length > 1 ? `${index + 1}. ${normalizedLine}` : normalizedLine;
  }).filter(Boolean);
}

async function generateCitationFormatting(rawText, style) {
  const fallbackLines = buildHeuristicCitationLines(rawText, style);
  const citationLlmTimeoutMs = Number(process.env.CITATION_LLM_TIMEOUT_MS || 26000);
  if (!llmApiKey) {
    return normalizeCitationResult(
      {
        styleUsed: style,
        detectedStyle: "AUTO",
        formattedReferences: fallbackLines,
        notes: ["LLM unavailable, returned normalized references."],
      },
      fallbackLines,
      style
    );
  }

  try {
    const completion = await requestLlmCompletion({
      temperature: 0.1,
      maxTokens: 1400,
      timeoutMs: citationLlmTimeoutMs,
      messages: [
        {
          role: "system",
          content:
            "You are a citation formatting assistant. Format references accurately. Never invent missing metadata. Reply JSON only.",
        },
        {
          role: "user",
          content:
            `Format the following references to style "${style}". If style is AUTO, detect best style and normalize consistently.\n` +
            "Return JSON with fields: styleUsed, detectedStyle, formattedReferences (array), notes (array).\n\nReferences:\n" +
            rawText,
        },
      ],
    });
    const parsed = parseJsonFromLlmContent(completion.content);
    if (parsed) {
      return normalizeCitationResult(parsed, fallbackLines, style);
    }
    return normalizeCitationResult(
      {
        styleUsed: style,
        detectedStyle: "AUTO",
        formattedReferences: splitCitationLines(completion.content),
        notes: [],
      },
      fallbackLines,
      style
    );
  } catch (err) {
    const fallbackReason = String(
      err?.detail || err?.publicMessage || err?.message || "llm_error"
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    console.warn("[lab/citations] llm fallback:", {
      reason: fallbackReason,
      style: normalizeCitationStyle(style),
      inputChars: String(rawText || "").length,
    });
    return normalizeCitationResult(
      {
        styleUsed: style,
        detectedStyle: "AUTO",
        formattedReferences: fallbackLines,
        notes: [`Fallback used (${fallbackReason || "llm_error"})`],
      },
      fallbackLines,
      style
    );
  }
}

function coerceCellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value).trim();
  if (!text) return null;

  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(text)) {
    return asNumber;
  }

  const asDate = Date.parse(text);
  if (Number.isFinite(asDate) && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text)) {
    return new Date(asDate).toISOString().slice(0, 10);
  }

  if (/^(true|false)$/i.test(text)) {
    return text.toLowerCase() === "true";
  }

  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function parseCsvRow(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      const peek = line[i + 1];
      if (inQuotes && peek === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function sanitizeRows(rows) {
  const safeRows = [];
  const knownColumns = [];
  const colSet = new Set();

  for (const row of rows || []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const entries = Object.entries(row).slice(0, MAX_DATAVIZ_COLUMNS);
    const safeRow = {};
    for (const [rawKey, value] of entries) {
      const key = String(rawKey || "").trim();
      if (!key) continue;
      safeRow[key] = coerceCellValue(value);
      if (!colSet.has(key)) {
        colSet.add(key);
        knownColumns.push(key);
      }
    }
    if (Object.keys(safeRow).length) {
      safeRows.push(safeRow);
    }
    if (safeRows.length >= MAX_DATAVIZ_SAMPLE_ROWS) break;
  }

  return {
    rows: safeRows,
    columns: knownColumns.slice(0, MAX_DATAVIZ_COLUMNS),
  };
}

function parseCsvRecords(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => String(line || "").trim());
  if (lines.length < 2) {
    throw createHttpError(400, "dataset_rows_too_few");
  }

  const headers = parseCsvRow(lines[0]).map((item, index) => {
    const cleaned = String(item || "").trim();
    return cleaned || `column_${index + 1}`;
  });
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] ?? null;
    });
    rows.push(row);
  }
  return rows;
}

function parseJsonRecords(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || ""));
  } catch (err) {
    throw createHttpError(400, "invalid_json_dataset", String(err?.message || err));
  }

  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.results)) return payload.results;
  }
  throw createHttpError(400, "invalid_json_dataset_shape");
}

async function extractDataVizDataset({
  fileName,
  mimeType,
  extension,
  contentBase64,
  fileUrl,
}) {
  const derivedExt = String(extension || "").toLowerCase() || extFromFileName(fileName);
  if (!SUPPORTED_DATAVIZ_EXTENSIONS.has(derivedExt)) {
    throw createHttpError(400, "unsupported_dataviz_file_type");
  }

  let buffer;
  if (typeof contentBase64 === "string" && contentBase64.trim()) {
    buffer = decodeBase64Buffer(contentBase64);
  } else if (typeof fileUrl === "string" && fileUrl.trim()) {
    buffer = await fetchRemoteFileBuffer(fileUrl);
  } else {
    throw createHttpError(400, "invalid_payload");
  }

  const normalizedMime = String(mimeType || "").toLowerCase();
  let rawRows = [];

  if (derivedExt === "csv" || normalizedMime.includes("csv")) {
    rawRows = parseCsvRecords(buffer.toString("utf8"));
  } else if (derivedExt === "json" || normalizedMime.includes("json")) {
    rawRows = parseJsonRecords(buffer.toString("utf8"));
  } else if (derivedExt === "xlsx" || derivedExt === "xls") {
    try {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames?.[0];
      if (!firstSheetName) {
        throw new Error("empty_sheet");
      }
      const sheet = workbook.Sheets[firstSheetName];
      rawRows = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
      });
    } catch (err) {
      throw createHttpError(400, "excel_parse_failed", String(err?.message || err));
    }
  }

  const { rows, columns } = sanitizeRows(rawRows);
  if (!rows.length || !columns.length) {
    throw createHttpError(400, "dataset_empty");
  }

  return {
    extension: derivedExt,
    rows,
    columns,
  };
}

function toNumericValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function inferDatasetColumns(rows, columns) {
  const metrics = {};
  for (const col of columns) {
    metrics[col] = { numeric: 0, date: 0, nonNull: 0 };
  }
  for (const row of rows) {
    for (const col of columns) {
      const value = row[col];
      if (value === null || value === undefined || value === "") continue;
      metrics[col].nonNull += 1;
      if (typeof value === "number") {
        metrics[col].numeric += 1;
      } else if (Number.isFinite(Number(value))) {
        metrics[col].numeric += 1;
      }
      if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
        metrics[col].date += 1;
      }
    }
  }

  const numericColumns = [];
  const dateColumns = [];
  const categoryColumns = [];
  for (const col of columns) {
    const m = metrics[col];
    const ratioNumeric = m.nonNull ? m.numeric / m.nonNull : 0;
    const ratioDate = m.nonNull ? m.date / m.nonNull : 0;
    if (ratioNumeric >= 0.6) {
      numericColumns.push(col);
      continue;
    }
    if (ratioDate >= 0.6) {
      dateColumns.push(col);
      continue;
    }
    categoryColumns.push(col);
  }

  return { numericColumns, dateColumns, categoryColumns };
}

function selectChartFields(rows, chartType) {
  const columns = Object.keys(rows[0] || {});
  const roles = inferDatasetColumns(rows, columns);
  if (!columns.length) {
    throw createHttpError(400, "dataset_columns_missing");
  }

  if (chartType === "scatter") {
    const xField = roles.numericColumns[0] || columns[0];
    const yField = roles.numericColumns[1] || roles.numericColumns[0] || columns[1] || columns[0];
    return { xField, yField, valueField: yField };
  }

  if (chartType === "heatmap") {
    const xField = roles.categoryColumns[0] || roles.dateColumns[0] || columns[0];
    const yField =
      roles.categoryColumns[1] ||
      roles.dateColumns[1] ||
      columns.find((col) => col !== xField) ||
      xField;
    const valueField = roles.numericColumns[0] || columns.find((col) => col !== xField && col !== yField) || yField;
    return { xField, yField, valueField };
  }

  const xField = roles.dateColumns[0] || roles.categoryColumns[0] || columns[0];
  const yField = roles.numericColumns[0] || columns.find((col) => col !== xField) || columns[0];
  return { xField, yField, valueField: yField };
}

function buildFallbackEchartsOption(rows, chartType, fields) {
  const { xField, yField, valueField } = fields;
  const sample = rows.slice(0, 80);

  if (chartType === "scatter") {
    const points = sample
      .map((row, idx) => {
        const x = toNumericValue(row[xField]);
        const y = toNumericValue(row[yField]);
        if (x === null || y === null) return [idx + 1, 0];
        return [x, y];
      })
      .slice(0, 200);
    return {
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: xField },
      yAxis: { type: "value", name: yField },
      series: [
        {
          type: "scatter",
          data: points,
          symbolSize: 9,
        },
      ],
    };
  }

  if (chartType === "heatmap") {
    const xCategories = [];
    const yCategories = [];
    const xSet = new Set();
    const ySet = new Set();
    for (const row of sample) {
      const xv = String(row[xField] ?? "N/A");
      const yv = String(row[yField] ?? "N/A");
      if (!xSet.has(xv) && xCategories.length < 16) {
        xSet.add(xv);
        xCategories.push(xv);
      }
      if (!ySet.has(yv) && yCategories.length < 16) {
        ySet.add(yv);
        yCategories.push(yv);
      }
    }
    const data = [];
    for (const row of sample) {
      const x = xCategories.indexOf(String(row[xField] ?? "N/A"));
      const y = yCategories.indexOf(String(row[yField] ?? "N/A"));
      if (x < 0 || y < 0) continue;
      const value = toNumericValue(row[valueField]) ?? 0;
      data.push([x, y, value]);
    }
    return {
      tooltip: { position: "top" },
      xAxis: { type: "category", data: xCategories, name: xField },
      yAxis: { type: "category", data: yCategories, name: yField },
      visualMap: {
        min: 0,
        max: Math.max(...data.map((item) => item[2]), 10),
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
      },
      series: [
        {
          type: "heatmap",
          data,
        },
      ],
    };
  }

  const labels = sample.map((row) => String(row[xField] ?? ""));
  const numericValues = sample.map((row, idx) => {
    const n = toNumericValue(row[yField]);
    return n === null ? idx + 1 : n;
  });
  return {
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: labels,
      name: xField,
    },
    yAxis: {
      type: "value",
      name: yField,
    },
    series: [
      {
        type: chartType === "bar" ? "bar" : "line",
        smooth: chartType !== "bar",
        data: numericValues,
      },
    ],
  };
}

function normalizeDataVizResult(raw, fallback) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  const chartType = normalizeChartType(candidate.chartType || fallback.chartType);
  const title = String(candidate.title || fallback.title || "Generated Chart").trim();
  const option =
    candidate.echartsOption && typeof candidate.echartsOption === "object"
      ? candidate.echartsOption
      : fallback.echartsOption;

  return {
    chartType,
    title,
    summary: String(candidate.summary || fallback.summary || "").trim(),
    insights: normalizeStringArray(candidate.insights, 8),
    echartsOption: option,
  };
}

async function generateDataVizResult({ rows, chartType, fileName }) {
  const fields = selectChartFields(rows, chartType);
  const fallbackOption = buildFallbackEchartsOption(rows, chartType, fields);
  const fallback = {
    chartType,
    title: `Auto ${chartType} for ${fileName || "dataset"}`,
    summary: `Generated from ${rows.length} rows.`,
    insights: [],
    echartsOption: fallbackOption,
  };

  const previewRows = rows.slice(0, 60);
  if (!llmApiKey) {
    return {
      ...fallback,
      previewRows,
      fields,
      provider: "heuristic",
    };
  }

  try {
    const completion = await requestLlmCompletion({
      temperature: 0.15,
      maxTokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "You are a data visualization expert. Given tabular data and a preferred chart type, return ECharts option JSON and short insights. Reply JSON only.",
        },
        {
          role: "user",
          content:
            `Preferred chart type: ${chartType}\n` +
            `File name: ${fileName}\n` +
            `Inferred fields: ${JSON.stringify(fields)}\n` +
            "Sample rows (JSON):\n" +
            JSON.stringify(previewRows) +
            "\n\nReturn JSON with fields: chartType, title, summary, insights (array), echartsOption (object).",
        },
      ],
    });

    const parsed = parseJsonFromLlmContent(completion.content);
    const normalized = normalizeDataVizResult(parsed, fallback);
    return {
      ...normalized,
      previewRows,
      fields,
      provider: "llm",
    };
  } catch (err) {
    return {
      ...fallback,
      previewRows,
      fields,
      provider: "heuristic_fallback",
      fallbackReason: err?.publicMessage || String(err?.message || err),
    };
  }
}

function purgeExpiredDataVizTasks() {
  const now = Date.now();
  for (const [taskId, task] of dataVizTasks.entries()) {
    const updatedAtMs = new Date(task.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) continue;
    if (now - updatedAtMs > DATAVIZ_TASK_TTL_MS) {
      dataVizTasks.delete(taskId);
    }
  }
}

function createDataVizTask({
  userId,
  fileName,
  mimeType,
  extension,
  fileUrl,
  contentBase64,
  chartType,
}) {
  purgeExpiredDataVizTasks();
  const nowIso = new Date().toISOString();
  const taskId = crypto.randomUUID();
  const task = {
    taskId,
    userId,
    fileName,
    mimeType,
    extension,
    fileUrl,
    contentBase64,
    chartType,
    status: "PENDING",
    error: null,
    result: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  dataVizTasks.set(taskId, task);
  return task;
}

function buildDataVizTaskPayload(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    fileName: task.fileName,
    chartType: task.chartType,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    error: task.error || null,
    result: task.result || null,
  };
}

async function runDataVizTask(taskId) {
  const task = dataVizTasks.get(taskId);
  if (!task) return;

  task.status = "RUNNING";
  task.updatedAt = new Date().toISOString();
  try {
    const dataset = await extractDataVizDataset({
      fileName: task.fileName,
      mimeType: task.mimeType,
      extension: task.extension,
      fileUrl: task.fileUrl,
      contentBase64: task.contentBase64,
    });
    const result = await generateDataVizResult({
      rows: dataset.rows,
      chartType: task.chartType,
      fileName: task.fileName,
    });
    task.status = "DONE";
    task.error = null;
    task.result = {
      ...result,
      datasetMeta: {
        extension: dataset.extension,
        columns: dataset.columns,
        rows: dataset.rows.length,
      },
    };
    try {
      await saveLabRecentRecord({
        userId: task.userId,
        toolType: "DATA_VIZ",
        title: task.result.title || `DataViz ${task.chartType}`,
        inputPayload: {
          fileName: task.fileName,
          chartType: task.chartType,
          extension: dataset.extension,
          rows: dataset.rows.length,
          columns: dataset.columns,
        },
        outputPayload: {
          chartType: task.result.chartType,
          title: task.result.title,
          summary: task.result.summary,
          insights: task.result.insights,
          echartsOption: task.result.echartsOption,
          provider: task.result.provider,
          datasetMeta: task.result.datasetMeta,
        },
      });
    } catch {}
    task.updatedAt = new Date().toISOString();
  } catch (err) {
    task.status = "FAILED";
    task.error = err?.publicMessage || "dataviz_generate_failed";
    task.updatedAt = new Date().toISOString();
  }
}

function buildPublishedAt(publicationDate, year) {
  if (publicationDate) {
    const date = new Date(publicationDate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (year && Number.isFinite(Number(year))) {
    const date = new Date(`${year}-01-01T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

async function requestSemanticScholar(url) {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const text = await resp.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!resp.ok) {
    const err = new Error(
      payload?.message || `semantic_scholar_http_${resp.status}`
    );
    err.status = resp.status;
    err.code = payload?.code || null;
    throw err;
  }
  return payload;
}

async function fetchSemanticScholarPapersBySearch({
  keywords,
  page,
  pageSize,
}) {
  const offset = (page - 1) * pageSize;
  const fields = [
    "paperId",
    "title",
    "authors",
    "abstract",
    "year",
    "venue",
    "citationCount",
    "publicationDate",
    "url",
    "openAccessPdf",
    "fieldsOfStudy",
  ].join(",");

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", keywords);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("fields", fields);
  const payload = await requestSemanticScholar(url);

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const total = Number.isFinite(payload?.total) ? payload.total : rows.length;
  return { rows, total, source: "semantic_scholar" };
}

async function fetchSemanticScholarPapersByBulk({ keywords, page, pageSize }) {
  const fields = [
    "paperId",
    "title",
    "authors",
    "abstract",
    "year",
    "venue",
    "citationCount",
    "publicationDate",
    "url",
    "openAccessPdf",
    "fieldsOfStudy",
  ].join(",");

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search/bulk");
  url.searchParams.set("query", keywords);
  url.searchParams.set("fields", fields);

  const payload = await requestSemanticScholar(url);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const total = Number.isFinite(payload?.total) ? payload.total : rows.length;
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total,
    source: "semantic_scholar_bulk",
  };
}

async function fetchSemanticScholarPaperById(paperId) {
  const fields = [
    "paperId",
    "title",
    "authors",
    "abstract",
    "year",
    "venue",
    "citationCount",
    "publicationDate",
    "url",
    "openAccessPdf",
    "fieldsOfStudy",
  ].join(",");
  const url = new URL(
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(
      paperId
    )}`
  );
  url.searchParams.set("fields", fields);
  return requestSemanticScholar(url);
}

async function requestOpenAlex(url) {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const text = await resp.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }
  if (!resp.ok) {
    const err = new Error(payload?.error || payload?.message || `openalex_http_${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return payload;
}

function parseOpenAlexAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") {
    return "No abstract available.";
  }
  const tokens = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (!Number.isInteger(pos) || pos < 0) continue;
      tokens[pos] = word;
    }
  }
  const text = tokens.filter(Boolean).join(" ").trim();
  return text || "No abstract available.";
}

function normalizeOpenAlexWorkId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^W\d+$/i.test(raw)) return raw.toUpperCase();
  const match = raw.match(/(?:^|\/)(W\d+)(?:\/)?$/i);
  if (!match) return "";
  return match[1].toUpperCase();
}

async function fetchOpenAlexPapers({ keywords, page, pageSize }) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", keywords);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per-page", String(pageSize));
  url.searchParams.set("filter", "has_abstract:true");
  url.searchParams.set(
    "select",
    [
      "id",
      "display_name",
      "authorships",
      "abstract_inverted_index",
      "publication_year",
      "publication_date",
      "cited_by_count",
      "primary_location",
      "best_oa_location",
      "concepts",
    ].join(",")
  );
  if (openAlexApiKey) {
    url.searchParams.set("api_key", openAlexApiKey);
  }

  const payload = await requestOpenAlex(url);
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const total = Number.isFinite(payload?.meta?.count) ? payload.meta.count : rows.length;
  return {
    rows,
    total,
    source: "openalex",
  };
}

async function fetchOpenAlexPaperByWorkId(workId) {
  const normalizedWorkId = normalizeOpenAlexWorkId(workId);
  if (!normalizedWorkId) {
    throw createHttpError(400, "invalid_openalex_work_id");
  }
  const url = new URL(`https://api.openalex.org/works/${normalizedWorkId}`);
  if (openAlexApiKey) {
    url.searchParams.set("api_key", openAlexApiKey);
  }
  return requestOpenAlex(url);
}

function mapSemanticScholarPaper(row) {
  const paperId = String(row?.paperId || "");
  if (!paperId) return null;
  const authors = Array.isArray(row?.authors)
    ? row.authors
        .map((author) => author?.name)
        .filter((name) => typeof name === "string" && name.trim())
    : [];
  const tags = Array.isArray(row?.fieldsOfStudy)
    ? row.fieldsOfStudy
        .map((tag) => String(tag || "").trim())
        .filter((tag) => Boolean(tag))
    : [];

  return {
    id: paperId,
    arxivId: `s2:${paperId}`,
    title: String(row?.title || "Untitled Paper"),
    authors,
    abstract: String(row?.abstract || "No abstract available."),
    publishedAt: buildPublishedAt(row?.publicationDate, row?.year),
    tags,
    venue: row?.venue ? String(row.venue) : null,
    year: Number.isFinite(row?.year) ? row.year : null,
    citationCount: Number.isFinite(row?.citationCount) ? row.citationCount : 0,
    url: row?.url ? String(row.url) : null,
    openAccessPdfUrl: row?.openAccessPdf?.url
      ? String(row.openAccessPdf.url)
      : null,
  };
}

function mapOpenAlexPaper(row) {
  const workId = normalizeOpenAlexWorkId(row?.id);
  if (!workId) return null;

  const authors = Array.isArray(row?.authorships)
    ? row.authorships
        .map((authorship) => authorship?.author?.display_name)
        .filter((name) => typeof name === "string" && name.trim())
    : [];
  const tags = Array.isArray(row?.concepts)
    ? row.concepts
        .map((concept) => String(concept?.display_name || "").trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    id: `oa:${workId}`,
    arxivId: `openalex:${workId}`,
    title: String(row?.display_name || "Untitled Paper"),
    authors,
    abstract: parseOpenAlexAbstract(row?.abstract_inverted_index),
    publishedAt: buildPublishedAt(row?.publication_date, row?.publication_year),
    tags,
    venue: row?.primary_location?.source?.display_name
      ? String(row.primary_location.source.display_name)
      : null,
    year: Number.isFinite(row?.publication_year) ? row.publication_year : null,
    citationCount: Number.isFinite(row?.cited_by_count) ? row.cited_by_count : 0,
    url: row?.id ? String(row.id) : `https://openalex.org/${workId}`,
    openAccessPdfUrl: row?.best_oa_location?.pdf_url
      ? String(row.best_oa_location.pdf_url)
      : null,
  };
}

async function upsertPapersFromSemanticScholar(papers) {
  if (!papers.length) return;
  const sql = `
    INSERT INTO papers (id, arxiv_id, title, authors, abstract, published_at, tags, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title,
          authors = EXCLUDED.authors,
          abstract = EXCLUDED.abstract,
          published_at = EXCLUDED.published_at,
          tags = EXCLUDED.tags,
          updated_at = NOW();
  `;
  for (const paper of papers) {
    await pool.query(sql, [
      paper.id,
      paper.arxivId,
      paper.title,
      JSON.stringify(paper.authors),
      paper.abstract,
      paper.publishedAt.toISOString(),
      JSON.stringify(paper.tags),
    ]);
  }
}

async function getUserActionsByPaperIds(userId, paperIds) {
  if (!paperIds.length) return new Map();
  const result = await pool.query(
    `
      SELECT paper_id, action
      FROM user_paper_actions
      WHERE user_id = $1
        AND paper_id = ANY($2::text[]);
    `,
    [userId, paperIds]
  );
  return new Map(result.rows.map((row) => [row.paper_id, row.action]));
}

async function getUserLikedPaperIds(userId, paperIds) {
  if (!paperIds.length) return new Set();
  const result = await pool.query(
    `
      SELECT paper_id
      FROM paper_likes
      WHERE user_id = $1
        AND paper_id = ANY($2::text[]);
    `,
    [userId, paperIds]
  );
  return new Set(result.rows.map((row) => row.paper_id));
}

async function loadLocalFeed({ userId, page, pageSize }) {
  const offset = (page - 1) * pageSize;
  const [countResult, feedResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM papers;`),
    pool.query(
      `
        SELECT
          p.id,
          p.arxiv_id,
          p.title,
          p.authors,
          p.abstract,
          p.published_at,
          p.tags,
          ps.summary_bg,
          ps.summary_method,
          ps.summary_contrib,
          ps.model_name,
          upa.action AS user_action,
          EXISTS (
            SELECT 1
            FROM paper_likes pl
            WHERE pl.paper_id = p.id
              AND pl.user_id = $1
          ) AS liked_by_me
        FROM papers p
        LEFT JOIN paper_summaries ps
          ON ps.paper_id = p.id
        LEFT JOIN user_paper_actions upa
          ON upa.paper_id = p.id AND upa.user_id = $1
        ORDER BY p.published_at DESC
        LIMIT $2 OFFSET $3;
      `,
      [userId, pageSize, offset]
    ),
  ]);

  const total = countResult.rows[0]?.total ?? 0;
  const items = feedResult.rows.map((row) => ({
    id: row.id,
    arxivId: row.arxiv_id,
    title: row.title,
    authors: row.authors || [],
    abstract: row.abstract,
    publishedAt: row.published_at,
    tags: row.tags || [],
    userAction: row.user_action || null,
    likedByMe: Boolean(row.liked_by_me),
    summary:
      row.summary_bg || row.summary_method || row.summary_contrib
        ? {
            background: row.summary_bg,
            method: row.summary_method,
            contribution: row.summary_contrib,
            modelName: row.model_name || null,
          }
        : null,
    source: "local_cache",
  }));

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total,
    },
  };
}

function getBearerToken(authHeader = "") {
  if (!authHeader || typeof authHeader !== "string") return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function getUserById(userId) {
  const result = await pool.query(
    `
      SELECT
        id,
        openid,
        email,
        nickname,
        avatar_url,
        auth_provider,
        field_of_study,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function getUserByEmail(email) {
  const result = await pool.query(
    `
      SELECT
        id,
        openid,
        email,
        password_hash,
        nickname,
        avatar_url,
        auth_provider,
        field_of_study,
        created_at,
        updated_at
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [email]
  );
  return result.rows[0] || null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ message: "missing_token" });
    }
    const payload = jwt.verify(token, jwtSecret);
    if (!payload?.sub) {
      return res.status(401).json({ message: "invalid_token" });
    }

    const user = await getUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: "user_not_found" });
    }

    req.auth = {
      userId: user.id,
      openid: user.openid,
    };
    req.currentUser = user;
    return next();
  } catch (err) {
    return res.status(401).json({
      message: "invalid_token",
      detail: String(err?.message || err),
    });
  }
}

async function fetchWeChatSession(code) {
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", wechatAppId);
  url.searchParams.set("secret", wechatAppSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error(`wechat_http_${resp.status}`);
  }

  const data = await resp.json();
  if (data.errcode) {
    const err = new Error(data.errmsg || "wechat_error");
    err.code = data.errcode;
    throw err;
  }
  if (!data.openid) {
    throw new Error("wechat_openid_missing");
  }
  return data;
}

async function upsertUserByOpenId({ openid, nickname, avatarUrl }) {
  const normalizedNickname =
    typeof nickname === "string"
      ? nickname.trim() && nickname.trim() !== "微信用户"
        ? nickname.trim()
        : null
      : null;
  const normalizedAvatarUrl =
    typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl.trim() : null;

  const sql = `
    INSERT INTO users (id, openid, nickname, avatar_url, auth_provider)
    VALUES ($1, $2, $3, $4, 'WECHAT')
    ON CONFLICT (openid) DO UPDATE
      SET nickname = CASE
            WHEN users.nickname IS NULL
              OR users.nickname = ''
              OR users.nickname = '微信用户'
            THEN COALESCE(EXCLUDED.nickname, users.nickname)
            ELSE users.nickname
          END,
          avatar_url = CASE
            WHEN users.avatar_url IS NULL
              OR users.avatar_url = ''
            THEN COALESCE(EXCLUDED.avatar_url, users.avatar_url)
            ELSE users.avatar_url
          END,
          auth_provider = 'WECHAT',
          updated_at = NOW()
    RETURNING
      id,
      openid,
      email,
      nickname,
      avatar_url,
      auth_provider,
      field_of_study,
      created_at,
      updated_at;
  `;
  const values = [
    crypto.randomUUID(),
    openid,
    normalizedNickname,
    normalizedAvatarUrl,
  ];
  const result = await pool.query(sql, values);
  return result.rows[0];
}

async function seedDefaultProjectDeadlines(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT project_defaults_initialized
        FROM users
        WHERE id = $1
        FOR UPDATE;
      `,
      [userId]
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      await client.query("ROLLBACK");
      return;
    }
    if (userRow.project_defaults_initialized) {
      await client.query("COMMIT");
      return;
    }

    const countResult = await client.query(
      `
        SELECT COUNT(*)::int AS total
        FROM project_deadlines
        WHERE user_id = $1;
      `,
      [userId]
    );
    const existingTotal = countResult.rows[0]?.total ?? 0;
    if (existingTotal > 0) {
      await client.query(
        `
          UPDATE users
          SET project_defaults_initialized = TRUE,
              updated_at = NOW()
          WHERE id = $1;
        `,
        [userId]
      );
      await client.query("COMMIT");
      return;
    }

    const sql = `
      INSERT INTO project_deadlines (
        id,
        user_id,
        abbr,
        full_name,
        location,
        start_date,
        deadline,
        progress,
        note,
        color_theme
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, abbr, deadline) DO NOTHING;
    `;

    for (const conf of DEFAULT_PROJECT_DEADLINES) {
      await client.query(sql, [
        crypto.randomUUID(),
        userId,
        conf.abbr,
        conf.fullName,
        conf.location || "",
        conf.startDate || null,
        conf.deadline,
        Number(conf.progress) || 0,
        conf.note || "",
        conf.colorTheme || "green",
      ]);
    }

    await client.query(
      `
        UPDATE users
        SET project_defaults_initialized = TRUE,
            updated_at = NOW()
        WHERE id = $1;
      `,
      [userId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      service: "research-pilot-backend",
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "database_unavailable",
      detail: String(err.message || err),
    });
  }
});

app.post("/auth/wx-login", async (req, res) => {
  try {
    const { code, nickname, avatarUrl } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ message: "invalid_code" });
    }
    if (!wechatAppId || !wechatAppSecret) {
      return res.status(500).json({ message: "wechat_config_missing" });
    }

    const session = await fetchWeChatSession(code);
    const user = await upsertUserByOpenId({
      openid: session.openid,
      nickname,
      avatarUrl,
    });

    const token = buildAuthToken(user);

    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: buildUserPayload(user),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const status = err?.code ? 401 : 500;
    return res.status(status).json({
      message: "wx_login_failed",
      detail: msg,
      code: err?.code ?? null,
    });
  }
});

app.post("/auth/email-register", async (req, res) => {
  try {
    const {
      email,
      password,
      fullName = null,
      fieldOfStudy = null,
    } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: "invalid_email" });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ message: "password_too_short" });
    }

    const passwordHash = hashPassword(password);
    const insertResult = await pool.query(
      `
        INSERT INTO users (
          id,
          email,
          password_hash,
          nickname,
          field_of_study,
          auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, 'EMAIL')
        ON CONFLICT (email) DO NOTHING
        RETURNING
          id,
          openid,
          email,
          nickname,
          avatar_url,
          auth_provider,
          field_of_study,
          created_at,
          updated_at;
      `,
      [
        crypto.randomUUID(),
        normalizedEmail,
        passwordHash,
        fullName ? String(fullName).trim() || null : null,
        fieldOfStudy ? String(fieldOfStudy).trim() || null : null,
      ]
    );
    const user = insertResult.rows[0];
    if (!user) {
      return res.status(409).json({ message: "email_already_registered" });
    }

    const token = buildAuthToken(user);
    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: buildUserPayload(user),
    });
  } catch (err) {
    return res.status(500).json({
      message: "email_register_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/auth/email-login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: "invalid_email" });
    }
    if (!password || typeof password !== "string") {
      return res.status(400).json({ message: "missing_password" });
    }

    const user = await getUserByEmail(normalizedEmail);
    if (!user || !user.password_hash) {
      return res.status(401).json({ message: "invalid_credentials" });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ message: "invalid_credentials" });
    }

    const token = buildAuthToken(user);
    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: buildUserPayload(user),
    });
  } catch (err) {
    return res.status(500).json({
      message: "email_login_failed",
      detail: String(err?.message || err),
    });
  }
});

app.put("/users/me/profile", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const hasNickname = hasOwn(body, "nickname");
    const hasAvatarUrl = hasOwn(body, "avatarUrl");
    const hasBadgeKey = hasOwn(body, "badgeKey");
    const hasBadgeText = hasOwn(body, "badgeText");
    const hasPreferredLanguage = hasOwn(body, "preferredLanguage");

    const nicknameRaw = body.nickname;
    const avatarUrlRaw = body.avatarUrl;
    const badgeKeyRaw = body.badgeKey;
    const badgeTextRaw = body.badgeText;
    const preferredLanguageRaw = body.preferredLanguage;

    const nickname =
      typeof nicknameRaw === "string" ? nicknameRaw.trim().slice(0, 32) : null;
    const avatarUrl =
      typeof avatarUrlRaw === "string" ? avatarUrlRaw.trim() : null;
    const badgeKey =
      hasBadgeKey && badgeKeyRaw !== null && badgeKeyRaw !== undefined
        ? normalizeProfileBadgeKey(badgeKeyRaw)
        : null;
    const badgeText =
      hasBadgeText && badgeTextRaw !== null && badgeTextRaw !== undefined
        ? normalizeProfileBadgeText(badgeTextRaw)
        : null;
    const preferredLanguage =
      hasPreferredLanguage && preferredLanguageRaw !== null && preferredLanguageRaw !== undefined
        ? normalizePreferredLanguage(preferredLanguageRaw)
        : null;

    if (!hasNickname && !hasAvatarUrl && !hasBadgeKey && !hasBadgeText && !hasPreferredLanguage) {
      return res.status(400).json({ message: "no_profile_fields" });
    }
    if (hasNickname && (!nickname || nickname.length < 1)) {
      return res.status(400).json({ message: "invalid_nickname" });
    }
    if (hasAvatarUrl && avatarUrl && !isAllowedAvatarUrl(avatarUrl)) {
      return res.status(400).json({ message: "invalid_avatar_url" });
    }
    if (
      hasPreferredLanguage &&
      preferredLanguageRaw !== null &&
      preferredLanguageRaw !== undefined &&
      !preferredLanguage
    ) {
      return res.status(400).json({ message: "invalid_preferred_language" });
    }

    const result = await pool.query(
      `
        UPDATE users
        SET
          nickname = CASE WHEN $2::boolean THEN $3 ELSE nickname END,
          avatar_url = CASE WHEN $4::boolean THEN COALESCE($5, avatar_url) ELSE avatar_url END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          openid,
          email,
          nickname,
          avatar_url,
          auth_provider,
          field_of_study,
          created_at,
          updated_at;
      `,
      [req.auth.userId, hasNickname, nickname, hasAvatarUrl, avatarUrl]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "user_not_found" });
    }

    const profileSettings = await upsertUserProfileSettingsByUserId({
      userId: req.auth.userId,
      hasBadgeKey,
      badgeKey,
      hasBadgeText,
      badgeText,
      hasPreferredLanguage,
      preferredLanguage,
    });

    return res.status(200).json({
      user: buildUserPayload(user, profileSettings),
    });
  } catch (err) {
    return res.status(500).json({
      message: "update_profile_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/users/me", authMiddleware, async (req, res) => {
  try {
    const user = req.currentUser;
    const profileSettings = await getUserProfileSettingsByUserId(user.id);
    const settings = mapUserProfileSettingsRow(profileSettings);
    return res.status(200).json({
      id: user.id,
      openid: user.openid || null,
      email: user.email || null,
      nickname: user.nickname || null,
      avatarUrl: user.avatar_url || null,
      authProvider: user.auth_provider || null,
      fieldOfStudy: user.field_of_study || null,
      badgeKey: settings.badgeKey,
      badgeText: settings.badgeText,
      preferredLanguage: settings.preferredLanguage,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    });
  } catch (err) {
    return res.status(500).json({
      message: "get_profile_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/users/me/liked-papers", authMiddleware, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const pageSize = parsePositiveInt(req.query.pageSize, 20, 100);
    const offset = (page - 1) * pageSize;

    const [countResult, listResult] = await Promise.all([
      pool.query(
        `
          SELECT COUNT(*)::int AS total
          FROM paper_likes
          WHERE user_id = $1;
        `,
        [req.auth.userId]
      ),
      pool.query(
        `
          SELECT
            p.id,
            p.arxiv_id,
            p.title,
            p.authors,
            p.abstract,
            p.published_at,
            p.tags,
            pl.created_at AS liked_at
          FROM paper_likes pl
          INNER JOIN papers p ON p.id = pl.paper_id
          WHERE pl.user_id = $1
          ORDER BY pl.created_at DESC
          LIMIT $2 OFFSET $3;
        `,
        [req.auth.userId, pageSize, offset]
      ),
    ]);

    const total = countResult.rows[0]?.total ?? 0;
    const items = listResult.rows.map((row) => ({
      id: row.id,
      arxivId: row.arxiv_id,
      title: row.title,
      authors: row.authors || [],
      abstract: row.abstract || "",
      publishedAt: row.published_at,
      tags: row.tags || [],
      likedAt: row.liked_at,
      likedByMe: true,
    }));

    return res.status(200).json({
      items,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: offset + items.length < total,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: "liked_papers_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/projects/conferences", authMiddleware, async (req, res) => {
  try {
    await seedDefaultProjectDeadlines(req.auth.userId);

    const result = await pool.query(
      `
        SELECT
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme,
          created_at,
          updated_at
        FROM project_deadlines
        WHERE user_id = $1
        ORDER BY deadline ASC, created_at ASC;
      `,
      [req.auth.userId]
    );

    return res.status(200).json({
      items: result.rows.map(mapProjectDeadlineRow),
    });
  } catch (err) {
    return res.status(500).json({
      message: "project_conference_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/projects/conferences", authMiddleware, async (req, res) => {
  try {
    const payload = parseProjectDeadlinePayload(req.body, { partial: false });
    const result = await pool.query(
      `
        INSERT INTO project_deadlines (
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme,
          created_at,
          updated_at;
      `,
      [
        crypto.randomUUID(),
        req.auth.userId,
        payload.abbr,
        payload.fullName,
        payload.location || "",
        payload.startDate,
        payload.deadline,
        payload.progress ?? 0,
        payload.note || "",
        payload.colorTheme || "green",
      ]
    );

    return res.status(201).json({
      item: mapProjectDeadlineRow(result.rows[0]),
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "project_conference_create_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.patch("/projects/conferences/:id", authMiddleware, async (req, res) => {
  try {
    const projectId = String(req.params?.id || "").trim();
    if (!projectId) {
      return res.status(400).json({ message: "invalid_project_id" });
    }

    const payload = parseProjectDeadlinePayload(req.body, { partial: true });
    const columnMap = {
      abbr: "abbr",
      fullName: "full_name",
      location: "location",
      startDate: "start_date",
      deadline: "deadline",
      progress: "progress",
      note: "note",
      colorTheme: "color_theme",
    };

    const updates = [];
    const values = [];
    let index = 1;

    for (const [key, column] of Object.entries(columnMap)) {
      if (!hasOwn(payload, key)) continue;
      updates.push(`${column} = $${index}`);
      values.push(payload[key]);
      index += 1;
    }

    if (!updates.length) {
      return res.status(400).json({ message: "no_project_fields_to_update" });
    }

    updates.push("updated_at = NOW()");

    values.push(projectId);
    values.push(req.auth.userId);
    const idParam = index;
    const userIdParam = index + 1;

    const result = await pool.query(
      `
        UPDATE project_deadlines
        SET ${updates.join(", ")}
        WHERE id = $${idParam}
          AND user_id = $${userIdParam}
        RETURNING
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme,
          created_at,
          updated_at;
      `,
      values
    );

    const updated = result.rows[0];
    if (!updated) {
      return res.status(404).json({ message: "project_conference_not_found" });
    }

    return res.status(200).json({
      item: mapProjectDeadlineRow(updated),
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "project_conference_update_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.delete("/projects/conferences/:id", authMiddleware, async (req, res) => {
  try {
    const projectId = String(req.params?.id || "").trim();
    if (!projectId) {
      return res.status(400).json({ message: "invalid_project_id" });
    }

    const result = await pool.query(
      `
        DELETE FROM project_deadlines
        WHERE id = $1
          AND user_id = $2
        RETURNING id;
      `,
      [projectId, req.auth.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: "project_conference_not_found" });
    }

    return res.status(200).json({
      id: result.rows[0].id,
      deleted: true,
    });
  } catch (err) {
    return res.status(500).json({
      message: "project_conference_delete_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/papers/feed", authMiddleware, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const pageSize = parsePositiveInt(req.query.pageSize, 10, 30);
    const requestedKeywords = normalizeKeywords(req.query.keywords);
    const appliedKeywords = requestedKeywords || defaultFeedKeywords;

    try {
      const openAlexResult = await fetchOpenAlexPapers({
        keywords: appliedKeywords,
        page,
        pageSize,
      });
      const openAlexPapers = openAlexResult.rows.map(mapOpenAlexPaper).filter(Boolean);

      await upsertPapersFromSemanticScholar(openAlexPapers);
      const paperIds = openAlexPapers.map((paper) => paper.id);
      const [userActionMap, likedPaperIds] = await Promise.all([
        getUserActionsByPaperIds(req.auth.userId, paperIds),
        getUserLikedPaperIds(req.auth.userId, paperIds),
      ]);

      const items = openAlexPapers.map((paper) => ({
        id: paper.id,
        arxivId: paper.arxivId,
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        publishedAt: paper.publishedAt,
        tags: paper.tags,
        userAction: userActionMap.get(paper.id) || null,
        likedByMe: likedPaperIds.has(paper.id),
        summary: null,
        source: "openalex",
        semanticProvider: "openalex",
        semanticKeyFallback: false,
        venue: paper.venue,
        year: paper.year,
        citationCount: paper.citationCount,
        url: paper.url,
        openAccessPdfUrl: paper.openAccessPdfUrl,
      }));

      const offset = (page - 1) * pageSize;
      return res.status(200).json({
        items,
        pagination: {
          page,
          pageSize,
          total: openAlexResult.total,
          hasMore: offset + items.length < openAlexResult.total,
        },
        meta: {
          requestedKeywords: requestedKeywords || null,
          appliedKeywords,
          source: "openalex",
          fallback: false,
        },
      });
    } catch (openAlexErr) {
      const localFeed = await loadLocalFeed({
        userId: req.auth.userId,
        page,
        pageSize,
      });

      return res.status(200).json({
        ...localFeed,
        meta: {
          requestedKeywords: requestedKeywords || null,
          appliedKeywords,
          source: "local_cache",
          fallback: true,
          openAlexError: String(openAlexErr?.message || "openalex_failed"),
        },
      });
    }
  } catch (err) {
    return res.status(500).json({
      message: "papers_feed_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/papers/:id/action", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "");
    const action = String(req.body?.action || "").toUpperCase();
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }
    if (!PAPER_ACTION_TYPES.has(action)) {
      return res.status(400).json({ message: "invalid_action" });
    }

    const paperResult = await pool.query(
      `
        SELECT id
        FROM papers
        WHERE id = $1
        LIMIT 1;
      `,
      [paperId]
    );
    if (!paperResult.rows[0]) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const saveResult = await pool.query(
      `
        INSERT INTO user_paper_actions (id, user_id, paper_id, action)
        VALUES ($1, $2, $3, $4::paper_action_type)
        ON CONFLICT (user_id, paper_id) DO UPDATE
          SET action = EXCLUDED.action,
              updated_at = NOW()
        RETURNING id, user_id, paper_id, action, created_at, updated_at;
      `,
      [crypto.randomUUID(), req.auth.userId, paperId, action]
    );
    const row = saveResult.rows[0];
    return res.status(200).json({
      id: row.id,
      userId: row.user_id,
      paperId: row.paper_id,
      action: row.action,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    return res.status(500).json({
      message: "paper_action_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/papers/:id/like", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "").trim();
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }
    const desiredLike =
      typeof req.body?.liked === "boolean" ? Boolean(req.body.liked) : null;

    const paperResult = await pool.query(
      `
        SELECT id
        FROM papers
        WHERE id = $1
        LIMIT 1;
      `,
      [paperId]
    );
    if (!paperResult.rows[0]) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let liked = false;

      if (desiredLike === true) {
        await client.query(
          `
            INSERT INTO paper_likes (id, user_id, paper_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, paper_id) DO NOTHING;
          `,
          [crypto.randomUUID(), req.auth.userId, paperId]
        );
        liked = true;
      } else if (desiredLike === false) {
        await client.query(
          `
            DELETE FROM paper_likes
            WHERE user_id = $1
              AND paper_id = $2;
          `,
          [req.auth.userId, paperId]
        );
        liked = false;
      } else {
        const insertResult = await client.query(
          `
            INSERT INTO paper_likes (id, user_id, paper_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, paper_id) DO NOTHING
            RETURNING id;
          `,
          [crypto.randomUUID(), req.auth.userId, paperId]
        );
        if (insertResult.rows[0]) {
          liked = true;
        } else {
          await client.query(
            `
              DELETE FROM paper_likes
              WHERE user_id = $1
                AND paper_id = $2;
            `,
            [req.auth.userId, paperId]
          );
          liked = false;
        }
      }

      const likedAtResult = liked
        ? await client.query(
            `
              SELECT created_at
              FROM paper_likes
              WHERE user_id = $1
                AND paper_id = $2
              LIMIT 1;
            `,
            [req.auth.userId, paperId]
          )
        : null;

      await client.query("COMMIT");
      return res.status(200).json({
        paperId,
        liked,
        likedAt: likedAtResult?.rows?.[0]?.created_at || null,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        message: "paper_like_failed",
        detail: String(err?.message || err),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({
      message: "paper_like_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/papers/:id", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "");
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }

    const result = await pool.query(
      `
        SELECT
          p.id,
          p.arxiv_id,
          p.title,
          p.authors,
          p.abstract,
          p.published_at,
          p.tags,
          ps.summary_bg,
          ps.summary_method,
          ps.summary_contrib,
          ps.model_name,
          upa.action AS user_action,
          EXISTS (
            SELECT 1
            FROM paper_likes pl
            WHERE pl.paper_id = p.id
              AND pl.user_id = $2
          ) AS liked_by_me
        FROM papers p
        LEFT JOIN paper_summaries ps
          ON ps.paper_id = p.id
        LEFT JOIN user_paper_actions upa
          ON upa.paper_id = p.id AND upa.user_id = $2
        WHERE p.id = $1
        LIMIT 1;
      `,
      [paperId, req.auth.userId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const isOpenAlexPaper = String(paperId).startsWith("oa:");
    const openAlexWorkIdFromArxiv = String(row.arxiv_id || "")
      .replace(/^openalex:/i, "")
      .trim();
    const openAlexWorkId = isOpenAlexPaper
      ? String(paperId).slice(3)
      : normalizeOpenAlexWorkId(openAlexWorkIdFromArxiv);

    let detailData = null;
    try {
      if (openAlexWorkId) {
        detailData = await fetchOpenAlexPaperByWorkId(openAlexWorkId);
      }
    } catch {
      detailData = null;
    }

    const link = detailData?.id || (openAlexWorkId ? `https://openalex.org/${openAlexWorkId}` : null);
    const openAccessPdfUrl = detailData?.best_oa_location?.pdf_url || null;

    return res.status(200).json({
      id: row.id,
      arxivId: row.arxiv_id,
      title: row.title,
      authors: row.authors || [],
      abstract: row.abstract,
      publishedAt: row.published_at,
      tags: row.tags || [],
      userAction: row.user_action || null,
      likedByMe: Boolean(row.liked_by_me),
      citationCount: Number.isFinite(detailData?.cited_by_count)
        ? detailData.cited_by_count
        : 0,
      venue: detailData?.primary_location?.source?.display_name || null,
      year: Number.isFinite(detailData?.publication_year)
        ? detailData.publication_year
        : null,
      link,
      openAccessPdfUrl,
      summary:
        row.summary_bg || row.summary_method || row.summary_contrib
          ? {
              background: row.summary_bg,
              method: row.summary_method,
              contribution: row.summary_contrib,
              modelName: row.model_name || null,
            }
          : null,
    });
  } catch (err) {
    return res.status(500).json({
      message: "paper_detail_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/papers/:id/ai-reading", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "").trim();
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }

    const preferredLanguage = normalizePreferredLanguage(req.body?.language || req.query?.language) || "en";

    const result = await pool.query(
      `
        SELECT
          p.id,
          p.arxiv_id,
          p.title,
          p.authors,
          p.abstract,
          p.published_at,
          p.tags,
          ps.summary_bg,
          ps.summary_method,
          ps.summary_contrib,
          ps.model_name
        FROM papers p
        LEFT JOIN paper_summaries ps
          ON ps.paper_id = p.id
        WHERE p.id = $1
        LIMIT 1;
      `,
      [paperId]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const isOpenAlexPaper = String(paperId).startsWith("oa:");
    const openAlexWorkIdFromArxiv = String(row.arxiv_id || "")
      .replace(/^openalex:/i, "")
      .trim();
    const openAlexWorkId = isOpenAlexPaper
      ? String(paperId).slice(3)
      : normalizeOpenAlexWorkId(openAlexWorkIdFromArxiv);

    let detailData = null;
    try {
      if (openAlexWorkId) {
        detailData = await fetchOpenAlexPaperByWorkId(openAlexWorkId);
      }
    } catch {
      detailData = null;
    }

    const aiInputRow = {
      ...row,
      venue: detailData?.primary_location?.source?.display_name || null,
      year: Number.isFinite(detailData?.publication_year)
        ? detailData.publication_year
        : null,
      citation_count: Number.isFinite(detailData?.cited_by_count)
        ? detailData.cited_by_count
        : 0,
    };

    try {
      const generated = await generatePaperAiReadingSummary({
        row: aiInputRow,
        language: preferredLanguage,
      });
      return res.status(200).json({
        paperId,
        language: preferredLanguage,
        summary: generated.summary,
        meta: {
          source: "llm",
          fallback: false,
          model: generated.llmMeta?.model || null,
          endpoint: generated.llmMeta?.endpoint || buildLlmChatCompletionsUrl(llmBaseUrl),
          attemptedModels: generated.llmMeta?.attemptedModels || [],
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (llmErr) {
      const fallbackSummary = buildPaperAiReadingFallback(aiInputRow, preferredLanguage);
      return res.status(200).json({
        paperId,
        language: preferredLanguage,
        summary: fallbackSummary,
        meta: {
          source: "fallback",
          fallback: true,
          reason: llmErr?.publicMessage || String(llmErr?.message || "llm_failed"),
          generatedAt: new Date().toISOString(),
        },
      });
    }
  } catch (err) {
    return res.status(500).json({
      message: "paper_ai_reading_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/papers/:id/comments", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "").trim();
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }

    const sortBy = normalizeCommentSortBy(req.query.sortBy);
    const order = normalizeSortOrder(req.query.order);
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const pageSize = parsePositiveInt(req.query.pageSize, 20, 100);
    const offset = (page - 1) * pageSize;

    const paperResult = await pool.query(
      `
        SELECT id
        FROM papers
        WHERE id = $1
        LIMIT 1;
      `,
      [paperId]
    );
    if (!paperResult.rows[0]) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const orderBySql =
      sortBy === "likes"
        ? `c.like_count ${order}, c.created_at DESC`
        : `c.created_at ${order}, c.like_count DESC`;

    const [countResult, listResult] = await Promise.all([
      pool.query(
        `
          SELECT COUNT(*)::int AS total
          FROM comments
          WHERE paper_id = $1
            AND status = 'VISIBLE';
        `,
        [paperId]
      ),
      pool.query(
        `
          SELECT
            c.id,
            c.paper_id,
            c.user_id,
            c.content,
            c.like_count,
            c.created_at,
            c.updated_at,
            u.nickname,
            u.avatar_url,
            EXISTS (
              SELECT 1
              FROM comment_likes cl
              WHERE cl.comment_id = c.id
                AND cl.user_id = $2
            ) AS liked_by_me
          FROM comments c
          INNER JOIN users u ON u.id = c.user_id
          WHERE c.paper_id = $1
            AND c.status = 'VISIBLE'
          ORDER BY ${orderBySql}
          LIMIT $3 OFFSET $4;
        `,
        [paperId, req.auth.userId, pageSize, offset]
      ),
    ]);

    const total = countResult.rows[0]?.total ?? 0;
    const items = listResult.rows.map((row) => ({
      id: row.id,
      paperId: row.paper_id,
      userId: row.user_id,
      user: {
        nickname: row.nickname || null,
        avatarUrl: row.avatar_url || null,
      },
      content: row.content,
      likeCount: Number.isFinite(row.like_count)
        ? row.like_count
        : Number(row.like_count || 0),
      likedByMe: Boolean(row.liked_by_me),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.status(200).json({
      items,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: offset + items.length < total,
      },
      sort: {
        by: sortBy,
        order: order.toLowerCase(),
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: "paper_comments_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/papers/:id/comments", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "").trim();
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }

    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res.status(400).json({ message: "invalid_comment_content" });
    }
    if (content.length > 2000) {
      return res.status(400).json({ message: "comment_too_long" });
    }

    const paperResult = await pool.query(
      `
        SELECT id
        FROM papers
        WHERE id = $1
        LIMIT 1;
      `,
      [paperId]
    );
    if (!paperResult.rows[0]) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const result = await pool.query(
      `
        INSERT INTO comments (
          id,
          paper_id,
          user_id,
          content,
          status
        )
        VALUES ($1, $2, $3, $4, 'VISIBLE')
        RETURNING
          id,
          paper_id,
          user_id,
          content,
          like_count,
          created_at,
          updated_at;
      `,
      [crypto.randomUUID(), paperId, req.auth.userId, content]
    );
    const row = result.rows[0];

    return res.status(201).json({
      item: {
        id: row.id,
        paperId: row.paper_id,
        userId: row.user_id,
        user: {
          nickname: req.currentUser?.nickname || null,
          avatarUrl: req.currentUser?.avatar_url || null,
        },
        content: row.content,
        likeCount: Number.isFinite(row.like_count)
          ? row.like_count
          : Number(row.like_count || 0),
        likedByMe: false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: "paper_comment_create_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/papers/:id/comments/:commentId/like", authMiddleware, async (req, res) => {
  const paperId = String(req.params.id || "").trim();
  const commentId = String(req.params.commentId || "").trim();
  if (!paperId) {
    return res.status(400).json({ message: "invalid_paper_id" });
  }
  if (!commentId) {
    return res.status(400).json({ message: "invalid_comment_id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const commentResult = await client.query(
      `
        SELECT id
        FROM comments
        WHERE id = $1
          AND paper_id = $2
          AND status = 'VISIBLE'
        LIMIT 1
        FOR UPDATE;
      `,
      [commentId, paperId]
    );
    if (!commentResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "comment_not_found" });
    }

    const insertLike = await client.query(
      `
        INSERT INTO comment_likes (id, comment_id, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (comment_id, user_id) DO NOTHING
        RETURNING id;
      `,
      [crypto.randomUUID(), commentId, req.auth.userId]
    );

    let liked = false;
    if (insertLike.rows[0]) {
      liked = true;
      await client.query(
        `
          UPDATE comments
          SET like_count = like_count + 1,
              updated_at = NOW()
          WHERE id = $1;
        `,
        [commentId]
      );
    } else {
      const deleteLike = await client.query(
        `
          DELETE FROM comment_likes
          WHERE comment_id = $1
            AND user_id = $2
          RETURNING id;
        `,
        [commentId, req.auth.userId]
      );
      if (deleteLike.rows[0]) {
        liked = false;
        await client.query(
          `
            UPDATE comments
            SET like_count = GREATEST(like_count - 1, 0),
                updated_at = NOW()
            WHERE id = $1;
          `,
          [commentId]
        );
      }
    }

    const likeCountResult = await client.query(
      `
        SELECT like_count
        FROM comments
        WHERE id = $1
        LIMIT 1;
      `,
      [commentId]
    );
    const likeCount = Number.isFinite(likeCountResult.rows[0]?.like_count)
      ? likeCountResult.rows[0].like_count
      : Number(likeCountResult.rows[0]?.like_count || 0);

    await client.query("COMMIT");
    return res.status(200).json({
      commentId,
      liked,
      likeCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({
      message: "paper_comment_like_failed",
      detail: String(err?.message || err),
    });
  } finally {
    client.release();
  }
});

app.get("/profile/dashboard", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [actionStats, commentStats, missionStats, taskStats, badgeStats] =
      await Promise.all([
        pool.query(
          `
            SELECT
              COUNT(*) FILTER (WHERE action = 'MARK')::int AS marked_count,
              COUNT(*) FILTER (WHERE action = 'READ')::int AS read_count,
              COUNT(*) FILTER (WHERE action = 'PASS')::int AS pass_count
            FROM user_paper_actions
            WHERE user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT COUNT(*)::int AS comment_count
            FROM comments
            WHERE user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT COUNT(*)::int AS mission_count
            FROM missions
            WHERE user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT
              COUNT(*) FILTER (WHERE t.status = 'TODO')::int AS todo_count,
              COUNT(*) FILTER (WHERE t.status = 'DOING')::int AS doing_count,
              COUNT(*) FILTER (WHERE t.status = 'DONE')::int AS done_count
            FROM tasks t
            INNER JOIN missions m ON m.id = t.mission_id
            WHERE m.user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT COUNT(*)::int AS badge_count
            FROM user_badges
            WHERE user_id = $1;
          `,
          [userId]
        ),
      ]);

    const actionRow = actionStats.rows[0] || {};
    const taskRow = taskStats.rows[0] || {};
    const user = req.currentUser;
    return res.status(200).json({
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
      },
      stats: {
        markedPapers: actionRow.marked_count ?? 0,
        readPapers: actionRow.read_count ?? 0,
        passPapers: actionRow.pass_count ?? 0,
        comments: commentStats.rows[0]?.comment_count ?? 0,
        missions: missionStats.rows[0]?.mission_count ?? 0,
        badges: badgeStats.rows[0]?.badge_count ?? 0,
        tasks: {
          todo: taskRow.todo_count ?? 0,
          doing: taskRow.doing_count ?? 0,
          done: taskRow.done_count ?? 0,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: "profile_dashboard_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/recent-reading", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await pool.query(
      `
        SELECT
          p.id,
          p.title,
          p.authors,
          p.abstract,
          p.published_at,
          upa.updated_at AS read_at
        FROM user_paper_actions upa
        INNER JOIN papers p
          ON p.id = upa.paper_id
        WHERE upa.user_id = $1
          AND upa.action = 'READ'
        ORDER BY upa.updated_at DESC
        LIMIT 2;
      `,
      [userId]
    );

    const items = result.rows.map((row) => ({
      id: row.id,
      title: row.title || "Untitled Paper",
      authors: Array.isArray(row.authors) ? row.authors : [],
      abstract: row.abstract || "",
      publishedAt: row.published_at,
      readAt: row.read_at,
    }));

    return res.status(200).json({
      items,
    });
  } catch (err) {
    return res.status(500).json({
      message: "recent_reading_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/lab/academic-pls", authMiddleware, async (req, res) => {
  try {
    const rawText = String(req.body?.text || "").trim();
    if (!rawText) {
      return res.status(400).json({ message: "invalid_input_text" });
    }
    if (rawText.length > MAX_ACADEMIC_TEXT_CHARS) {
      return res.status(400).json({ message: "input_too_long" });
    }

    const result = await generateAcademicPolish(rawText);
    try {
      await saveLabRecentRecord({
        userId: req.auth.userId,
        toolType: "ACADEMIC_PLS",
        title: `Polish: ${rawText.slice(0, 48)}`,
        inputPayload: {
          text: rawText,
        },
        outputPayload: result,
      });
    } catch {}

    return res.status(200).json({
      result,
      meta: {
        model: getPrimaryLlmModel(),
        modelPool: llmModelPool,
        endpoint: buildLlmChatCompletionsUrl(llmBaseUrl),
        inputChars: rawText.length,
        outputChars: result.polishedText.length,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "academic_polish_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.post("/lab/citations/format", authMiddleware, async (req, res) => {
  try {
    const rawText = String(req.body?.text || "").trim();
    const style = normalizeCitationStyle(req.body?.style || "AUTO");
    if (!rawText) {
      return res.status(400).json({ message: "invalid_input_text" });
    }
    if (rawText.length > MAX_CITATION_TEXT_CHARS) {
      return res.status(400).json({ message: "input_too_long" });
    }

    const result = await generateCitationFormatting(rawText, style);
    try {
      await saveLabRecentRecord({
        userId: req.auth.userId,
        toolType: "CITATIONS",
        title: `Citation: ${style}`,
        inputPayload: {
          text: rawText,
          styleRequested: style,
        },
        outputPayload: result,
      });
    } catch {}

    return res.status(200).json({
      result,
      meta: {
        model: getPrimaryLlmModel(),
        modelPool: llmModelPool,
        endpoint: buildLlmChatCompletionsUrl(llmBaseUrl),
        inputChars: rawText.length,
        outputRefs: result.formattedReferences.length,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "citation_format_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.get("/lab/academic-pls/recent", authMiddleware, async (req, res) => {
  try {
    const items = await listLabRecentRecords({
      userId: req.auth.userId,
      toolType: "ACADEMIC_PLS",
      limit: req.query.limit,
    });
    return res.status(200).json({
      items,
    });
  } catch (err) {
    return res.status(500).json({
      message: "academic_recent_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.delete("/lab/academic-pls/recent/:recordId", authMiddleware, async (req, res) => {
  try {
    const recordId = String(req.params?.recordId || "").trim();
    if (!recordId) {
      return res.status(400).json({ message: "invalid_record_id" });
    }

    const deleted = await deleteLabRecentRecord({
      userId: req.auth.userId,
      toolType: "ACADEMIC_PLS",
      recordId,
    });
    if (!deleted) {
      return res.status(404).json({ message: "recent_record_not_found" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      message: "academic_recent_delete_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/citations/recent", authMiddleware, async (req, res) => {
  try {
    const items = await listLabRecentRecords({
      userId: req.auth.userId,
      toolType: "CITATIONS",
      limit: req.query.limit,
    });
    return res.status(200).json({
      items,
    });
  } catch (err) {
    return res.status(500).json({
      message: "citation_recent_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.delete("/lab/citations/recent/:recordId", authMiddleware, async (req, res) => {
  try {
    const recordId = String(req.params?.recordId || "").trim();
    if (!recordId) {
      return res.status(400).json({ message: "invalid_record_id" });
    }

    const deleted = await deleteLabRecentRecord({
      userId: req.auth.userId,
      toolType: "CITATIONS",
      recordId,
    });
    if (!deleted) {
      return res.status(404).json({ message: "recent_record_not_found" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      message: "citation_recent_delete_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/data-viz/recent", authMiddleware, async (req, res) => {
  try {
    const items = await listLabRecentRecords({
      userId: req.auth.userId,
      toolType: "DATA_VIZ",
      limit: req.query.limit,
    });
    return res.status(200).json({
      items,
    });
  } catch (err) {
    return res.status(500).json({
      message: "dataviz_recent_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/review-simulator/recent", authMiddleware, async (req, res) => {
  try {
    const items = await listLabRecentRecords({
      userId: req.auth.userId,
      toolType: "REVIEW_SIMULATOR",
      limit: req.query.limit,
    });
    return res.status(200).json({
      items,
    });
  } catch (err) {
    return res.status(500).json({
      message: "review_recent_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.delete("/lab/review-simulator/recent/:recordId", authMiddleware, async (req, res) => {
  try {
    const recordId = String(req.params?.recordId || "").trim();
    if (!recordId) {
      return res.status(400).json({ message: "invalid_record_id" });
    }

    const deleted = await deleteLabRecentRecord({
      userId: req.auth.userId,
      toolType: "REVIEW_SIMULATOR",
      recordId,
    });
    if (!deleted) {
      return res.status(404).json({ message: "recent_record_not_found" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      message: "review_recent_delete_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/lab/data-viz/tasks", authMiddleware, async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || "").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const extension = String(req.body?.extension || "").trim();
    const fileUrl = String(req.body?.fileUrl || "").trim();
    const contentBase64 = String(req.body?.contentBase64 || "");
    const chartType = normalizeChartType(req.body?.chartType || "line");

    if (!fileName || (!fileUrl && !contentBase64.trim())) {
      return res.status(400).json({ message: "invalid_payload" });
    }
    const derivedExt = extension || extFromFileName(fileName);
    if (!SUPPORTED_DATAVIZ_EXTENSIONS.has(String(derivedExt || "").toLowerCase())) {
      return res.status(400).json({ message: "unsupported_dataviz_file_type" });
    }

    const task = createDataVizTask({
      userId: req.auth.userId,
      fileName,
      mimeType,
      extension: derivedExt,
      fileUrl,
      contentBase64,
      chartType,
    });
    runDataVizTask(task.taskId).catch(() => {});

    return res.status(202).json({
      task: buildDataVizTaskPayload(task),
    });
  } catch (err) {
    return res.status(500).json({
      message: "dataviz_task_create_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/data-viz/tasks/:taskId", authMiddleware, async (req, res) => {
  const taskId = String(req.params?.taskId || "").trim();
  if (!taskId) {
    return res.status(400).json({ message: "invalid_task_id" });
  }

  const task = dataVizTasks.get(taskId);
  if (!task || task.userId !== req.auth.userId) {
    return res.status(404).json({ message: "task_not_found" });
  }

  return res.status(200).json({
    task: buildDataVizTaskPayload(task),
  });
});

app.post("/lab/review-simulator/tasks", authMiddleware, async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || "").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const extension = String(req.body?.extension || "").trim();
    const fileUrl = String(req.body?.fileUrl || "").trim();

    if (!fileName || !fileUrl) {
      return res.status(400).json({ message: "invalid_payload" });
    }

    const derivedExt = extension || extFromFileName(fileName);
    if (!SUPPORTED_MANUSCRIPT_EXTENSIONS.has(String(derivedExt || "").toLowerCase())) {
      return res.status(400).json({ message: "unsupported_file_type" });
    }

    const task = createReviewTask({
      userId: req.auth.userId,
      fileName,
      mimeType,
      extension: derivedExt,
      fileUrl,
    });

    runReviewTask(task.taskId).catch(() => {});

    return res.status(202).json({
      task: buildReviewTaskPayload(task),
    });
  } catch (err) {
    return res.status(500).json({
      message: "review_task_create_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/review-simulator/tasks/:taskId", authMiddleware, async (req, res) => {
  const taskId = String(req.params?.taskId || "").trim();
  if (!taskId) {
    return res.status(400).json({ message: "invalid_task_id" });
  }

  const task = reviewTasks.get(taskId);
  if (!task || task.userId !== req.auth.userId) {
    return res.status(404).json({ message: "task_not_found" });
  }

  return res.status(200).json({
    task: buildReviewTaskPayload(task),
  });
});

app.post("/lab/review-simulator", authMiddleware, async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || "").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const extension = String(req.body?.extension || "").trim();
    const contentBase64 = String(req.body?.contentBase64 || "");
    const fileUrl = String(req.body?.fileUrl || "").trim();

    if (!fileName || (!contentBase64 && !fileUrl)) {
      return res.status(400).json({ message: "invalid_payload" });
    }

    const manuscript = await extractManuscriptText({
      fileName,
      mimeType,
      extension,
      contentBase64,
      fileUrl,
    });
    const reviewResult = await generateAiReviewFromManuscript(manuscript.text);

    return res.status(200).json({
      review: reviewResult.review,
      meta: {
        model: reviewResult.llmMeta?.model || getPrimaryLlmModel(),
        modelPool: llmModelPool,
        attemptedModels: reviewResult.llmMeta?.attemptedModels || [],
        endpoint:
          reviewResult.llmMeta?.endpoint || buildLlmChatCompletionsUrl(llmBaseUrl),
        inputChars: manuscript.text.length,
        fileType: manuscript.extension,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "review_simulation_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ message: "not_found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Research Pilot backend listening on ${port}`);
  console.log(
    `[llm] endpoint=${buildLlmChatCompletionsUrl(llmBaseUrl)} model_pool=${llmModelPool.join(",")}`
  );
});
