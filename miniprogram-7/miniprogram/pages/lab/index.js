const app = getApp();
const { request } = require("../../utils/request");

function formatRelativeTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return "Just now";
  if (diffMs < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / (60 * 1000)))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)))}h ago`;
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)))}d ago`;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapRecentReadingItem(item) {
  return {
    id: item.id,
    title: String(item.title || "Untitled Paper").trim() || "Untitled Paper",
    readAtText: formatRelativeTime(item.readAt),
  };
}

Page({
  data: {
    user: null,
    recentReadings: [],
    recentReadingLoading: false,
  },

  onShow() {
    this.syncTabBarSelection();
    this.syncCurrentUser();
    this.fetchRecentReadings();
  },

  handleAuthError(err) {
    const code = err && err.statusCode;
    if (code === 401 || err.message === "missing_token") {
      wx.removeStorageSync("token");
      wx.removeStorageSync("user");
      app.globalData.user = null;
      wx.reLaunch({
        url: "/pages/login/login",
      });
      return true;
    }
    return false;
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (!tabBar || !tabBar.setData) return;
    tabBar.setData({
      selectedPath: "/pages/lab/index",
    });
  },

  async syncCurrentUser() {
    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });
      app.globalData.user = user;
      this.setData({ user });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      console.error("Failed to fetch user info", err);
    }
  },

  async fetchRecentReadings() {
    if (this.data.recentReadingLoading) return;
    this.setData({ recentReadingLoading: true });
    try {
      const resp = await request({
        url: "/lab/recent-reading",
        method: "GET",
        auth: true,
        timeout: 20000,
      });
      const items = Array.isArray(resp?.items)
        ? resp.items.slice(0, 2).map(mapRecentReadingItem)
        : [];
      this.setData({
        recentReadings: items,
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        recentReadings: [],
      });
      console.error("Failed to fetch recent reading", err);
    } finally {
      this.setData({ recentReadingLoading: false });
    }
  },

  onLaunchReviewSimulator() {
    wx.navigateTo({
      url: "/pages/review_simulator/index",
    });
  },

  onLaunchAcademicPls() {
    wx.navigateTo({
      url: "/pages/AcademicPls/index",
    });
  },
  
  onLaunchDataViz() {
    wx.navigateTo({
      url: "/pages/DataViz/index",
    });
  },
  
  onLaunchCitations() {
    wx.navigateTo({
      url: "/pages/Citations/index",
    });
  },

  onOpenRecentReading(e) {
    const paperId = String(e.currentTarget?.dataset?.id || "").trim();
    if (!paperId) return;
    wx.navigateTo({
      url: `/pages/paper/detail?id=${encodeURIComponent(paperId)}`,
    });
  },
});
