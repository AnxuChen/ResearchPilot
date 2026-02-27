# CloudBase AnyService 落地指南（当前实现，2026-02-27）

本指南用于让微信小程序在预览/体验版稳定访问自建后端（无需先完成 ICP 备案域名改造）。

## 1. 目标与现状

当前项目支持两种 API 请求模式：

- `direct-http`：本地开发/同网环境直连
- `cloudbase-anyservice`：通过 `wx.cloud.callContainer` 访问后端（预览/体验推荐）

当前运行时配置文件：`miniprogram/config/runtime.js`

## 2. 已落地代码点

- 运行时配置：`miniprogram/config/runtime.js`
- 小程序启动注入：`miniprogram/app.js`
- 统一请求层：`miniprogram/utils/request.js`
- 登录与业务页全部走统一 request 层

## 3. 控制台配置步骤

1. 确认小程序 AppID 与项目一致（当前为 `wxa79a767109f8d055`）。
2. 在 CloudBase 创建/选择环境（记下 `env`）。
3. 开启 AnyService，接入你的后端源站（CVM 或容器网关）：
   - 协议：`HTTP`
   - 地址：`111.229.204.242`
   - 端口：`8081`
   - 健康检查：`/healthz`
4. 记录目标标识：
   - `anyServiceName`（服务名方式）
   - 或 `vmService`（CVM 标识方式）

## 4. 小程序配置方式

编辑 `miniprogram/config/runtime.js`：

```js
const runtimeConfig = {
  apiMode: "cloudbase-anyservice",
  apiBaseUrl: "http://111.229.204.242:8081",
  cloudbase: {
    env: "你的CloudBase环境ID",
    gatewayService: "tcbanyservice",
    anyServiceName: "你的服务名", // anyServiceName / vmService 二选一
    vmService: "",
  },
};
```

说明：

- `anyServiceName` 与 `vmService` 至少填一个。
- `env` 不能为空。

## 5. 请求链路

```text
Page -> utils/request.js
     -> wx.cloud.callContainer(...)
     -> AnyService gateway
     -> Nginx(8081)
     -> API(Express)
```

`utils/request.js` 会自动加：

- `X-WX-SERVICE: tcbanyservice`
- `X-AnyService-Name` 或 `X-Vm-Service`

## 6. 验收清单

1. 预览版扫码进入小程序。
2. 登录（微信/邮箱）可成功。
3. `LAB / PROJECTS / LIBRARY / PROFILE` 四个 tab 可正常请求数据。
4. `Review Simulator`、`DataViz` 能创建任务并轮询状态。

## 7. 常见问题排查

### 7.1 `cloudbase_env_not_configured`

- `runtime.js` 里没填 `cloudbase.env`。

### 7.2 `anyservice_target_not_configured`

- `anyServiceName` 和 `vmService` 都为空。

### 7.3 登录/请求报网络异常

优先检查：

- `http://111.229.204.242:8081/healthz` 是否可访问
- AnyService 源站配置的 host/port/path 是否正确
- 安全组与防火墙放通是否完整

### 7.4 `cloud.callContainer ... code: 102002`

这是长请求超时，优先改为异步接口：

- Review：`POST /lab/review-simulator/tasks` + `GET /lab/review-simulator/tasks/:taskId`
- DataViz：`POST /lab/data-viz/tasks` + `GET /lab/data-viz/tasks/:taskId`

### 7.5 Citations 页面偶发 `format failed, please retry`

- 常见原因是客户端先超时断开（Nginx 日志可能出现 `499`）。
- 建议检查：
  - LLM key 是否有效
  - `LLM_BASE_URL` 与 `LLM_MODEL_POOL` 是否正确
  - `CITATION_LLM_TIMEOUT_MS` 是否过高

## 8. 与当前后端配置对齐项

后端部署变量位于 `deploy/.env`，重点关注：

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL_POOL`
- `CITATION_LLM_TIMEOUT_MS`
- `OPENALEX_API_KEY`

修改后需重启 API 容器：

```bash
cd deploy
docker compose up -d --force-recreate api
```

## 9. 建议

1. 预览/体验阶段固定使用 `cloudbase-anyservice`。
2. Review/DataViz 一律使用异步任务接口。
3. 生产阶段如切换到独立 HTTPS 域名，可改回 `direct-http`（并保留 AnyService 作为备用链路）。
