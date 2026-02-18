// pages/profile/index.js
const { request } = require("../../utils/request");

function buildDisplayName(user) {
  const nickname = (user && user.nickname ? String(user.nickname).trim() : "") || "";
  if (nickname) return nickname;
  const email = (user && user.email ? String(user.email).trim() : "") || "";
  if (email && email.includes("@")) return email.split("@")[0];
  return "User";
}

function buildBio(user) {
  const fieldOfStudy =
    (user && user.fieldOfStudy ? String(user.fieldOfStudy).trim() : "") || "";
  if (fieldOfStudy) return fieldOfStudy;
  return "Design-minded academic explorer";
}

Page({
  data: {
    userName: "User",
    userBio: "Design-minded academic explorer",
    avatarUrl: "/images/profile/user.png",
    authProvider: "",
    showWxProfileEditor: false,
    editNickname: "",
    editAvatarUrl: "",
    pendingAvatarDataUrl: "",
    isSavingWxProfile: false,
  },

  onShow() {
    this.syncProfile();
  },

  onPullDownRefresh() {
    this.syncProfile({ stopPullDown: true });
  },

  async syncProfile(options = {}) {
    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });
      this.setData({
        userName: buildDisplayName(user),
        userBio: buildBio(user),
        avatarUrl: user.avatarUrl || "/images/profile/user.png",
        authProvider: user.authProvider || "",
        showWxProfileEditor:
          (user.authProvider || "") === "WECHAT" &&
          ((!user.nickname || user.nickname === "微信用户") || !user.avatarUrl),
        editNickname:
          (user.nickname && user.nickname !== "微信用户" ? user.nickname : "") || "",
        editAvatarUrl: user.avatarUrl || "/images/profile/user.png",
        pendingAvatarDataUrl: "",
      });
      wx.setStorageSync("user", user || {});
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({
          url: "/pages/login/login",
        });
        return;
      }

      const cachedUser = wx.getStorageSync("user") || {};
      this.setData({
        userName: buildDisplayName(cachedUser),
        userBio: buildBio(cachedUser),
        avatarUrl: cachedUser.avatarUrl || "/images/profile/user.png",
      });
    } finally {
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  onEditNicknameInput(e) {
    this.setData({
      editNickname: e.detail.value || "",
    });
  },

  onChooseAvatar(e) {
    const tempPath = e?.detail?.avatarUrl;
    if (!tempPath) return;

    wx.compressImage({
      src: tempPath,
      quality: 40,
      success: (compressRes) => {
        const filePath = compressRes.tempFilePath || tempPath;
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: "base64",
          success: (fileRes) => {
            const base64 = fileRes.data || "";
            if (!base64) {
              wx.showToast({ title: "头像读取失败", icon: "none" });
              return;
            }
            const dataUrl = `data:image/jpeg;base64,${base64}`;
            this.setData({
              editAvatarUrl: tempPath,
              pendingAvatarDataUrl: dataUrl,
            });
          },
          fail: () => {
            wx.showToast({ title: "头像读取失败", icon: "none" });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: "头像处理失败", icon: "none" });
      },
    });
  },

  async onSaveWxProfile() {
    if (this.data.isSavingWxProfile) return;
    const nickname = (this.data.editNickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }

    this.setData({ isSavingWxProfile: true });
    try {
      const resp = await request({
        url: "/users/me/profile",
        method: "PUT",
        auth: true,
        data: {
          nickname,
          avatarUrl: this.data.pendingAvatarDataUrl || null,
        },
      });
      const user = resp?.user || {};
      wx.setStorageSync("user", user);
      this.setData({
        userName: buildDisplayName(user),
        avatarUrl: user.avatarUrl || this.data.editAvatarUrl || "/images/profile/user.png",
        showWxProfileEditor: false,
        pendingAvatarDataUrl: "",
      });
      wx.showToast({ title: "资料已更新", icon: "success" });
    } catch (err) {
      const msg = err?.response?.message || "更新失败";
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ isSavingWxProfile: false });
    }
  },
});
