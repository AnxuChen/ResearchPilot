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

// pages/lab/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    user: null,
    recentReadings: [],
    recentReadingLoading: false,
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
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
      console.error("获取用户信息失败", err);
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
      console.error("获取最近阅读失败", err);
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

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})
