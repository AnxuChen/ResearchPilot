// pages/login/login.js
const app = getApp();
const { request } = require("../../utils/request");

Page({
  data: {
    isLoading: false,
    email: "",
    password: "",
  },

  onInputEmail(e) {
    this.setData({ email: e.detail.value || "" });
  },

  onInputPassword(e) {
    this.setData({ password: e.detail.value || "" });
  },

  saveAuthAndJump(authData) {
    wx.setStorageSync("token", authData.token);
    wx.setStorageSync("user", authData.user || {});
    app.globalData.user = authData.user || null;
    wx.switchTab({
      url: "/pages/lab/index",
    });
  },

  async onSignIn() {
    if (this.data.isLoading) return;

    const email = (this.data.email || "").trim();
    const password = this.data.password || "";
    if (!email || !password) {
      wx.showToast({
        title: "请输入邮箱和密码",
        icon: "none",
      });
      return;
    }

    this.setData({ isLoading: true });
    try {
      const resp = await request({
        url: "/auth/email-login",
        method: "POST",
        data: { email, password },
      });
      this.saveAuthAndJump(resp);
    } catch (err) {
      if (err.statusCode === 401) {
        wx.showToast({ title: "账号或密码错误", icon: "none" });
        return;
      }
      const msg = err?.response?.message || "登录失败，请重试";
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onWxSignIn() {
    if (this.data.isLoading) return;

    const baseUrl = (app.globalData.apiBaseUrl || "").replace(/\/$/, "");
    if (!baseUrl) {
      wx.showToast({
        title: "未配置后端地址",
        icon: "none",
      });
      return;
    }

    this.setData({ isLoading: true });
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          wx.showToast({ title: "获取登录码失败", icon: "none" });
          this.setData({ isLoading: false });
          return;
        }

        const sendLoginRequest = (retryTimes = 0) => {
          let willRetry = false;
          wx.request({
            url: `${baseUrl}/auth/wx-login`,
            method: "POST",
            timeout: 12000,
            header: {
              "Content-Type": "application/json",
            },
            data: {
              code: loginRes.code,
            },
            success: (res) => {
              if (res.statusCode === 200 && res.data && res.data.token) {
                this.saveAuthAndJump(res.data);
                return;
              }

              if (res.statusCode === 502 && retryTimes < 1) {
                willRetry = true;
                setTimeout(() => sendLoginRequest(retryTimes + 1), 800);
                return;
              }

              const msg =
                (res.data && res.data.message) || `微信登录失败(${res.statusCode})`;
              wx.showToast({
                title: msg,
                icon: "none",
              });
            },
            fail: (err) => {
              console.error("请求微信登录接口失败", err);
              wx.showToast({
                title: "网络异常，请稍后重试",
                icon: "none",
              });
            },
            complete: () => {
              if (!willRetry) {
                this.setData({ isLoading: false });
              }
            },
          });
        };

        sendLoginRequest(0);
      },
      fail: (err) => {
        console.error("wx.login 调用失败", err);
        wx.showToast({
          title: "微信登录失败",
          icon: "none",
        });
        this.setData({ isLoading: false });
      },
    });
  },

  onCreate() {
    wx.navigateTo({
      url: "/pages/register/register",
      fail: (err) => {
        console.error("跳转失败，请检查路径是否正确", err);
      },
    });
  },
});
