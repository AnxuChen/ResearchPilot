# 部署与运维

## 容器拓扑

| 容器名 | 角色 |
| --- | --- |
| `rp-nginx` | 统一入口与反向代理 |
| `rp-api` | Express 业务 API |
| `rp-postgres` | 主数据库 |
| `rp-redis` | 缓存与后续任务状态演进基础 |

## 启动与重启

```bash
cd deploy
docker compose up -d --build
```

仅重启 API：

```bash
cd deploy
docker compose up -d --force-recreate api
```

## 健康检查

```bash
curl http://127.0.0.1:3005/healthz
curl http://127.0.0.1:8081/healthz
```

## 常用日志命令

```bash
docker logs --tail 100 rp-api
docker logs --tail 100 rp-nginx
```

## 高频变更项

- `deploy/.env`
- `miniprogram/config/runtime.js`

配置变更后，请重启受影响容器并再次执行健康检查。

## 推荐排障顺序

1. 先看健康检查接口。
2. 再看 `rp-nginx` 与 `rp-api` 日志。
3. 最后核对 `.env` 与小程序 `runtime.js` 是否一致。
