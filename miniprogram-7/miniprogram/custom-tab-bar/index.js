Component({
  data: {
    selectedPath: "",
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
      const route = current && current.route ? `/${current.route}` : "";
      this.setData({ selectedPath: route });
    },

    onTapTab(e) {
      const pagePath = String(e.currentTarget?.dataset?.path || "");
      if (!pagePath) return;
      if (pagePath === this.data.selectedPath) return;
      wx.switchTab({ url: pagePath });
    },

    onTapCenter() {
      const quickActions = [
        {
          label: "Rebuttal Simulator",
          url: "/pages/review_simulator/index",
        },
        {
          label: "Academic Polisher",
          url: "/pages/AcademicPls/index",
        },
        {
          label: "Create Data Viz",
          url: "/pages/DataViz/index",
        },
        {
          label: "Citations",
          url: "/pages/Citations/index",
        },
      ];

      wx.showActionSheet({
        itemList: quickActions.map((item) => item.label),
        success: (res) => {
          const target = quickActions[res.tapIndex];
          if (!target?.url) return;
          wx.navigateTo({ url: target.url });
        },
      });
    },
  },
});
