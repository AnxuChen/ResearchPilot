const app = getApp();
const { request } = require("../../utils/request");
const { getCurrentLanguage } = require("../../utils/language");

function splitColumns(papers) {
  const left = [];
  const right = [];
  papers.forEach((paper, index) => {
    if (index % 2 === 0) {
      left.push(paper);
      return;
    }
    right.push(paper);
  });
  return { left, right };
}

function normalizePaper(item, language) {
  const isZh = language === "zh";
  const authors = Array.isArray(item.authors) ? item.authors : [];
  const shortAbstract = (item.abstract || "").trim().slice(0, 120);
  return {
    id: item.id,
    title: item.title || (isZh ? "未命名论文" : "Untitled Paper"),
    abstractShort: shortAbstract || (isZh ? "暂无摘要。" : "No abstract available."),
    authorsText: authors.slice(0, 3).join(", ") || (isZh ? "未知作者" : "Unknown authors"),
    yearText: item.year ? `${item.year}` : isZh ? "最新" : "Latest",
    citationText: isZh ? `引用 ${item.citationCount || 0}` : `Citations ${item.citationCount || 0}`,
    source: item.source || "semantic_scholar",
    likedByMe: Boolean(item.likedByMe),
  };
}

function parseDatasetBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0" || normalized === "") return false;
  return Boolean(value);
}

function parseExplorePrefetch(value) {
  if (!value || typeof value !== "object") return null;
  return {
    keywords: String(value.keywords || "").trim(),
    response:
      value.response && typeof value.response === "object" ? value.response : null,
  };
}

Page({
  data: {
    language: "en",
    keywords: "",
    appliedKeywords: "",
    papers: [],
    leftPapers: [],
    rightPapers: [],
    isLoading: false,
    errorMsg: "",
    source: "",
    likeSubmittingId: "",
  },

  onLoad() {
    this.syncLanguage();
    if (this.consumePrefetchedSearch()) {
      return;
    }
    const keywords = app.globalData.exploreKeywords || "";
    this.setData({ keywords });
    this.fetchPapers(keywords);
  },

  onShow() {
    this.syncLanguage();
    this.syncTabBarSelection();
    this.consumePrefetchedSearch();
  },

  syncLanguage() {
    const prevLanguage = this.data.language;
    const language = getCurrentLanguage();
    this.setData({ language });
    if (prevLanguage && prevLanguage !== language && this.data.papers.length && !this.data.isLoading) {
      this.fetchPapers(this.data.keywords || this.data.appliedKeywords || "");
    }
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (!tabBar || !tabBar.setData) return;
    tabBar.setData({
      selectedPath: "/pages/explore/index",
    });
  },

  onPullDownRefresh() {
    this.fetchPapers(this.data.keywords, { stopPullDown: true });
  },

  onKeywordInput(e) {
    this.setData({ keywords: e.detail.value || "" });
  },

  onSearchTap() {
    if (this.data.isLoading) return;
    this.fetchPapers(this.data.keywords);
  },

  consumePrefetchedSearch() {
    const pending = parseExplorePrefetch(app.globalData.exploreSearchPrefetch);
    if (!pending) return false;
    app.globalData.exploreSearchPrefetch = null;

    this.setData({
      keywords: pending.keywords,
    });
    if (pending.response) {
      this.applyFeedResponse(pending.response, pending.keywords);
      return true;
    }

    this.fetchPapers(pending.keywords);
    return true;
  },

  applyFeedResponse(resp, rawKeywords) {
    const keywords = String(rawKeywords || "").trim();
    const papers = (resp.items || []).map((item) => normalizePaper(item, this.data.language));
    const columns = splitColumns(papers);
    const appliedKeywords =
      (resp.meta && resp.meta.appliedKeywords) || keywords || "";

    app.globalData.exploreKeywords = keywords;
    this.setData({
      keywords,
      appliedKeywords,
      papers,
      leftPapers: columns.left,
      rightPapers: columns.right,
      source: (resp.meta && resp.meta.source) || "",
      errorMsg: "",
    });
  },

  async fetchPapers(rawKeywords, options = {}) {
    if (this.data.isLoading) return;
    const keywords = (rawKeywords || "").trim();
    const query = [
      "page=1",
      "pageSize=12",
      keywords ? `keywords=${encodeURIComponent(keywords)}` : "",
    ]
      .filter(Boolean)
      .join("&");

    this.setData({ isLoading: true, errorMsg: "" });
    try {
      const resp = await request({
        url: `/papers/feed?${query}`,
        method: "GET",
        auth: true,
      });
      this.applyFeedResponse(resp, keywords);
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      this.setData({
        errorMsg:
          this.data.language === "zh"
            ? "获取论文失败，请稍后重试"
            : "Failed to fetch papers, please retry",
        source: "",
      });
    } finally {
      this.setData({ isLoading: false });
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  onSwitchToCard() {
    const keywords = encodeURIComponent((this.data.keywords || "").trim());
    wx.navigateTo({
      url: `/pages/explore_Card/index?keywords=${keywords}`,
      fail: (err) => {
        console.error("Navigation failed:", err);
      },
    });
  },

  onPaperTap(e) {
    const paperId = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    if (!paperId) return;
    wx.navigateTo({
      url: `/pages/paper/detail?id=${encodeURIComponent(paperId)}`,
      fail: (err) => {
        console.error("Failed to open paper detail:", err);
      },
    });
  },

  updatePaperLikeState(paperId, likedByMe) {
    const papers = (this.data.papers || []).map((item) => {
      if (item.id !== paperId) return item;
      return {
        ...item,
        likedByMe: Boolean(likedByMe),
      };
    });
    const columns = splitColumns(papers);
    this.setData({
      papers,
      leftPapers: columns.left,
      rightPapers: columns.right,
    });
  },

  async onTogglePaperLike(e) {
    const paperId = String(e.currentTarget?.dataset?.id || "").trim();
    const likedByMe = parseDatasetBoolean(e.currentTarget?.dataset?.liked);
    if (!paperId || this.data.likeSubmittingId === paperId) return;

    this.setData({ likeSubmittingId: paperId });
    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/like`,
        method: "POST",
        data: {
          liked: !likedByMe,
        },
        auth: true,
      });
      this.updatePaperLikeState(paperId, Boolean(resp.liked));
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({
        title: this.data.language === "zh" ? "点赞失败，请重试" : "Like failed, please retry",
        icon: "none",
      });
    } finally {
      this.setData({ likeSubmittingId: "" });
    }
  },
});
