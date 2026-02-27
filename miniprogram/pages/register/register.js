const app = getApp();
const { request } = require("../../utils/request");
const { getCurrentLanguage } = require("../../utils/language");

Page({
  data: {
    language: "en",
    fullName: "",
    email: "",
    fieldOfStudy: "",
    password: "",
    isLoading: false,
  },

  onLoad() {
    this.syncLanguage();
  },

  onShow() {
    this.syncLanguage();
  },

  syncLanguage() {
    const language = getCurrentLanguage();
    this.setData({ language });
  },

  onInputFullName(e) {
    this.setData({ fullName: e.detail.value || "" });
  },

  onInputEmail(e) {
    this.setData({ email: e.detail.value || "" });
  },

  onInputFieldOfStudy(e) {
    this.setData({ fieldOfStudy: e.detail.value || "" });
  },

  onInputPassword(e) {
    this.setData({ password: e.detail.value || "" });
  },

  async onSignUp() {
    if (this.data.isLoading) return;
    const email = (this.data.email || "").trim();
    const password = this.data.password || "";

    if (!email) {
      wx.showToast({
        title: this.data.language === "zh" ? "请输入邮箱" : "Enter email",
        icon: "none",
      });
      return;
    }
    if (password.length < 8) {
      wx.showToast({
        title:
          this.data.language === "zh"
            ? "密码至少 8 位"
            : "Password must be at least 8 characters",
        icon: "none",
      });
      return;
    }

    this.setData({ isLoading: true });
    try {
      const resp = await request({
        url: "/auth/email-register",
        method: "POST",
        data: {
          email,
          password,
          fullName: (this.data.fullName || "").trim(),
          fieldOfStudy: (this.data.fieldOfStudy || "").trim(),
        },
      });
      wx.setStorageSync("token", resp.token);
      wx.setStorageSync("user", resp.user || {});
      app.globalData.user = resp.user || null;
      wx.showToast({
        title: this.data.language === "zh" ? "注册成功" : "Registered",
        icon: "success",
      });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/lab/index" });
      }, 300);
    } catch (err) {
      if (err.statusCode === 409) {
        wx.showToast({
          title: this.data.language === "zh" ? "邮箱已注册" : "Email already registered",
          icon: "none",
        });
        return;
      }
      const msg =
        err?.response?.message ||
        (this.data.language === "zh" ? "注册失败，请重试" : "Registration failed, please retry");
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  goLogin() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.navigateTo({
      url: "/pages/login/login",
    });
  },
});
