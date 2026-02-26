// pages/profile/index.js
const { request } = require("../../utils/request");
const { getCurrentLanguage } = require("../../utils/language");
const COLLECTED_ICON_CLASSES = ["bg-indigo-gradient", "bg-teal-gradient", "bg-pink-gradient"];
const BADGE_PREF_STORAGE_KEY = "profile_badge_preferences_v1";
const PROFILE_PREF_STORAGE_KEY = "profile_local_preferences_v1";
const DEFAULT_BADGE = {
  key: "night_owl",
  text: "Night Owl",
  icon: "🌙",
  className: "badge-style-night-owl",
};
const BADGE_META_MAP = {
  night_owl: { icon: "🌙", className: "badge-style-night-owl", fallbackText: "Night Owl" },
  sunrise_scholar: {
    icon: "🌅",
    className: "badge-style-sunrise-scholar",
    fallbackText: "Sunrise Scholar",
  },
  deep_focus: { icon: "🧠", className: "badge-style-deep-focus", fallbackText: "Deep Focus" },
  citation_ninja: {
    icon: "📚",
    className: "badge-style-citation-ninja",
    fallbackText: "Citation Ninja",
  },
  data_wizard: { icon: "📊", className: "badge-style-data-wizard", fallbackText: "Data Wizard" },
  peer_reviewer: {
    icon: "🧪",
    className: "badge-style-peer-reviewer",
    fallbackText: "Peer Reviewer",
  },
};

function buildDisplayName(user) {
  const nickname = (user && user.nickname ? String(user.nickname).trim() : "") || "";
  if (nickname) return nickname;
  const email = (user && user.email ? String(user.email).trim() : "") || "";
  if (email && email.includes("@")) return email.split("@")[0];
  return "User";
}

function buildBio(user, language) {
  const fieldOfStudy =
    (user && user.fieldOfStudy ? String(user.fieldOfStudy).trim() : "") || "";
  if (fieldOfStudy) return fieldOfStudy;
  return language === "zh" ? "设计驱动的学术探索者" : "Design-minded academic explorer";
}

function normalizeCollectedPaper(item, index) {
  const title = String(item?.title || "").trim() || "Untitled Paper";
  const abstract = String(item?.abstract || "").trim();
  const description = abstract
    ? abstract.slice(0, 120)
    : "No abstract available.";
  const tags = Array.isArray(item?.tags)
    ? item.tags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const publishedDate = item?.publishedAt ? new Date(item.publishedAt) : null;
  const year =
    publishedDate && !Number.isNaN(publishedDate.getTime())
      ? `${publishedDate.getFullYear()}`
      : "";
  const displayTags = tags.length ? tags : year ? [year] : ["PAPER"];

  return {
    id: String(item?.id || ""),
    title,
    description,
    tags: displayTags,
    iconClass: COLLECTED_ICON_CLASSES[index % COLLECTED_ICON_CLASSES.length],
    iconText: "PDF",
  };
}

