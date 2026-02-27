# 部署与运维

## 容器组成

- `rp-nginx`
- `rp-api`
- `rp-postgres`
- `rp-redis`

## 启动/重启

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

## 日志查看

```bash
docker logs --tail 100 rp-api
docker logs --tail 100 rp-nginx
```

## 常改配置

- `deploy/.env`
- `miniprogram/config/runtime.js`

修改后注意重启对应服务。
