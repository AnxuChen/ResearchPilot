# 快速开始

## 环境要求

- Docker / Docker Compose
- 微信开发者工具

## 1. 启动后端

```bash
cp deploy/.env.example deploy/.env
cd deploy
docker compose up -d --build
```

## 2. 健康检查

```bash
curl http://127.0.0.1:3005/healthz
curl http://127.0.0.1:8081/healthz
```

## 3. 配置小程序请求模式

编辑 `miniprogram/config/runtime.js`。

推荐配置（预览/体验）：

```js
apiMode: "cloudbase-anyservice"
```

并配置：

- `cloudbase.env`
- `cloudbase.anyServiceName` 或 `cloudbase.vmService`

## 4. 本地直连调试（可选）

```js
apiMode: "direct-http"
apiBaseUrl: "http://<your-ip>:<port>"
```

## 5. 常用环境变量

- `DATABASE_URL`
- `JWT_SECRET`
- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `OPENALEX_API_KEY`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL_POOL`
