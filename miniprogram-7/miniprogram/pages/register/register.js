const app = getApp();
const { request } = require("../../utils/request");

Page({
  data: {
    fullName: "",
    email: "",
    fieldOfStudy: "",
    password: "",
    isLoading: false,
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
      wx.showToast({ title: "请输入邮箱", icon: "none" });
      return;
    }
    if (password.length < 8) {
      wx.showToast({ title: "密码至少 8 位", icon: "none" });
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
      wx.showToast({ title: "注册成功", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/lab/index" });
      }, 300);
    } catch (err) {
      if (err.statusCode === 409) {
        wx.showToast({ title: "邮箱已注册", icon: "none" });
        return;
      }
      const msg = err?.response?.message || "注册失败，请重试";
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
