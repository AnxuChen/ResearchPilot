const { request } = require("../../utils/request");
const { getCurrentLanguage } = require("../../utils/language");
const MAX_INPUT_CHARS = 500;
const RECENT_LIMIT = 10;

const STYLE_SET = new Set(["APA7", "MLA9", "CHICAGO", "AUTO"]);

function buildStyleOptions(language) {
  const isZh = language === "zh";
  return [
    { value: "APA7", label: "APA 7" },
    { value: "MLA9", label: "MLA 9" },
    { value: "CHICAGO", label: isZh ? "芝加哥" : "Chicago" },
    { value: "AUTO", label: isZh ? "✨ 自动识别" : "✨ Auto-Detect" },
  ];
}

function formatRecentTime(value, language) {
  const isZh = language === "zh";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60 * 1000) return isZh ? "刚刚" : "just now";
  if (diffMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
    return isZh ? `${mins}分钟前` : `${mins}m ago`;
  }
  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)));
    return isZh ? `${hours}小时前` : `${hours}h ago`;
  }
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStyle(value, fallback = "AUTO") {
  const style = String(value || "").trim().toUpperCase();
  if (!style) return fallback;
  if (style === "APA") return "APA7";
  if (style === "MLA") return "MLA9";
  if (STYLE_SET.has(style)) return style;
  return fallback;
}

function mapRecentFormat(item, language) {
  const inputPayload =
    item && item.inputPayload && typeof item.inputPayload === "object"
      ? item.inputPayload
      : {};
  const outputPayload =
    item && item.outputPayload && typeof item.outputPayload === "object"
      ? item.outputPayload
      : {};

  const inputText = String(inputPayload.text || "").trim();
  const styleRequested = normalizeStyle(inputPayload.styleRequested, "AUTO");
  const styleUsed = normalizeStyle(outputPayload.styleUsed, styleRequested);
  const detectedStyle = normalizeStyle(outputPayload.detectedStyle, "AUTO");
  const formattedReferences = Array.isArray(outputPayload.formattedReferences)
    ? outputPayload.formattedReferences.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const formattedText = String(
    outputPayload.formattedText || formattedReferences.join("\n")
  ).trim();
  const notes = Array.isArray(outputPayload.notes)
    ? outputPayload.notes.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  return {
    id: item.id,
    title: String(item.title || "").trim(),
    inputText,
    styleRequested,
    styleUsed,
    detectedStyle,
    formattedText,
    notes,
    timeText: formatRecentTime(item.createdAt, language),
    inputPreview: String(item.inputPreview || inputText || "").trim(),
  };
}

