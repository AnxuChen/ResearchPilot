const app = getApp();
const { request } = require("../utils/request");
const { getCurrentLanguage } = require("../utils/language");

function normalizePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function parseAuthError(err) {
  if (!err) return false;
  if (err.message === "missing_token") return true;
  return err.statusCode === 401;
}

function buildTabs(language) {
  const isZh = language === "zh";
  return {
    leftTabs: [
      {
        pagePath: "/pages/lab/index",
        text: isZh ? "实验室" : "LAB",
        iconPath: "/images/tabbar/lab.png",
        selectedIconPath: "/images/tabbar/lab_sel.png",
      },
      {
        pagePath: "/pages/projects/index",
        text: isZh ? "项目" : "PROJECTS",
        iconPath: "/images/tabbar/project.png",
        selectedIconPath: "/images/tabbar/project_sel.png",
      },
    ],
    rightTabs: [
      {
        pagePath: "/pages/explore/index",
        text: isZh ? "文献库" : "LIBRARY",
        iconPath: "/images/tabbar/explore.png",
        selectedIconPath: "/images/tabbar/explore_sel.png",
      },
      {
        pagePath: "/pages/profile/index",
        text: isZh ? "我的" : "PROFILE",
        iconPath: "/images/tabbar/profile.png",
        selectedIconPath: "/images/tabbar/profile_sel.png",
      },
    ],
  };
}

Component({
  data: {
    selectedPath: "/pages/lab/index",
    language: "en",
    showSearchModal: false,
    searchKeyword: "",
    searchLoading: false,
    ...buildTabs("en"),
  },

  lifetimes: {
    attached() {
      this.syncLanguage();
      this.syncSelectedPath();
    },
  },

  pageLifetimes: {
    show() {
      this.syncLanguage();
      this.syncSelectedPath();
    },
  },

  methods: {
    syncLanguage() {
      const language = getCurrentLanguage();
      this.setData({
        language,
        ...buildTabs(language),
      });
    },

    syncSelectedPath() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = current && current.route ? normalizePath(current.route) : "";
      this.setData({ selectedPath: route });
    },

    onTapTab(e) {
      const pagePath = normalizePath(e.currentTarget?.dataset?.path || "");
      if (!pagePath) return;
      if (pagePath === this.data.selectedPath) return;
      this.setData({ selectedPath: pagePath });
      wx.switchTab({ url: pagePath });
    },
    openSearchModal() {
      this.setData({ showSearchModal: true });
    },

    closeSearchModal() {
      if (this.data.searchLoading) return;
      this.setData({ showSearchModal: false });
    },

    preventClose() {
      // prevent event bubbling
    },

    async onSearchTap() {
      if (this.data.searchLoading) return;
      const keyword = String(this.data.searchKeyword || "").trim();
      let prefetchedResponse = null;
      let shouldRelogin = false;

      this.setData({ searchLoading: true });
      try {
        prefetchedResponse = await request({
          url: "/papers/feed",
          method: "GET",
          data: {
            page: 1,
            pageSize: 12,
            keywords: keyword || undefined,
          },
          auth: true,
          timeout: 15000,
        });
      } catch (err) {
        shouldRelogin = parseAuthError(err);
        if (!shouldRelogin) {
          wx.showToast({
            title:
              this.data.language === "zh"
                ? "预加载失败，已切换到文献库"
                : "Prefetch failed, switched to Library",
            icon: "none",
          });
        }
      } finally {
        this.setData({ searchLoading: false });
      }

      if (shouldRelogin) {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        this.setData({ showSearchModal: false });
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }

      app.globalData.exploreKeywords = keyword;
      app.globalData.exploreSearchPrefetch = {
        keywords: keyword,
        response: prefetchedResponse,
        fetchedAt: Date.now(),
      };

      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const currentPath = normalizePath(current?.route || "");

      this.setData({
        showSearchModal: false,
        selectedPath: "/pages/explore/index",
      });

      if (currentPath === "/pages/explore/index") {
        if (typeof current?.consumePrefetchedSearch === "function") {
          current.consumePrefetchedSearch();
        }
        return;
      }

      wx.switchTab({ url: "/pages/explore/index" });
    },

    onSearchConfirm(e) {
      this.setData({
        searchKeyword: e.detail.value || "",
      });
      this.onSearchTap();
    },

    onInputChange(e) {
      this.setData({
        searchKeyword: e.detail.value || "",
      });
    },
  },
});
