const { request } = require("../../utils/request");
const { getCurrentLanguage } = require("../../utils/language");

function formatDate(value, language) {
  const isZh = language === "zh";
  if (!value) return isZh ? "未知" : "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return isZh ? "未知" : "Unknown";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRelativeTime(value, language) {
  const isZh = language === "zh";
  if (!value) return isZh ? "未知" : "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return isZh ? "未知" : "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return isZh ? "刚刚" : "Just now";
  if (diffMs < 60 * 60 * 1000) {
    const mins = Math.floor(diffMs / (60 * 1000));
    return isZh ? `${mins}分钟前` : `${mins}m ago`;
  }
  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    return isZh ? `${hours}小时前` : `${hours}h ago`;
  }
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    return isZh ? `${days}天前` : `${days}d ago`;
  }
  return formatDate(value, language);
}

function buildInitial(name) {
  const normalized = String(name || "").trim();
  if (!normalized) return "US";
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
}

function normalizeComment(item, language) {
  const nickname = String(item?.user?.nickname || "").trim() || (language === "zh" ? "用户" : "User");
  return {
    id: item.id,
    name: nickname,
    timeText: formatRelativeTime(item.createdAt, language),
    content: item.content || "",
    initial: buildInitial(nickname),
    likeCount: Number(item.likeCount || 0),
    likedByMe: Boolean(item.likedByMe),
  };
}

