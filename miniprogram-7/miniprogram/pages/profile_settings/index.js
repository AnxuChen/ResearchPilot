const { request } = require("../../utils/request");

const DEFAULT_AVATAR = "/images/profile/user.png";
const BADGE_PREF_STORAGE_KEY = "profile_badge_preferences_v1";
const BADGE_OPTIONS = [
  {
    key: "night_owl",
    icon: "🌙",
    previewText: "Night Owl",
    className: "badge-style-night-owl",
  },
  {
    key: "sunrise_scholar",
    icon: "🌅",
    previewText: "Sunrise Scholar",
    className: "badge-style-sunrise-scholar",
  },
  {
    key: "deep_focus",
    icon: "🧠",
    previewText: "Deep Focus",
    className: "badge-style-deep-focus",
  },
  {
    key: "citation_ninja",
    icon: "📚",
    previewText: "Citation Ninja",
    className: "badge-style-citation-ninja",
  },
  {
    key: "data_wizard",
    icon: "📊",
    previewText: "Data Wizard",
    className: "badge-style-data-wizard",
  },
  {
    key: "peer_reviewer",
    icon: "🧪",
    previewText: "Peer Reviewer",
    className: "badge-style-peer-reviewer",
  },
];

function normalizeBadgeKey(value) {
  const key = String(value || "").trim();
  if (!key) return BADGE_OPTIONS[0].key;
  return BADGE_OPTIONS.some((item) => item.key === key) ? key : BADGE_OPTIONS[0].key;
}

function getBadgeOptionByKey(value) {
  const key = normalizeBadgeKey(value);
  return BADGE_OPTIONS.find((item) => item.key === key) || BADGE_OPTIONS[0];
}

function getBadgePrefsMap() {
  const raw = wx.getStorageSync(BADGE_PREF_STORAGE_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function getUserBadgePref(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const map = getBadgePrefsMap();
  const pref = map[id];
  if (!pref || typeof pref !== "object") return null;
  return {
    key: normalizeBadgeKey(pref.key),
    text: String(pref.text || "").trim().slice(0, 24),
  };
}

function saveUserBadgePref(userId, payload) {
  const id = String(userId || "").trim();
  if (!id) return;
  const map = getBadgePrefsMap();
  map[id] = {
    key: normalizeBadgeKey(payload?.key),
    text: String(payload?.text || "").trim().slice(0, 24),
  };
  wx.setStorageSync(BADGE_PREF_STORAGE_KEY, map);
}

Page({
  data: {
    userId: "",
    nickname: "",
    displayAvatarUrl: DEFAULT_AVATAR,
    originalAvatarUrl: "",
    pendingAvatarDataUrl: "",
    isSaving: false,
    badgeOptions: BADGE_OPTIONS,
    selectedBadgeKey: BADGE_OPTIONS[0].key,
    selectedBadgeIcon: BADGE_OPTIONS[0].icon,
    selectedBadgeClass: BADGE_OPTIONS[0].className,
    selectedBadgeFallbackText: BADGE_OPTIONS[0].previewText,
    badgeText: BADGE_OPTIONS[0].previewText,
  },

  onLoad() {
    this.bootstrap();
  },

  handleAuthError(err) {
    if (err.statusCode === 401 || err.message === "missing_token") {
      wx.removeStorageSync("token");
      wx.removeStorageSync("user");
      wx.reLaunch({ url: "/pages/login/login" });
      return true;
    }
    return false;
  },

  async bootstrap() {
    const token = wx.getStorageSync("token");
    if (!token) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }

    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });

      const userId = String(user?.id || "").trim();
      const nickname = user?.nickname ? String(user.nickname).trim() : "";
      const avatarUrl = user?.avatarUrl ? String(user.avatarUrl).trim() : "";
      const pref = getUserBadgePref(userId);
      const option = getBadgeOptionByKey(pref?.key);
      const badgeText = pref?.text || option.previewText;

      this.setData({
        userId,
        nickname,
        displayAvatarUrl: avatarUrl || DEFAULT_AVATAR,
        originalAvatarUrl: avatarUrl || "",
        pendingAvatarDataUrl: "",
        selectedBadgeKey: option.key,
        selectedBadgeIcon: option.icon,
        selectedBadgeClass: option.className,
        selectedBadgeFallbackText: option.previewText,
        badgeText,
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      wx.showToast({
        title: "Failed to load profile",
        icon: "none",
      });
    }
  },

  onInputNickname(e) {
    this.setData({
      nickname: e.detail.value || "",
    });
  },

  onSelectBadgeStyle(e) {
    const selectedKey = normalizeBadgeKey(e.currentTarget?.dataset?.key || "");
    const option = getBadgeOptionByKey(selectedKey);
    const currentText = String(this.data.badgeText || "").trim();
    this.setData({
      selectedBadgeKey: option.key,
      selectedBadgeIcon: option.icon,
      selectedBadgeClass: option.className,
      selectedBadgeFallbackText: option.previewText,
      badgeText: currentText || option.previewText,
    });
  },

  onInputBadgeText(e) {
    this.setData({
      badgeText: String(e.detail.value || "").slice(0, 24),
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
              wx.showToast({ title: "Avatar read failed", icon: "none" });
              return;
            }
            this.setData({
              displayAvatarUrl: tempPath,
              pendingAvatarDataUrl: `data:image/jpeg;base64,${base64}`,
            });
          },
          fail: () => {
            wx.showToast({ title: "Avatar read failed", icon: "none" });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: "Avatar process failed", icon: "none" });
      },
    });
  },

  async onSaveProfile() {
    if (this.data.isSaving) return;
    const nickname = String(this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({
        title: "Nickname is required",
        icon: "none",
      });
      return;
    }

    this.setData({ isSaving: true });
    try {
      const resp = await request({
        url: "/users/me/profile",
        method: "PUT",
        auth: true,
        data: {
          nickname,
          avatarUrl:
            String(this.data.pendingAvatarDataUrl || "").trim() ||
            String(this.data.originalAvatarUrl || "").trim() ||
            undefined,
        },
      });
      const user = resp?.user || {};
      if (user && typeof user === "object") {
        wx.setStorageSync("user", user);
      }
      const badgeText =
        String(this.data.badgeText || "").trim() || this.data.selectedBadgeFallbackText;
      saveUserBadgePref(user.id || this.data.userId, {
        key: this.data.selectedBadgeKey,
        text: badgeText,
      });

      wx.showToast({
        title: "Saved",
        icon: "success",
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 250);
    } catch (err) {
      if (this.handleAuthError(err)) return;
      wx.showToast({
        title: err?.response?.message || "Save failed",
        icon: "none",
      });
    } finally {
      this.setData({ isSaving: false });
    }
  },
});
