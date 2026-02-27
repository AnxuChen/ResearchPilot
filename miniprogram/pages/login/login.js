// pages/login/login.js
const app = getApp();
const { request } = require("../../utils/request");
const { getCurrentLanguage } = require("../../utils/language");
const WECHAT_DEFAULT_NICKNAME = "\u5fae\u4fe1\u7528\u6237";

function isWechatProfileIncomplete(user) {
  const authProvider = (user?.authProvider || "").toUpperCase();
  if (authProvider !== "WECHAT") return false;
  const nickname = (user?.nickname ? String(user.nickname).trim() : "") || "";
  const avatarUrl = (user?.avatarUrl ? String(user.avatarUrl).trim() : "") || "";
  return !nickname || nickname === WECHAT_DEFAULT_NICKNAME || nickname === "WeChat User" || !avatarUrl;
}

Page({
  data: {
    language: "en",
    isLoading: false,
    email: "",
    password: "",
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

  onInputEmail(e) {
    this.setData({ email: e.detail.value || "" });
  },

  onInputPassword(e) {
    this.setData({ password: e.detail.value || "" });
  },

  saveAuth(authData) {
    wx.setStorageSync("token", authData.token);
    wx.setStorageSync("user", authData.user || {});
    app.globalData.user = authData.user || null;
  },

  routeAfterLogin(authData) {
    this.saveAuth(authData);
    if (isWechatProfileIncomplete(authData?.user || {})) {
      wx.redirectTo({
        url: "/pages/wx_profile_setup/index",
        fail: () => {
          wx.navigateTo({
            url: "/pages/wx_profile_setup/index",
          });
        },
      });
      return;
    }

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
        title: this.data.language === "zh" ? "请输入邮箱和密码" : "Enter email and password",
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
      this.routeAfterLogin(resp);
    } catch (err) {
      if (err.statusCode === 401) {
        wx.showToast({
          title: this.data.language === "zh" ? "账号或密码错误" : "Invalid email or password",
          icon: "none",
        });
        return;
      }
      const msg =
        err?.response?.message ||
        (this.data.language === "zh" ? "登录失败，请重试" : "Sign in failed, please retry");
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onWxSignIn() {
    if (this.data.isLoading) return;

    const doWxLogin = (wechatProfile = {}) => {
      wx.login({
        success: async (loginRes) => {
          if (!loginRes.code) {
            wx.showToast({
              title: this.data.language === "zh" ? "获取登录码失败" : "Failed to get login code",
              icon: "none",
            });
            this.setData({ isLoading: false });
            return;
          }

          const sendLoginRequest = async (retryTimes = 0) => {
            let willRetry = false;
            try {
              const resp = await request({
                url: "/auth/wx-login",
                method: "POST",
              data: {
                code: loginRes.code,
                nickname: wechatProfile.nickname || null,
                avatarUrl: wechatProfile.avatarUrl || null,
              },
              });
              this.routeAfterLogin(resp);
            } catch (err) {
              if (err.statusCode === 502 && retryTimes < 1) {
                willRetry = true;
                setTimeout(() => {
                  sendLoginRequest(retryTimes + 1);
                }, 800);
                return;
              }
              if (err.statusCode) {
                const msg =
                  err?.response?.message || `WeChat sign in failed (${err.statusCode})`;
                wx.showToast({
                  title: msg,
                  icon: "none",
                });
              } else {
                console.error("Failed to call WeChat login API", err);
                wx.showToast({
                  title: this.data.language === "zh" ? "网络异常，请稍后重试" : "Network error, please retry",
                  icon: "none",
                });
              }
            } finally {
              if (!willRetry) {
                this.setData({ isLoading: false });
              }
            }
          };

          sendLoginRequest(0);
        },
        fail: (err) => {
          console.error("wx.login failed", err);
          wx.showToast({
            title: this.data.language === "zh" ? "微信登录失败" : "WeChat sign in failed",
            icon: "none",
          });
          this.setData({ isLoading: false });
        },
      });
    };

    this.setData({ isLoading: true });
    if (typeof wx.getUserProfile !== "function") {
      doWxLogin({});
      return;
    }

    wx.getUserProfile({
      desc: this.data.language === "zh" ? "用于完善用户资料" : "Used to complete your profile",
      success: (res) => {
        const userInfo = (res && res.userInfo) || {};
        doWxLogin({
          nickname: userInfo.nickName || null,
          avatarUrl: userInfo.avatarUrl || null,
        });
      },
      fail: (err) => {
        console.warn("wx.getUserProfile failed, continue WeChat login", err);
        doWxLogin({});
      },
    });
  },

  onCreate() {
    wx.navigateTo({
      url: "/pages/register/register",
      fail: (err) => {
        console.error("Navigation failed, please check the target path", err);
      },
    });
  },
});
