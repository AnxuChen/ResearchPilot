function normalizePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

Component({
  data: {
    selectedPath: "/pages/lab/index",
    showSearchModal: false,
    searchKeyword: "",
    leftTabs: [
      {
        pagePath: "/pages/lab/index",
        text: "LAB",
        iconPath: "/images/tabbar/lab.png",
        selectedIconPath: "/images/tabbar/lab_sel.png",
      },
      {
        pagePath: "/pages/projects/index",
        text: "DDLS",
        iconPath: "/images/tabbar/project.png",
        selectedIconPath: "/images/tabbar/project_sel.png",
      },
    ],
    rightTabs: [
      {
        pagePath: "/pages/explore/index",
        text: "Explore",
        iconPath: "/images/tabbar/explore.png",
        selectedIconPath: "/images/tabbar/explore_sel.png",
      },
      {
        pagePath: "/pages/profile/index",
        text: "PROFILE",
        iconPath: "/images/tabbar/profile.png",
        selectedIconPath: "/images/tabbar/profile_sel.png",
      },
    ],
  },

  lifetimes: {
    attached() {
      this.syncSelectedPath();
    },
  },

  pageLifetimes: {
    show() {
      this.syncSelectedPath();
    },
  },

  methods: {
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
        this.setData({ showSearchModal: false });
      },
      
      preventClose() {
        // 阻止冒泡
      },
      
      onSearchTap() {
        const keyword = this.data.searchKeyword || "";
        this.closeSearchModal();
      
        wx.navigateTo({
          url: `/pages/explore/index?keyword=${keyword}`
        });
      },
      
      onSearchConfirm(e) {
        this.setData({
          searchKeyword: e.detail.value
        });
        this.onSearchTap();
      },

      onInputChange(e) {
        this.setData({
          searchKeyword: e.detail.value
        });
      },
  },
});
