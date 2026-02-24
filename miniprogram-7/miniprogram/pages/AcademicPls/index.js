const { request } = require("../../utils/request");

const MIN_TEXT_LENGTH = 30;
const MAX_TEXT_LENGTH = 20000;
const RECENT_LIMIT = 10;

function formatRecentTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 60 * 1000) return "刚刚";
  if (diffMs < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / (60 * 1000)))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)))}h ago`;
  }

  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapRecentPolish(item) {
  const inputPayload =
    item && item.inputPayload && typeof item.inputPayload === "object"
      ? item.inputPayload
      : {};
  const outputPayload =
    item && item.outputPayload && typeof item.outputPayload === "object"
      ? item.outputPayload
      : {};

  const inputText = String(inputPayload.text || "").trim();
  const outputText = String(outputPayload.polishedText || "").trim();
  const improvements = Array.isArray(outputPayload.improvements)
    ? outputPayload.improvements.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const tone = String(outputPayload.tone || "ACADEMIC")
    .trim()
    .toUpperCase();

  return {
    id: item.id,
    title: String(item.title || "").trim(),
    inputText,
    outputText,
    improvements,
    tone,
    toneLabel: tone === "FORMAL" ? "Formal" : "Academic",
    timeText: formatRecentTime(item.createdAt),
    inputPreview: String(item.inputPreview || inputText || "").trim(),
  };
}

Page({
  data: {
    inputText: "",
    outputText: "",
    improvements: [],
    recentItems: [],
    isRecentLoading: false,
    isSubmitting: false,
    errorMsg: "",
  },

  onShow() {
    this.fetchRecentPolishes();
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
    this.setData({
      inputText: e.detail.value || "",
      errorMsg: "",
    });
  },

  onClearInput() {
    this.setData({
      inputText: "",
      outputText: "",
      improvements: [],
      errorMsg: "",
    });
  },

  onPasteInput() {
    wx.getClipboardData({
      success: (res) => {
        const text = String(res?.data || "");
        this.setData({
          inputText: text,
          errorMsg: "",
        });
      },
      fail: () => {
        wx.showToast({
          title: "读取剪贴板失败",
          icon: "none",
        });
      },
    });
  },

  async onPolishText() {
    const text = String(this.data.inputText || "").trim();
    if (this.data.isSubmitting) return;
    if (!text) {
      wx.showToast({
        title: "请先输入论文文本",
        icon: "none",
      });
      return;
    }
    if (text.length < MIN_TEXT_LENGTH) {
      wx.showToast({
        title: `至少输入 ${MIN_TEXT_LENGTH} 个字符`,
        icon: "none",
      });
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      wx.showToast({
        title: "输入过长，请精简后重试",
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
        url: "/lab/academic-pls",
        method: "POST",
        auth: true,
        timeout: 30000,
        data: { text },
      });
      const result = resp?.result || {};
      this.setData({
        outputText: String(result.polishedText || "").trim(),
        improvements: Array.isArray(result.improvements) ? result.improvements : [],
      });
      this.fetchRecentPolishes();
    } catch (err) {
      if (this.handleAuthError(err)) return;
      const msg = err?.response?.message || "润色失败，请稍后重试";
      this.setData({ errorMsg: msg });
      wx.showToast({
        title: "润色失败",
        icon: "none",
      });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  onCopyOutput() {
    const outputText = String(this.data.outputText || "").trim();
    if (!outputText) {
      wx.showToast({
        title: "暂无可复制内容",
        icon: "none",
      });
      return;
    }
    wx.setClipboardData({
      data: outputText,
      success: () => {
        wx.showToast({
          title: "已复制",
          icon: "success",
        });
      },
    });
  },

  async fetchRecentPolishes() {
    if (this.data.isRecentLoading) return;
    this.setData({ isRecentLoading: true });
    try {
      const resp = await request({
        url: "/lab/academic-pls/recent",
        method: "GET",
        auth: true,
        timeout: 20000,
        data: {
          limit: RECENT_LIMIT,
        },
      });
      const items = Array.isArray(resp?.items) ? resp.items.map(mapRecentPolish) : [];
      this.setData({ recentItems: items });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({ recentItems: [] });
    } finally {
      this.setData({ isRecentLoading: false });
    }
  },

  onTapRecentPolish(e) {
    const index = Number(e.currentTarget?.dataset?.index);
    if (!Number.isFinite(index) || index < 0) return;
    const item = this.data.recentItems[index];
    if (!item) return;

    this.setData({
      inputText: item.inputText || "",
      outputText: item.outputText || "",
      improvements: Array.isArray(item.improvements) ? item.improvements : [],
      errorMsg: "",
    });

    wx.showToast({
      title: "已载入历史润色",
      icon: "none",
    });
  },
});
