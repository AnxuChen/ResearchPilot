const { request } = require("../../utils/request");

const DEFAULT_AVATAR = "/images/profile/user.png";
const BADGE_PREF_STORAGE_KEY = "profile_badge_preferences_v1";
const PROFILE_PREF_STORAGE_KEY = "profile_local_preferences_v1";
const { getCurrentLanguage, setCurrentLanguage } = require("../../utils/language");
const LANGUAGE_OPTIONS = [
  { value: "en", labelEn: "English", labelZh: "英文" },
  { value: "zh", labelEn: "Chinese", labelZh: "中文" },
];
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

function getProfilePrefsMap() {
  const raw = wx.getStorageSync(PROFILE_PREF_STORAGE_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function getUserProfilePref(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const map = getProfilePrefsMap();
  const pref = map[id];
  if (!pref || typeof pref !== "object") return null;
  return {
    nickname: String(pref.nickname || "").trim().slice(0, 40),
  };
}

function saveUserProfilePref(userId, payload) {
  const id = String(userId || "").trim();
  if (!id) return;
  const map = getProfilePrefsMap();
  map[id] = {
    nickname: String(payload?.nickname || "").trim().slice(0, 40),
  };
  wx.setStorageSync(PROFILE_PREF_STORAGE_KEY, map);
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
    languageOptions: LANGUAGE_OPTIONS,
    selectedLanguage: "en",
  },

  onLoad() {
    this.syncLanguage();
    this.hydrateFromLocalCache();
    this.bootstrap();
  },

  onShow() {
    this.syncLanguage();
  },

  syncLanguage() {
    const selectedLanguage = getCurrentLanguage();
    wx.setNavigationBarTitle({
      title: selectedLanguage === "zh" ? "个人设置" : "Profile Settings",
    });
    this.setData({
      selectedLanguage,
    });
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

  resolveUserId() {
    const currentId = String(this.data.userId || "").trim();
    if (currentId) return currentId;
    const cachedUser = wx.getStorageSync("user") || {};
    const cachedId = String(cachedUser.id || "").trim();
    if (cachedId) {
      this.setData({ userId: cachedId });
    }
    return cachedId;
  },

  hydrateFromLocalCache() {
    const cachedUser = wx.getStorageSync("user") || {};
    const userId = String(cachedUser.id || "").trim();
    const cachedNickname =
      typeof cachedUser.nickname === "string" ? cachedUser.nickname.trim() : "";
    const cachedAvatar = typeof cachedUser.avatarUrl === "string" ? cachedUser.avatarUrl.trim() : "";
    const cachedBadgeKey =
      typeof cachedUser.badgeKey === "string" ? cachedUser.badgeKey.trim() : "";
    const cachedBadgeText =
      typeof cachedUser.badgeText === "string" ? cachedUser.badgeText.trim() : "";
    const localProfilePref = getUserProfilePref(userId);
    const localBadgePref = getUserBadgePref(userId);
    const badgeOption = getBadgeOptionByKey(localBadgePref?.key || cachedBadgeKey);
    const badgeText = localBadgePref?.text || cachedBadgeText || badgeOption.previewText;
    const nickname = localProfilePref?.nickname || cachedNickname;

    this.setData({
      userId: userId || this.data.userId,
      nickname: nickname || this.data.nickname,
      displayAvatarUrl: cachedAvatar || this.data.displayAvatarUrl || DEFAULT_AVATAR,
      originalAvatarUrl: cachedAvatar || this.data.originalAvatarUrl || "",
      selectedBadgeKey: badgeOption.key,
      selectedBadgeIcon: badgeOption.icon,
      selectedBadgeClass: badgeOption.className,
      selectedBadgeFallbackText: badgeOption.previewText,
      badgeText: badgeText || this.data.badgeText,
    });
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
      const serverNickname = user?.nickname ? String(user.nickname).trim() : "";
      const avatarUrl = user?.avatarUrl ? String(user.avatarUrl).trim() : "";
      const serverBadgeKey = user?.badgeKey ? String(user.badgeKey).trim() : "";
      const serverBadgeText = user?.badgeText ? String(user.badgeText).trim().slice(0, 24) : "";
      const serverPreferredLanguage =
        user?.preferredLanguage === "zh" || user?.preferredLanguage === "en"
          ? user.preferredLanguage
          : "";
      const localProfilePref = getUserProfilePref(userId);
      const nickname = serverNickname || localProfilePref?.nickname || "";
      const pref = getUserBadgePref(userId);
      const option = getBadgeOptionByKey(serverBadgeKey || pref?.key);
      const badgeText = serverBadgeText || pref?.text || option.previewText;
      const selectedLanguage = serverPreferredLanguage
        ? setCurrentLanguage(serverPreferredLanguage)
        : getCurrentLanguage();

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
        selectedLanguage,
      });
      if (userId) {
        saveUserProfilePref(userId, { nickname });
        saveUserBadgePref(userId, { key: option.key, text: badgeText });
      }
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.hydrateFromLocalCache();
      wx.showToast({
        title: this.data.selectedLanguage === "zh" ? "读取资料失败" : "Failed to load profile",
        icon: "none",
      });
    }
  },

  onSelectLanguage(e) {
    const language = setCurrentLanguage(e.currentTarget?.dataset?.value || "");
    if (language === this.data.selectedLanguage) return;
    this.setData({ selectedLanguage: language });
    this.syncLanguage();
    this.persistPreferredLanguage(language);
    wx.showToast({
      title: language === "zh" ? "已切换为中文" : "Language switched to English",
      icon: "none",
    });
  },

  async persistPreferredLanguage(language) {
    const userId = this.resolveUserId();
    if (!userId) return;
    try {
      const resp = await request({
        url: "/users/me/profile",
        method: "PUT",
        auth: true,
        data: {
          preferredLanguage: language,
        },
      });
      const serverUser = resp?.user && typeof resp.user === "object" ? resp.user : {};
      const cachedUser = wx.getStorageSync("user") || {};
      wx.setStorageSync("user", {
        ...cachedUser,
        ...serverUser,
        preferredLanguage: language,
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      console.warn("Failed to persist preferred language", err);
    }
  },

  onInputNickname(e) {
    const nickname = String(e.detail.value || "");
    this.setData({
      nickname,
    });
    const userId = this.resolveUserId();
    if (userId) {
      saveUserProfilePref(userId, { nickname });
    }
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
    const userId = this.resolveUserId();
    if (userId) {
      saveUserBadgePref(userId, {
        key: option.key,
        text: currentText || option.previewText,
      });
    }
  },

  onInputBadgeText(e) {
    const badgeText = String(e.detail.value || "").slice(0, 24);
    this.setData({
      badgeText,
    });
    const userId = this.resolveUserId();
    if (userId) {
      saveUserBadgePref(userId, {
        key: this.data.selectedBadgeKey,
        text: badgeText,
      });
    }
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
              wx.showToast({
                title: this.data.selectedLanguage === "zh" ? "头像读取失败" : "Avatar read failed",
                icon: "none",
              });
              return;
            }
            this.setData({
              displayAvatarUrl: tempPath,
              pendingAvatarDataUrl: `data:image/jpeg;base64,${base64}`,
            });
          },
          fail: () => {
            wx.showToast({
              title: this.data.selectedLanguage === "zh" ? "头像读取失败" : "Avatar read failed",
              icon: "none",
            });
          },
        });
      },
      fail: () => {
        wx.showToast({
          title: this.data.selectedLanguage === "zh" ? "头像处理失败" : "Avatar process failed",
          icon: "none",
        });
      },
    });
  },

  async onSaveProfile() {
    if (this.data.isSaving) return;
    const nickname = String(this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({
        title: this.data.selectedLanguage === "zh" ? "请输入昵称" : "Nickname is required",
        icon: "none",
      });
      return;
    }

    this.setData({ isSaving: true });
    try {
      const userId = this.resolveUserId();
      if (userId) {
        saveUserProfilePref(userId, { nickname });
      }
      const resp = await request({
        url: "/users/me/profile",
        method: "PUT",
        auth: true,
        data: {
          nickname,
          fullName: nickname,
          badgeKey: this.data.selectedBadgeKey,
          badgeText:
            String(this.data.badgeText || "").trim() || this.data.selectedBadgeFallbackText,
          preferredLanguage: this.data.selectedLanguage,
          avatarUrl:
            String(this.data.pendingAvatarDataUrl || "").trim() ||
            String(this.data.originalAvatarUrl || "").trim() ||
            undefined,
        },
      });
      const serverUser = resp?.user && typeof resp.user === "object" ? resp.user : {};
      const cachedUser = wx.getStorageSync("user") || {};
      const resolvedUser = {
        ...cachedUser,
        ...serverUser,
        id: serverUser.id || userId || cachedUser.id,
        nickname,
        fullName: nickname,
        badgeKey:
          serverUser.badgeKey ||
          this.data.selectedBadgeKey ||
          cachedUser.badgeKey ||
          null,
        badgeText:
          serverUser.badgeText ||
          String(this.data.badgeText || "").trim() ||
          this.data.selectedBadgeFallbackText ||
          cachedUser.badgeText ||
          null,
        preferredLanguage:
          serverUser.preferredLanguage || this.data.selectedLanguage || cachedUser.preferredLanguage || null,
        avatarUrl:
          String(this.data.pendingAvatarDataUrl || "").trim() ||
          String(this.data.originalAvatarUrl || "").trim() ||
          serverUser.avatarUrl ||
          cachedUser.avatarUrl ||
          "",
      };
      wx.setStorageSync("user", resolvedUser);
      const badgeText =
        String(this.data.badgeText || "").trim() || this.data.selectedBadgeFallbackText;
      saveUserBadgePref(resolvedUser.id || userId, {
        key: this.data.selectedBadgeKey,
        text: badgeText,
      });

      wx.showToast({
        title: this.data.selectedLanguage === "zh" ? "已保存" : "Saved",
        icon: "success",
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 250);
    } catch (err) {
      if (this.handleAuthError(err)) return;
      wx.showToast({
        title:
          err?.response?.message ||
          (this.data.selectedLanguage === "zh" ? "保存失败" : "Save failed"),
        icon: "none",
      });
    } finally {
      this.setData({ isSaving: false });
    }
  },
});
