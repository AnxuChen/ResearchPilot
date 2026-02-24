const { request } = require("../../utils/request");

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ["csv", "json", "xls", "xlsx"];

function extFromFileName(fileName = "") {
  const safe = String(fileName || "").trim().toLowerCase();
  if (!safe.includes(".")) return "";
  return safe.split(".").pop() || "";
}

function basename(filePath = "") {
  const safe = String(filePath || "").trim();
  if (!safe) return "";
  const parts = safe.split("/");
  return parts[parts.length - 1] || "";
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function sanitizeFileName(fileName = "") {
  return String(fileName || "dataset")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}

function uploadFileToCloud({ filePath, fileName }) {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const cloudPath = `data-viz/${Date.now()}-${randomSuffix}-${sanitizeFileName(fileName)}`;

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res?.fileID || ""),
      fail: (err) => reject(err),
    });
  });
}

function getTempFileUrl(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const item = Array.isArray(res?.fileList) ? res.fileList[0] : null;
        if (!item?.tempFileURL) {
          reject(new Error("temp_url_missing"));
          return;
        }
        resolve(String(item.tempFileURL));
      },
      fail: (err) => reject(err),
    });
  });
}

function deleteCloudFile(fileID) {
  return new Promise((resolve) => {
    if (!fileID) {
      resolve();
      return;
    }
    wx.cloud.deleteFile({
      fileList: [fileID],
      complete: () => resolve(),
    });
  });
}

Page({
  data: {
    selectedFileName: "",
    selectedFileSizeText: "",
    selectedFilePath: "",
    selectedMimeType: "",
    selectedExtension: "",
    selectedChartType: "line",

    isGenerating: false,
    taskId: "",
    taskStatus: "",

    chartTitle: "",
    chartSummary: "",
    chartInsights: [],
    chartOptionText: "",
    chartProvider: "",

    errorMsg: "",
  },

  onUnload() {
    this.stopPolling();
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

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  schedulePoll(taskId) {
    this.stopPolling();
    this.pollTimer = setTimeout(() => {
      this.pollTask(taskId);
    }, 2200);
  },

  async pollTask(taskId) {
    try {
      const resp = await request({
        url: `/lab/data-viz/tasks/${taskId}`,
        method: "GET",
        auth: true,
        timeout: 20000,
      });
      const task = resp?.task || {};
      const status = String(task.status || "PENDING").toUpperCase();

      if (status === "DONE") {
        this.stopPolling();
        await deleteCloudFile(this.currentUploadedFileId || "");
        this.currentUploadedFileId = "";

        const result = task.result || {};
        const optionText = JSON.stringify(result.echartsOption || {}, null, 2);

        this.setData({
          isGenerating: false,
          taskId: "",
          taskStatus: "DONE",
          chartTitle: result.title || "Generated Chart",
          chartSummary: result.summary || "",
          chartInsights: Array.isArray(result.insights) ? result.insights : [],
          chartOptionText: optionText,
          chartProvider: result.provider || "llm",
          errorMsg: "",
        });
        return;
      }

      if (status === "FAILED") {
        this.stopPolling();
        await deleteCloudFile(this.currentUploadedFileId || "");
        this.currentUploadedFileId = "";

        this.setData({
          isGenerating: false,
          taskId: "",
          taskStatus: "FAILED",
          errorMsg: task.error || "图表生成失败",
        });
        wx.showToast({ title: task.error || "图表生成失败", icon: "none" });
        return;
      }

      this.setData({
        taskId,
        taskStatus: status,
      });
      this.schedulePoll(taskId);
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.pollErrorCount = (this.pollErrorCount || 0) + 1;
      if (this.pollErrorCount >= 5) {
        this.stopPolling();
        this.setData({
          isGenerating: false,
          taskId: "",
          taskStatus: "FAILED",
          errorMsg: "生成超时，请稍后重试",
        });
        return;
      }
      this.schedulePoll(taskId);
    }
  },

  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: SUPPORTED_EXTENSIONS,
      success: (res) => {
        const file = Array.isArray(res?.tempFiles) ? res.tempFiles[0] : null;
        if (!file?.path) {
          wx.showToast({ title: "未选择文件", icon: "none" });
          return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          wx.showToast({ title: "文件过大，请控制在50MB内", icon: "none" });
          return;
        }

        const fileName = String(file.name || basename(file.path) || "dataset");
        const extension = extFromFileName(fileName);
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
          wx.showToast({ title: "仅支持 CSV/JSON/XLS/XLSX", icon: "none" });
          return;
        }

        this.setData({
          selectedFileName: fileName,
          selectedFileSizeText: formatFileSize(file.size || 0),
          selectedFilePath: file.path,
          selectedMimeType: file.type || "",
          selectedExtension: extension,
          errorMsg: "",
          chartTitle: "",
          chartSummary: "",
          chartInsights: [],
          chartOptionText: "",
        });
      },
      fail: () => {
        wx.showToast({ title: "文件选择已取消", icon: "none" });
      },
    });
  },

  onSelectChartType(e) {
    const chartType = String(e.currentTarget?.dataset?.type || "line").trim().toLowerCase();
    if (!chartType) return;
    this.setData({ selectedChartType: chartType });
  },

  async onGenerateChart() {
    if (this.data.isGenerating) return;
    if (!this.data.selectedFilePath || !this.data.selectedFileName) {
      wx.showToast({ title: "请先上传数据文件", icon: "none" });
      return;
    }

    this.setData({
      isGenerating: true,
      taskStatus: "PENDING",
      taskId: "",
      errorMsg: "",
      chartTitle: "",
      chartSummary: "",
      chartInsights: [],
      chartOptionText: "",
    });

    let uploadedFileId = "";
    try {
      uploadedFileId = await uploadFileToCloud({
        filePath: this.data.selectedFilePath,
        fileName: this.data.selectedFileName,
      });
      const tempFileUrl = await getTempFileUrl(uploadedFileId);

      const resp = await request({
        url: "/lab/data-viz/tasks",
        method: "POST",
        auth: true,
        timeout: 20000,
        data: {
          fileName: this.data.selectedFileName,
          mimeType: this.data.selectedMimeType,
          extension: this.data.selectedExtension,
          fileUrl: tempFileUrl,
          chartType: this.data.selectedChartType,
        },
      });

      const taskId = String(resp?.task?.taskId || "");
      if (!taskId) {
        throw new Error("task_id_missing");
      }

      this.currentUploadedFileId = uploadedFileId;
      this.pollErrorCount = 0;
      this.setData({
        taskId,
        taskStatus: String(resp?.task?.status || "PENDING"),
      });
      this.pollTask(taskId);
    } catch (err) {
      if (this.handleAuthError(err)) return;
      await deleteCloudFile(uploadedFileId);
      const msg = err?.response?.message || "图表生成失败，请稍后重试";
      this.setData({
        isGenerating: false,
        taskStatus: "FAILED",
        errorMsg: msg,
      });
      wx.showToast({ title: "图表生成失败", icon: "none" });
    }
  },

  onCopyChartOption() {
    const text = String(this.data.chartOptionText || "").trim();
    if (!text) {
      wx.showToast({ title: "暂无可复制配置", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "配置已复制", icon: "success" }),
    });
  },
});
