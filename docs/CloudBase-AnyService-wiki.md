# CloudBase AnyService 使用报告（Wiki）

- 文档类型：运行报告 / 运维 Wiki
- 更新时间：2026-02-27
- 适用范围：`ResearchPilot` 微信小程序（预览/体验链路）

## 1. 背景

本项目后端部署在自建服务器（`111.229.204.242`），为解决小程序预览/体验版对直连链路的限制，当前默认采用 **CloudBase AnyService** 转发到后端 API。

## 2. 当前状态（Status）

- 总体状态：`ACTIVE`
- 小程序请求模式：`cloudbase-anyservice`
- 运行时默认值：`miniprogram/config/runtime.js`
- 后端入口：`http://111.229.204.242:8081`（Nginx）
- 健康检查：`/healthz`

## 3. 当前配置快照

配置来源：`miniprogram/config/runtime.js`

```js
apiMode: "cloudbase-anyservice"
apiBaseUrl: "http://111.229.204.242:8081"
cloudbase.env: "cloud1-9gx3r43j22f4cca1"
cloudbase.gatewayService: "tcbanyservice"
cloudbase.anyServiceName: "researchpilotapi"
cloudbase.vmService: ""
```

说明：

- 当前使用 `anyServiceName` 路由（非 `vmService`）。
- `direct-http` 仍保留在代码中用于本地联调，不作为默认线上模式。

## 4. 请求链路（Architecture）

```text
Mini Program Page
  -> miniprogram/utils/request.js
  -> wx.cloud.callContainer
  -> CloudBase AnyService Gateway
  -> Nginx (111.229.204.242:8081)
  -> API Container (Express)
```

请求头注入逻辑（`utils/request.js`）：

- `X-WX-SERVICE: tcbanyservice`
- `X-AnyService-Name: researchpilotapi`（当前生效）
- 当 `vmService` 配置时改为 `X-Vm-Service`

## 5. 代码落地点（Code Map）

- 运行时配置：`miniprogram/config/runtime.js`
- 小程序全局初始化：`miniprogram/app.js`
- 网络层（AnyService/Direct 双通道）：`miniprogram/utils/request.js`
- 业务页面请求（示例）：
  - 登录：`miniprogram/pages/login/login.js`
  - 文献流：`miniprogram/pages/explore/index.js`
  - Lab 工具：`miniprogram/pages/AcademicPls|Citations|DataViz|review_simulator`

## 6. 验收结果（Current Verification）

当前链路可支撑以下核心业务：

1. 登录链路（微信/邮箱）可用。
2. 四个主 tab（LAB/PROJECTS/LIBRARY/PROFILE）接口可达。
3. Review Simulator、DataViz 已改为异步任务模式，可规避长请求超时。
4. 后端 `/healthz` 可通过 AnyService 链路访问。

## 7. 已知问题与处理

### 7.1 `cloud.callContainer ... code 102002`

- 原因：长请求超时（常见于大文件 AI 任务）。
- 处理：改用异步任务接口（已落地）：
  - Review：`POST /lab/review-simulator/tasks` + `GET /lab/review-simulator/tasks/:taskId`
  - DataViz：`POST /lab/data-viz/tasks` + `GET /lab/data-viz/tasks/:taskId`

### 7.2 Citations 偶发 `format failed, please retry`

- 现象：客户端先超时断连（Nginx 可见 `499`）。
- 原因：上游 LLM 慢响应 / 重试链路过长。
- 处理建议：
  - 校验 `LLM_API_KEY` 与模型可用性
  - 控制 `CITATION_LLM_TIMEOUT_MS`
  - 保持模型池优先级为稳定、低延迟模型

## 8. 运维操作（Runbook）

### 8.1 修改后端 LLM 配置并生效

```bash
cd /opt/research-pilot/deploy
# 编辑 .env 后
docker compose up -d --force-recreate api
```

### 8.2 健康检查

```bash
curl http://127.0.0.1:3005/healthz
curl http://127.0.0.1:8081/healthz
```

### 8.3 查看容器与日志

```bash
docker ps
docker logs --tail 100 rp-api
docker logs --tail 100 rp-nginx
```

## 9. 风险与后续计划

### 当前风险

1. AnyService 仍受网关超时影响，长任务必须异步化。
2. 业务高峰时，LLM 外部依赖波动会放大前端失败感知。

### 后续计划

1. 对关键慢接口完善超时预算与降级策略（特别是 Citations）。
2. 将异步任务状态由内存 Map 演进为持久化（DB/队列）。
3. 保留 AnyService 作为预览/体验主链路，后续可并行评估正式域名直连。

## 10. 变更记录

- 2026-02-27：
  - 对齐当前运行配置（`anyServiceName=researchpilotapi`）。
  - 补充故障场景、排查手册与后续计划。