Page({
  data: {
    language: "en",
    paperId: "",
    paper: null,
    isLoading: true,
    errorMsg: "",

    comments: [],
    commentsLoading: false,
    commentsError: "",
    commentSortBy: "time",
    newComment: "",
    isFavorite: false,
    isFavoriteSubmitting: false,
    isCommentSubmitting: false,
    hasMarkedRead: false,
    isAbstractFlipped: false,
    aiSummaryText: "",
    aiSummaryLoading: false,
    aiSummaryError: "",
    aiSummaryLanguage: "",
    aiSummaryFallback: false,
  },

  onLoad(options) {
    this.syncLanguage();
    const paperId = decodeURIComponent(options.id || "").trim();
    if (!paperId) {
      this.setData({
        isLoading: false,
        errorMsg:
          this.data.language === "zh"
            ? "缺少论文 ID，无法加载详情"
            : "Missing paper ID, unable to load details",
      });
      return;
    }
    this.setData({
      paperId,
      hasMarkedRead: false,
      isAbstractFlipped: false,
      aiSummaryText: "",
      aiSummaryLoading: false,
      aiSummaryError: "",
      aiSummaryLanguage: "",
      aiSummaryFallback: false,
    });
    this.reloadPageData();
  },

  onShow() {
    this.syncLanguage();
  },

  syncLanguage() {
    const language = getCurrentLanguage();
    this.setData({ language });
  },

  onPullDownRefresh() {
    this.reloadPageData({ stopPullDown: true });
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

  async reloadPageData(options = {}) {
    const paperId = this.data.paperId;
    if (!paperId) return;

    await Promise.all([
      this.fetchPaperDetail(paperId),
      this.fetchComments(),
    ]);

    if (options.stopPullDown) {
      wx.stopPullDownRefresh();
    }
  },

  async fetchPaperDetail(paperId) {
    this.setData({ isLoading: true, errorMsg: "" });
    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}`,
        method: "GET",
        auth: true,
      });

      const authors = Array.isArray(resp.authors) ? resp.authors : [];
      const tags = Array.isArray(resp.tags) ? resp.tags : [];
      const paper = {
        id: resp.id,
        title: resp.title || (this.data.language === "zh" ? "未命名论文" : "Untitled Paper"),
        abstract:
          resp.abstract || (this.data.language === "zh" ? "暂无摘要。" : "No abstract available."),
        authors,
        authorsText:
          authors.join(", ") || (this.data.language === "zh" ? "未知作者" : "Unknown authors"),
        tags,
        publishedText: formatDate(resp.publishedAt, this.data.language),
        venue: resp.venue || "",
        year: resp.year || "",
        citationCount: resp.citationCount || 0,
        link: resp.link || "",
      };
      this.setData({
        paper,
        isFavorite: Boolean(resp.likedByMe),
      });

      if (!this.data.hasMarkedRead) {
        this.setData({ hasMarkedRead: true });
        this.markPaperAsRead(paperId);
      }
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        errorMsg:
          this.data.language === "zh"
            ? "获取论文详情失败，请稍后重试"
            : "Failed to load paper details, please retry",
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async fetchComments() {
    const paperId = this.data.paperId;
    if (!paperId) return;

    this.setData({
      commentsLoading: true,
      commentsError: "",
    });

    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/comments?sortBy=${encodeURIComponent(
          this.data.commentSortBy
        )}&order=desc&page=1&pageSize=50`,
        method: "GET",
        auth: true,
      });
      const comments = Array.isArray(resp.items)
        ? resp.items.map((item) => normalizeComment(item, this.data.language))
        : [];
      this.setData({ comments });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        commentsError:
          this.data.language === "zh"
            ? "加载评论失败，请稍后重试"
            : "Failed to load comments, please retry",
      });
    } finally {
      this.setData({
        commentsLoading: false,
      });
    }
  },

  onInputComment(e) {
    this.setData({
      newComment: e.detail.value,
    });
  },

  async onSendComment() {
    const paperId = this.data.paperId;
    const content = String(this.data.newComment || "").trim();
    if (!paperId || !content || this.data.isCommentSubmitting) return;

    this.setData({ isCommentSubmitting: true });
    try {
      await request({
        url: `/papers/${encodeURIComponent(paperId)}/comments`,
        method: "POST",
        data: { content },
        auth: true,
      });

      this.setData({ newComment: "" });
      await this.fetchComments();
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: this.data.language === "zh" ? "评论发送失败" : "Failed to post comment",
          icon: "none",
        });
      }
    } finally {
      this.setData({ isCommentSubmitting: false });
    }
  },

  async onToggleCommentLike(e) {
    const paperId = this.data.paperId;
    const commentId = e.currentTarget?.dataset?.id;
    if (!paperId || !commentId) return;

    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/comments/${encodeURIComponent(
          commentId
        )}/like`,
        method: "POST",
        auth: true,
      });
      const comments = (this.data.comments || []).map((item) => {
        if (item.id !== commentId) return item;
        return {
          ...item,
          likedByMe: Boolean(resp.liked),
          likeCount: Number(resp.likeCount || 0),
        };
      });
      this.setData({ comments });
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: this.data.language === "zh" ? "操作失败" : "Action failed",
          icon: "none",
        });
      }
    }
  },

  onChangeCommentSort(e) {
    const sortBy = String(e.currentTarget?.dataset?.sort || "").trim();
    if (!sortBy || sortBy === this.data.commentSortBy) return;
    if (sortBy !== "time" && sortBy !== "likes") return;
    this.setData({ commentSortBy: sortBy });
    this.fetchComments();
  },

  async onToggleFavorite() {
    const paperId = this.data.paperId;
    if (!paperId || this.data.isFavoriteSubmitting) return;

    const targetLiked = !this.data.isFavorite;
    this.setData({ isFavoriteSubmitting: true });
    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/like`,
        method: "POST",
        data: {
          liked: targetLiked,
        },
        auth: true,
      });
      this.setData({
        isFavorite: Boolean(resp.liked),
      });
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: this.data.language === "zh" ? "收藏操作失败" : "Favorite update failed",
          icon: "none",
        });
      }
    } finally {
      this.setData({ isFavoriteSubmitting: false });
    }
  },

  async markPaperAsRead(paperId) {
    if (!paperId) return;
    try {
      await request({
        url: `/papers/${encodeURIComponent(paperId)}/action`,
        method: "POST",
        auth: true,
        data: {
          action: "READ",
        },
      });
    } catch (err) {
      this.handleAuthError(err);
    }
  },

  async fetchAiReadingSummary({ force = false } = {}) {
    const paperId = this.data.paperId;
    const language = this.data.language || "en";
    if (!paperId || this.data.aiSummaryLoading) return;

    const hasCurrentSummary =
      Boolean(this.data.aiSummaryText) && this.data.aiSummaryLanguage === language;
    if (!force && hasCurrentSummary) return;

    this.setData({
      aiSummaryLoading: true,
      aiSummaryError: "",
      aiSummaryFallback: false,
    });

    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/ai-reading`,
        method: "POST",
        auth: true,
        timeout: 45000,
        data: {
          language,
        },
      });
      const summaryText = String(resp?.summary || "").trim();
      if (!summaryText) {
        throw new Error("empty_ai_summary");
      }
      this.setData({
        aiSummaryText: summaryText,
        aiSummaryLanguage: language,
        aiSummaryFallback: Boolean(resp?.meta?.fallback),
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        aiSummaryError:
          this.data.language === "zh"
            ? "AI 阅读失败，请稍后重试"
            : "AI reading failed, please retry",
      });
    } finally {
      this.setData({
        aiSummaryLoading: false,
      });
    }
  },

  onTapAiReading() {
    if (!this.data.paper) return;
    if (!this.data.isAbstractFlipped) {
      this.setData({ isAbstractFlipped: true });
    }
    this.fetchAiReadingSummary();
  },

  onBackToAbstract() {
    this.setData({ isAbstractFlipped: false });
  },

  onRetryAiReading() {
    if (!this.data.isAbstractFlipped) {
      this.setData({ isAbstractFlipped: true });
    }
    this.fetchAiReadingSummary({ force: true });
  },

  onCopyLink() {
    const link = this.data.paper && this.data.paper.link ? this.data.paper.link : "";
    if (!link) {
      wx.showToast({
        title: this.data.language === "zh" ? "暂无可复制链接" : "No link to copy",
        icon: "none",
      });
      return;
    }
    wx.setClipboardData({
      data: link,
      success: () => {
        wx.showToast({
          title: this.data.language === "zh" ? "链接已复制" : "Link copied",
          icon: "success",
        });
      },
    });
  },

  onOpenLink() {
    const link = this.data.paper && this.data.paper.link ? this.data.paper.link : "";
    if (!link) {
      wx.showToast({
        title: this.data.language === "zh" ? "暂无可打开链接" : "No link available",
        icon: "none",
      });
      return;
    }
    wx.setClipboardData({
      data: link,
      success: () => {
        wx.showModal({
          title: this.data.language === "zh" ? "链接已复制" : "Link copied",
          content:
            this.data.language === "zh"
              ? "论文链接已复制，你可以在浏览器中打开。"
              : "Paper link copied. You can open it in your browser.",
          showCancel: false,
        });
      },
    });
  },
});
