// app.js
const runtimeConfig = require("./config/runtime");

App({
  onLaunch: function () {
    const cloudbaseConfig = runtimeConfig.cloudbase || {};
    const cloudEnv = cloudbaseConfig.env || "";
    const savedLanguage = wx.getStorageSync("app_language");
    const language = savedLanguage === "zh" ? "zh" : "en";

    this.globalData = {
      // direct-http | cloudbase-anyservice
      apiMode: runtimeConfig.apiMode || "direct-http",
      apiBaseUrl: runtimeConfig.apiBaseUrl || "",
      cloudbase: cloudbaseConfig,
      // Keep for compatibility with template pages
      env: cloudEnv,
      language,
      user: null,
    };

    if (!wx.cloud) {
      console.error("Please use base library 2.2.3 or above to enable cloud features.");
    } else {
      wx.cloud.init({
        env: cloudEnv || undefined,
        traceUser: true,
      });
    }
  },
});
