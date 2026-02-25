const { request } = require("../../utils/request");

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ["pdf", "txt", "md"];
const RECENT_LIMIT = 10;

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function extFromFileName(fileName = "") {
  const safe = String(fileName || "").trim().toLowerCase();
  if (!safe.includes(".")) return "";
  return safe.split(".").pop();
}

function basename(filePath = "") {
  const safe = String(filePath || "").trim();
  if (!safe) return "";
  const parts = safe.split("/");
  return parts[parts.length - 1] || "";
}

function formatRecentTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60 * 1000) return "just now";
  if (diffMs < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / (60 * 1000)))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)))}h ago`;
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recentIconClass(extension) {
  const ext = String(extension || "").trim().toLowerCase();
  if (ext === "pdf") return "pdf-icon";
  if (ext === "txt") return "txt-icon";
  if (ext === "md") return "md-icon";
  return "default-icon";
}

function normalizeReview(review) {
  const safe = review || {};
  return {
    decision: String(safe.decision || "REJECT").toUpperCase(),
    score: Number.isFinite(Number(safe.score)) ? Number(safe.score) : 0,
    summary: String(safe.summary || ""),
    strengths: Array.isArray(safe.strengths) ? safe.strengths : [],
    weaknesses: Array.isArray(safe.weaknesses) ? safe.weaknesses : [],
    suggestions: Array.isArray(safe.suggestions) ? safe.suggestions : [],
  };
}

function mapRecentSimulation(item) {
  const inputPayload =
    item && item.inputPayload && typeof item.inputPayload === "object"
      ? item.inputPayload
      : {};
  const outputPayload =
    item && item.outputPayload && typeof item.outputPayload === "object"
      ? item.outputPayload
      : {};
  const rawReview =
    outputPayload.review && typeof outputPayload.review === "object"
      ? outputPayload.review
      : outputPayload;
  const review = normalizeReview(rawReview);
  const fileName = String(inputPayload.fileName || item?.title || "Manuscript").trim();
  const extension = String(
    inputPayload.extension || extFromFileName(fileName) || ""
  ).toLowerCase();
  return {
    id: item.id,
    fileName: fileName || "Manuscript",
    extension,
    iconClass: recentIconClass(extension),
    timeText: formatRecentTime(item?.createdAt),
    scoreText: `${review.score}/10`,
    decision: review.decision,
    review,
  };
}

function sanitizeFileName(fileName = "") {
  return String(fileName || "manuscript")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}

function uploadFileToCloud({ filePath, fileName }) {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const cloudPath = `review-simulator/${Date.now()}-${randomSuffix}-${sanitizeFileName(
    fileName
  )}`;

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
    isReviewing: false,
    reviewTaskId: "",
    reviewStatus: "",
    reviewResult: null,
    recentItems: [],
    isRecentLoading: false,
  },

  onShow() {
    this.fetchRecentSimulations();
  },

  onUnload() {
    this.stopReviewPolling();
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

  stopReviewPolling() {
    if (this.reviewPollTimer) {
      clearTimeout(this.reviewPollTimer);
      this.reviewPollTimer = null;
    }
  },

  scheduleNextPoll(taskId) {
    this.stopReviewPolling();
    this.reviewPollTimer = setTimeout(() => {
      this.pollReviewTask(taskId);
    }, 2500);
  },

  async pollReviewTask(taskId) {
    try {
      const resp = await request({
        url: `/lab/review-simulator/tasks/${taskId}`,
        method: "GET",
        auth: true,
        timeout: 20000,
      });
      const task = resp?.task || {};
      const status = String(task.status || "PENDING").toUpperCase();

      if (status === "DONE") {
        this.stopReviewPolling();
        await deleteCloudFile(this.currentUploadedFileId || "");
        this.currentUploadedFileId = "";
        this.setData({
          isReviewing: false,
          reviewTaskId: "",
          reviewStatus: "DONE",
          reviewResult: normalizeReview(task.review || {}),
        });
        this.fetchRecentSimulations();
        return;
      }

      if (status === "FAILED") {
        this.stopReviewPolling();
        await deleteCloudFile(this.currentUploadedFileId || "");
        this.currentUploadedFileId = "";
        this.setData({
          isReviewing: false,
          reviewTaskId: "",
          reviewStatus: "FAILED",
        });
        wx.showToast({
          title: task.error || "Review failed, please retry",
          icon: "none",
        });
        return;
      }

      this.setData({
        reviewTaskId: taskId,
        reviewStatus: status,
      });
      this.pollErrorCount = 0;
      this.scheduleNextPoll(taskId);
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.pollErrorCount = (this.pollErrorCount || 0) + 1;
      if (this.pollErrorCount >= 5) {
        this.stopReviewPolling();
        this.setData({
          isReviewing: false,
          reviewTaskId: "",
          reviewStatus: "FAILED",
        });
        wx.showToast({
          title: "Review timed out, try again later",
          icon: "none",
        });
        return;
      }
      this.scheduleNextPoll(taskId);
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
          wx.showToast({ title: "No file selected", icon: "none" });
          return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          wx.showToast({
            title: "File too large (max 50MB)",
            icon: "none",
          });
          return;
        }

        const fileName = String(file.name || basename(file.path) || "manuscript");
        const extension = extFromFileName(fileName);
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
          wx.showToast({
            title: "Only PDF/TXT/MD supported",
            icon: "none",
          });
          return;
        }

        this.setData({
          selectedFileName: fileName,
          selectedFileSizeText: formatFileSize(file.size || 0),
          selectedFilePath: file.path,
          selectedMimeType: file.type || "",
          selectedExtension: extension,
          reviewResult: null,
        });
      },
      fail: () => {
        wx.showToast({
          title: "File selection canceled",
          icon: "none",
        });
      },
    });
  },

  async onStartReview() {
    if (this.data.isReviewing) return;
    if (!this.data.selectedFilePath || !this.data.selectedFileName) {
      wx.showToast({ title: "Please upload a manuscript first", icon: "none" });
      return;
    }

    this.setData({
      isReviewing: true,
      reviewTaskId: "",
      reviewStatus: "PENDING",
      reviewResult: null,
    });
    let uploadedFileId = "";
    try {
      uploadedFileId = await uploadFileToCloud({
        filePath: this.data.selectedFilePath,
        fileName: this.data.selectedFileName,
      });
      const tempFileUrl = await getTempFileUrl(uploadedFileId);

      const resp = await request({
        url: "/lab/review-simulator/tasks",
        method: "POST",
        auth: true,
        timeout: 20000,
        data: {
          fileName: this.data.selectedFileName,
          mimeType: this.data.selectedMimeType,
          extension: this.data.selectedExtension,
          fileUrl: tempFileUrl,
        },
      });
      const taskId = String(resp?.task?.taskId || "");
      if (!taskId) {
        throw new Error("task_id_missing");
      }

      this.currentUploadedFileId = uploadedFileId;
      this.pollErrorCount = 0;
      this.setData({
        reviewTaskId: taskId,
        reviewStatus: String(resp?.task?.status || "PENDING"),
      });
      this.pollReviewTask(taskId);
    } catch (err) {
      await deleteCloudFile(uploadedFileId);
      if (this.handleAuthError(err)) return;
      const msg = err?.response?.message || err?.errMsg || "Review failed, please try again later";
      wx.showToast({ title: msg, icon: "none" });
      this.setData({
        isReviewing: false,
        reviewTaskId: "",
        reviewStatus: "",
      });
    }
  },

  async fetchRecentSimulations() {
    if (this.data.isRecentLoading) return;
    this.setData({ isRecentLoading: true });
    try {
      const resp = await request({
        url: "/lab/review-simulator/recent",
        method: "GET",
        auth: true,
        timeout: 20000,
        data: {
          limit: RECENT_LIMIT,
        },
      });
      const items = Array.isArray(resp?.items)
        ? resp.items.map(mapRecentSimulation)
        : [];
      this.setData({
        recentItems: items,
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        recentItems: [],
      });
    } finally {
      this.setData({ isRecentLoading: false });
    }
  },

  onTapRecentSimulation(e) {
    const index = Number(e.currentTarget?.dataset?.index);
    if (!Number.isFinite(index) || index < 0) return;
    const item = this.data.recentItems[index];
    if (!item) return;

    this.setData({
      reviewResult: normalizeReview(item.review || {}),
      selectedFileName: item.fileName || "",
    });
    wx.showToast({
      title: "Loaded from recent history",
      icon: "none",
    });
  },

  async onDeleteRecentSimulation(e) {
    const recordId = String(e.currentTarget?.dataset?.id || "").trim();
    if (!recordId) return;

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: "Delete record",
        content: "Delete this simulation from recent history?",
        confirmText: "Delete",
        cancelText: "Cancel",
        success: (res) => resolve(Boolean(res?.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;

    try {
      await request({
        url: `/lab/review-simulator/recent/${encodeURIComponent(recordId)}`,
        method: "DELETE",
        auth: true,
        timeout: 15000,
      });
      this.setData({
        recentItems: this.data.recentItems.filter((item) => item.id !== recordId),
      });
      wx.showToast({
        title: "Deleted",
        icon: "success",
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      wx.showToast({
        title: "Delete failed",
        icon: "none",
      });
    }
  },
});