function getBadgePrefsMap() {
  const raw = wx.getStorageSync(BADGE_PREF_STORAGE_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function getUserBadgePreference(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const prefs = getBadgePrefsMap();
  const value = prefs[id];
  if (!value || typeof value !== "object") return null;
  const key = String(value.key || "").trim();
  const text = String(value.text || "").trim();
  if (!key && !text) return null;
  return { key, text };
}

function resolveBadgeDisplay(userId) {
  const pref = getUserBadgePreference(userId);
  const key = pref?.key && BADGE_META_MAP[pref.key] ? pref.key : DEFAULT_BADGE.key;
  const meta = BADGE_META_MAP[key] || BADGE_META_MAP[DEFAULT_BADGE.key];
  const text =
    pref?.text && String(pref.text).trim()
      ? String(pref.text).trim().slice(0, 24)
      : meta.fallbackText || DEFAULT_BADGE.text;
  return {
    badgeKey: key,
    badgeText: text,
    badgeIcon: meta.icon,
    badgeClassName: meta.className,
  };
}

function getProfilePrefsMap() {
  const raw = wx.getStorageSync(PROFILE_PREF_STORAGE_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function getUserProfilePreference(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const prefs = getProfilePrefsMap();
  const value = prefs[id];
  if (!value || typeof value !== "object") return null;
  const nickname = String(value.nickname || "").trim().slice(0, 40);
  if (!nickname) return null;
  return { nickname };
}

function mergeUserWithLocalPreference(user) {
  const userObj = user && typeof user === "object" ? user : {};
  const pref = getUserProfilePreference(userObj.id);
  if (!pref) return userObj;
  return {
    ...userObj,
    nickname: pref.nickname,
  };
}

Page({
  data: {
    language: "en",
    userName: "User",
    userBio: "Design-minded academic explorer",
    avatarUrl: "/images/profile/user.png",
    badgeKey: DEFAULT_BADGE.key,
    badgeText: DEFAULT_BADGE.text,
    badgeIcon: DEFAULT_BADGE.icon,
    badgeClassName: DEFAULT_BADGE.className,
    collectedPapers: [],
    collectedLoading: false,
    collectedError: "",
  },

  onShow() {
    this.syncLanguage();
    this.syncTabBarSelection();
    this.syncProfile();
  },

  syncLanguage() {
    const language = getCurrentLanguage();
    this.setData({ language });
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (!tabBar || !tabBar.setData) return;
    tabBar.setData({
      selectedPath: "/pages/profile/index",
    });
  },

  onPullDownRefresh() {
    this.syncProfile({ stopPullDown: true });
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

  async syncProfile(options = {}) {
    try {
      await this.syncUserBasic();
      if (!wx.getStorageSync("token")) {
        return;
      }
      await this.syncCollectedPapers();
    } finally {
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  async syncUserBasic() {
    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });
      const resolvedUser = mergeUserWithLocalPreference(user);
      this.setData({
        userName: buildDisplayName(resolvedUser),
        userBio: buildBio(resolvedUser, this.data.language),
        avatarUrl: resolvedUser.avatarUrl || "/images/profile/user.png",
        ...resolveBadgeDisplay(resolvedUser.id),
      });
      wx.setStorageSync("user", resolvedUser || {});
    } catch (err) {
      if (this.handleAuthError(err)) {
        return;
      }

      const cachedUser = mergeUserWithLocalPreference(wx.getStorageSync("user") || {});
      this.setData({
        userName: buildDisplayName(cachedUser),
        userBio: buildBio(cachedUser, this.data.language),
        avatarUrl: cachedUser.avatarUrl || "/images/profile/user.png",
        ...resolveBadgeDisplay(cachedUser.id),
      });
    }
  },

  async syncCollectedPapers() {
    this.setData({
      collectedLoading: true,
      collectedError: "",
    });
    try {
      const resp = await request({
        url: "/users/me/liked-papers?page=1&pageSize=50",
        method: "GET",
        auth: true,
      });
      const items = Array.isArray(resp.items) ? resp.items : [];
      this.setData({
        collectedPapers: items
          .map((item, index) => normalizeCollectedPaper(item, index))
          .filter((item) => item.id),
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        collectedError:
          this.data.language === "zh"
            ? "加载收藏论文失败，请稍后重试"
            : "Failed to load collected papers, please retry",
      });
    } finally {
      this.setData({
        collectedLoading: false,
      });
    }
  },

  onCollectedPaperTap(e) {
    const paperId = String(e.currentTarget?.dataset?.id || "").trim();
    if (!paperId) return;
    wx.navigateTo({
      url: `/pages/paper/detail?id=${encodeURIComponent(paperId)}`,
      fail: (err) => {
        console.error("Failed to open paper detail", err);
      },
    });
  },

  onOpenSettings() {
    wx.navigateTo({
      url: "/pages/profile_settings/index",
    });
  },
});