Page({
  data: {
    language: "en",
    inputText: "",
    selectedStyle: "AUTO",
    styleOptions: buildStyleOptions("en"),
    outputText: "",
    styleUsed: "",
    detectedStyle: "",
    notes: [],
    recentItems: [],
    isRecentLoading: false,
    isSubmitting: false,
    errorMsg: "",
  },

  onShow() {
    this.syncLanguage();
    this.fetchRecentFormats();
  },

  syncLanguage() {
    const language = getCurrentLanguage();
    this.setData({
      language,
      styleOptions: buildStyleOptions(language),
    });
  },

  handleAuthError(err) {
    if (err.statusCode === 401 || err.message === "missing_token") {
      wx.removeStorageSync("token");
      wx.removeStorageSync("user");
      wx.reLaunch({
        url: "/pages/login/login",
      });
      return true;
    }
    return false;
  },

  onInputText(e) {
    const text = String(e.detail.value || "").slice(0, MAX_INPUT_CHARS);
    this.setData({
      inputText: text,
      errorMsg: "",
    });
  },

  onClearInput() {
    this.setData({
      inputText: "",
      outputText: "",
      notes: [],
      styleUsed: "",
      detectedStyle: "",
      errorMsg: "",
    });
  },

  onPasteInput() {
    wx.getClipboardData({
      success: (res) => {
        const pasted = String(res?.data || "").slice(0, MAX_INPUT_CHARS);
        this.setData({
          inputText: pasted,
          errorMsg: "",
        });
      },
      fail: () => {
        wx.showToast({
          title: this.data.language === "zh" ? "读取剪贴板失败" : "Failed to read clipboard",
          icon: "none",
        });
      },
    });
  },

  onSelectStyle(e) {
    const style = String(e.currentTarget?.dataset?.style || "AUTO").toUpperCase();
    this.setData({ selectedStyle: style });
  },

  async onFormatCitations() {
    if (this.data.isSubmitting) return;
    const text = String(this.data.inputText || "").trim();
    if (!text) {
      wx.showToast({
        title: this.data.language === "zh" ? "请先输入引用文本" : "Please enter citation text",
        icon: "none",
      });
      return;
    }

    this.setData({
      isSubmitting: true,
      errorMsg: "",
    });

    try {
      const resp = await request({
        url: "/lab/citations/format",
        method: "POST",
        auth: true,
        timeout: 30000,
        data: {
          text,
          style: this.data.selectedStyle,
        },
      });
      const result = resp?.result || {};
      this.setData({
        outputText: String(result.formattedText || "").trim(),
        styleUsed: String(result.styleUsed || ""),
        detectedStyle: String(result.detectedStyle || ""),
        notes: Array.isArray(result.notes) ? result.notes : [],
      });
      this.fetchRecentFormats();
    } catch (err) {
      if (this.handleAuthError(err)) return;
      const msg =
        err?.response?.message ||
        (this.data.language === "zh" ? "格式化失败，请稍后重试" : "Format failed, please retry");
      this.setData({ errorMsg: msg });
      wx.showToast({
        title: this.data.language === "zh" ? "格式化失败" : "Format failed",
        icon: "none",
      });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  onCopyOutput() {
    const text = String(this.data.outputText || "").trim();
    if (!text) {
      wx.showToast({
        title: this.data.language === "zh" ? "暂无可复制内容" : "No content to copy",
        icon: "none",
      });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: this.data.language === "zh" ? "已复制" : "Copied",
          icon: "success",
        });
      },
    });
  },

  async fetchRecentFormats() {
    if (this.data.isRecentLoading) return;
    this.setData({ isRecentLoading: true });
    try {
      const resp = await request({
        url: "/lab/citations/recent",
        method: "GET",
        auth: true,
        timeout: 20000,
        data: {
          limit: RECENT_LIMIT,
        },
      });
      const items = Array.isArray(resp?.items)
        ? resp.items.map((item) => mapRecentFormat(item, this.data.language))
        : [];
      this.setData({ recentItems: items });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({ recentItems: [] });
    } finally {
      this.setData({ isRecentLoading: false });
    }
  },

  onTapRecentFormat(e) {
    const index = Number(e.currentTarget?.dataset?.index);
    if (!Number.isFinite(index) || index < 0) return;
    const item = this.data.recentItems[index];
    if (!item) return;

    this.setData({
      inputText: item.inputText || "",
      selectedStyle: normalizeStyle(item.styleRequested, "AUTO"),
      outputText: item.formattedText || "",
      styleUsed: item.styleUsed || "",
      detectedStyle: item.detectedStyle || "",
      notes: Array.isArray(item.notes) ? item.notes : [],
      errorMsg: "",
    });

    wx.showToast({
      title: this.data.language === "zh" ? "已载入历史格式化" : "Loaded from recent history",
      icon: "none",
    });
  },

  async onDeleteRecentFormat(e) {
    const recordId = String(e.currentTarget?.dataset?.id || "").trim();
    if (!recordId) return;

    try {
      await request({
        url: `/lab/citations/recent/${encodeURIComponent(recordId)}`,
        method: "DELETE",
        auth: true,
        timeout: 15000,
      });

      this.setData({
        recentItems: this.data.recentItems.filter((item) => item.id !== recordId),
      });
      wx.showToast({
        title: this.data.language === "zh" ? "已删除" : "Deleted",
        icon: "success",
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      wx.showToast({
        title: this.data.language === "zh" ? "删除失败" : "Delete failed",
        icon: "none",
      });
    }
  },
});
