const LANGUAGE_STORAGE_KEY = "app_language";

function normalizeLanguage(value) {
  const lang = String(value || "").trim().toLowerCase();
  return lang === "zh" ? "zh" : "en";
}

function getCurrentLanguage() {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    const globalLang = app?.globalData?.language;
    if (globalLang) return normalizeLanguage(globalLang);
  } catch (err) {
    // ignore app getter errors
  }
  const stored = wx.getStorageSync(LANGUAGE_STORAGE_KEY);
  return normalizeLanguage(stored);
}

function setCurrentLanguage(value) {
  const language = normalizeLanguage(value);
  wx.setStorageSync(LANGUAGE_STORAGE_KEY, language);
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.language = language;
    }
  } catch (err) {
    // ignore app getter errors
  }
  return language;
}

module.exports = {
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  getCurrentLanguage,
  setCurrentLanguage,
};

