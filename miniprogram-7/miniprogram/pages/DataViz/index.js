const { request } = require("../../utils/request");

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ["csv", "json", "xls", "xlsx"];
const CHART_CANVAS_ID = "chartCanvas";

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

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumericTick(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return `${Math.round(value)}`;
  if (Math.abs(value) >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function normalizeSeriesType(rawType, fallbackType = "line") {
  const t = String(rawType || fallbackType || "line").trim().toLowerCase();
  if (t === "bar" || t === "scatter" || t === "line" || t === "heatmap") return t;
  return fallbackType;
}

function normalizePlotData(option, fallbackType = "line") {
  const safeOption = option && typeof option === "object" ? option : {};
  const series = Array.isArray(safeOption.series) ? safeOption.series : [];
  const firstSeries = series[0] && typeof series[0] === "object" ? series[0] : {};
  const chartType = normalizeSeriesType(firstSeries.type, fallbackType);
  const xAxisData = Array.isArray(safeOption?.xAxis?.data) ? safeOption.xAxis.data : [];
  const rawData = Array.isArray(firstSeries.data) ? firstSeries.data : [];

  if (!rawData.length) {
    return {
      chartType,
      points: [],
      labels: [],
    };
  }

  if (chartType === "scatter") {
    const points = [];
    const labels = [];
    rawData.forEach((item, index) => {
      let xValue = null;
      let yValue = null;
      if (Array.isArray(item)) {
        xValue = toFiniteNumber(item[0]);
        yValue = toFiniteNumber(item[1]);
      } else if (item && typeof item === "object") {
        const value = Array.isArray(item.value) ? item.value : [];
        xValue = toFiniteNumber(value[0]);
        yValue = toFiniteNumber(value[1]);
        if (xValue === null) xValue = toFiniteNumber(item.x);
        if (yValue === null) yValue = toFiniteNumber(item.y);
      } else {
        yValue = toFiniteNumber(item);
      }
      if (xValue === null) xValue = index + 1;
      if (yValue === null) return;

      points.push({ xValue, yValue });
      labels.push(String(xAxisData[index] ?? `${xValue}`));
    });
    return {
      chartType,
      points,
      labels,
    };
  }

  const points = [];
  const labels = [];
  rawData.forEach((item, index) => {
    let yValue = null;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      yValue = toFiniteNumber(item.value);
    } else {
      yValue = toFiniteNumber(item);
    }
    if (yValue === null) return;
    points.push({
      xValue: index + 1,
      yValue,
    });
    labels.push(String(xAxisData[index] ?? `${index + 1}`));
  });
  return {
    chartType,
    points,
    labels,
  };
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
    chartOption: null,
    showOptionText: false,
    chartRenderHint: "",
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
        const chartOption =
          result?.echartsOption && typeof result.echartsOption === "object"
            ? result.echartsOption
            : null;
        const optionText = JSON.stringify(chartOption || {}, null, 2);

        this.setData({
          isGenerating: false,
          taskId: "",
          taskStatus: "DONE",
          chartTitle: result.title || "Generated Chart",
          chartSummary: result.summary || "",
          chartInsights: Array.isArray(result.insights) ? result.insights : [],
          chartOptionText: optionText,
          chartOption,
          showOptionText: false,
          chartRenderHint: "",
          chartProvider: result.provider || "llm",
          errorMsg: "",
        });
        if (chartOption) {
          wx.nextTick(() => {
            this.renderChart(chartOption);
          });
        }
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
          chartOption: null,
          errorMsg: task.error || "Chart generation failed",
        });
        wx.showToast({ title: task.error || "Chart generation failed", icon: "none" });
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
          errorMsg: "Generation timed out, please retry",
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
          wx.showToast({ title: "No file selected", icon: "none" });
          return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          wx.showToast({ title: "File too large (max 50MB)", icon: "none" });
          return;
        }

        const fileName = String(file.name || basename(file.path) || "dataset");
        const extension = extFromFileName(fileName);
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
          wx.showToast({ title: "Only CSV/JSON/XLS/XLSX are supported", icon: "none" });
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
          chartOption: null,
          chartRenderHint: "",
          showOptionText: false,
        });
      },
      fail: () => {
        wx.showToast({ title: "File selection canceled", icon: "none" });
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
      wx.showToast({ title: "Please upload a data file first", icon: "none" });
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
      chartOption: null,
      chartRenderHint: "",
      showOptionText: false,
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
      const msg = err?.response?.message || "Chart generation failed, please retry";
      this.setData({
        isGenerating: false,
        taskStatus: "FAILED",
        chartOption: null,
        errorMsg: msg,
      });
      wx.showToast({ title: "Chart generation failed", icon: "none" });
    }
  },

  onToggleOptionText() {
    this.setData({
      showOptionText: !this.data.showOptionText,
    });
  },

  onCopyChartOption() {
    const text = String(this.data.chartOptionText || "").trim();
    if (!text) {
      wx.showToast({ title: "No config to copy", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "Config copied", icon: "success" }),
    });
  },

  renderChart(option) {
    const plot = normalizePlotData(option, this.data.selectedChartType);
    if (!plot.points.length) {
      this.setData({
        chartRenderHint: "Chart data is empty. Showing config only.",
      });
      return;
    }
    if (plot.chartType === "heatmap") {
      this.setData({
        chartRenderHint: "Heatmap preview is not available yet. Showing config and summary.",
      });
      return;
    }

    wx.createSelectorQuery()
      .in(this)
      .select("#chartCanvas")
      .boundingClientRect((rect) => {
        if (!rect || !rect.width || !rect.height) {
          this.setData({ chartRenderHint: "Chart renderer init failed, please retry." });
          return;
        }
        this.drawPlot(plot, rect.width, rect.height);
      })
      .exec();
  },

  drawPlot(plot, width, height) {
    const ctx = wx.createCanvasContext(CHART_CANVAS_ID, this);
    const safeWidth = Math.max(280, Number(width) || 320);
    const safeHeight = Math.max(220, Number(height) || 260);
    const pad = {
      left: 60,
      right: 24,
      top: 20,
      bottom: 48,
    };
    const plotW = safeWidth - pad.left - pad.right;
    const plotH = safeHeight - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) {
      this.setData({ chartRenderHint: "Chart area size is invalid, please retry." });
      return;
    }

    const yValues = plot.points.map((p) => p.yValue).filter(Number.isFinite);
    if (!yValues.length) {
      this.setData({ chartRenderHint: "Invalid chart values. Showing config only." });
      return;
    }

    let yMin = Math.min(...yValues);
    let yMax = Math.max(...yValues);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }

    const xMin =
      plot.chartType === "scatter"
        ? Math.min(...plot.points.map((p) => p.xValue))
        : 1;
    const xMax =
      plot.chartType === "scatter"
        ? Math.max(...plot.points.map((p) => p.xValue))
        : Math.max(plot.points.length, 1);
    const safeXMin = Number.isFinite(xMin) ? xMin : 1;
    const safeXMax = Number.isFinite(xMax) && xMax !== safeXMin ? xMax : safeXMin + 1;

    const toX = (point, idx) => {
      if (plot.chartType === "scatter") {
        return pad.left + ((point.xValue - safeXMin) / (safeXMax - safeXMin)) * plotW;
      }
      if (plot.chartType === "bar") {
        const step = plotW / Math.max(plot.points.length, 1);
        return pad.left + step * idx + step / 2;
      }
      if (plot.points.length === 1) return pad.left + plotW / 2;
      return pad.left + (plotW * idx) / (plot.points.length - 1);
    };
    const toY = (yValue) => pad.top + ((yMax - yValue) / (yMax - yMin)) * plotH;

    ctx.clearRect(0, 0, safeWidth, safeHeight);
    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, safeWidth, safeHeight);

    // grid + y ticks
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i += 1) {
      const ratio = i / tickCount;
      const y = pad.top + ratio * plotH;
      const tickValue = yMax - (yMax - yMin) * ratio;

      ctx.beginPath();
      ctx.setStrokeStyle("#e5e7eb");
      ctx.setLineWidth(1);
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();

      ctx.setFillStyle("#94a3b8");
      ctx.setFontSize(10);
      ctx.setTextAlign("right");
      ctx.setTextBaseline("middle");
      ctx.fillText(formatNumericTick(tickValue), pad.left - 8, y);
    }

    // axes
    ctx.beginPath();
    ctx.setStrokeStyle("#94a3b8");
    ctx.setLineWidth(1.2);
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    // x tick labels
    const maxTicks = 6;
    const labelIndexes = [];
    const n = plot.points.length;
    if (n <= maxTicks) {
      for (let i = 0; i < n; i += 1) labelIndexes.push(i);
    } else {
      for (let i = 0; i < maxTicks; i += 1) {
        labelIndexes.push(Math.round((i * (n - 1)) / (maxTicks - 1)));
      }
    }
    const uniqueLabelIndexes = labelIndexes.filter(
      (idx, i, arr) => idx >= 0 && idx < n && arr.indexOf(idx) === i
    );

    ctx.setFillStyle("#94a3b8");
    ctx.setFontSize(10);
    ctx.setTextAlign("center");
    ctx.setTextBaseline("top");
    uniqueLabelIndexes.forEach((idx) => {
      const point = plot.points[idx];
      const x = toX(point, idx);
      let label = String(plot.labels[idx] ?? idx + 1);
      if (label.length > 8) label = `${label.slice(0, 8)}...`;
      ctx.fillText(label, x, pad.top + plotH + 8);
    });

    if (plot.chartType === "bar") {
      const step = plotW / Math.max(plot.points.length, 1);
      const barW = Math.max(4, Math.min(28, step * 0.58));
      ctx.setFillStyle("#60a5fa");
      plot.points.forEach((point, idx) => {
        const centerX = toX(point, idx);
        const y = toY(point.yValue);
        const barH = pad.top + plotH - y;
        ctx.fillRect(centerX - barW / 2, y, barW, Math.max(1, barH));
      });
    } else if (plot.chartType === "scatter") {
      ctx.setFillStyle("#f97316");
      plot.points.forEach((point, idx) => {
        const x = toX(point, idx);
        const y = toY(point.yValue);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      // line
      ctx.beginPath();
      ctx.setStrokeStyle("#14b8a6");
      ctx.setLineWidth(2);
      plot.points.forEach((point, idx) => {
        const x = toX(point, idx);
        const y = toY(point.yValue);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.setFillStyle("#0f766e");
      plot.points.forEach((point, idx) => {
        const x = toX(point, idx);
        const y = toY(point.yValue);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.draw();
    this.setData({ chartRenderHint: "" });
  },
});
