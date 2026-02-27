# 快速开始

> 目标：在 5 分钟内完成后端启动、健康检查和小程序请求模式配置。

## 环境要求

| 项目 | 最低要求 |
| --- | --- |
| Docker / Docker Compose | 可正常运行 `docker compose` |
| 微信开发者工具 | 可打开 `miniprogram` 项目 |

## Step 1. 启动后端容器

```bash
cp deploy/.env.example deploy/.env
cd deploy
docker compose up -d --build
```

## Step 2. 健康检查

```bash
curl http://127.0.0.1:3005/healthz
curl http://127.0.0.1:8081/healthz
```

两个接口都返回正常状态后，再进行小程序联调。

## Step 3. 配置小程序请求模式

编辑 `miniprogram/config/runtime.js`。

推荐用于预览/体验的配置：

```js
apiMode: "cloudbase-anyservice"
```

同时确认以下配置不为空：

- `cloudbase.env`
- `cloudbase.anyServiceName` 或 `cloudbase.vmService`

## Step 4. 本地直连调试（可选）

```js
apiMode: "direct-http"
apiBaseUrl: "http://<your-ip>:<port>"
```

## Step 5. 关键环境变量

- `DATABASE_URL`
- `JWT_SECRET`
- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `OPENALEX_API_KEY`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL_POOL`

## 下一步

- 查看 [系统架构](Architecture) 了解完整调用链路。
- 开发接口联调时查 [后端 API 参考](API-Reference)。
- 异常处理请看 [故障排查](Troubleshooting)。
