const { request } = require("../../utils/request");

const STYLE_OPTIONS = [
  { value: "APA7", label: "APA 7" },
  { value: "MLA9", label: "MLA 9" },
  { value: "CHICAGO", label: "Chicago" },
  { value: "AUTO", label: "✨ Auto-Detect" },
];

Page({
  data: {
    inputText: "",
    selectedStyle: "AUTO",
    styleOptions: STYLE_OPTIONS,
    outputText: "",
    styleUsed: "",
    detectedStyle: "",
    notes: [],
    isSubmitting: false,
    errorMsg: "",
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
      notes: [],
      styleUsed: "",
      detectedStyle: "",
      errorMsg: "",
    });
  },

  onPasteInput() {
    wx.getClipboardData({
      success: (res) => {
        this.setData({
          inputText: String(res?.data || ""),
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

  onSelectStyle(e) {
    const style = String(e.currentTarget?.dataset?.style || "AUTO").toUpperCase();
    this.setData({ selectedStyle: style });
  },

  async onFormatCitations() {
    if (this.data.isSubmitting) return;
    const text = String(this.data.inputText || "").trim();
    if (!text) {
      wx.showToast({ title: "请先输入引用文本", icon: "none" });
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
    } catch (err) {
      if (this.handleAuthError(err)) return;
      const msg = err?.response?.message || "格式化失败，请稍后重试";
      this.setData({ errorMsg: msg });
      wx.showToast({ title: "格式化失败", icon: "none" });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  onCopyOutput() {
    const text = String(this.data.outputText || "").trim();
    if (!text) {
      wx.showToast({ title: "暂无可复制内容", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: "已复制", icon: "success" });
      },
    });
  },
});
