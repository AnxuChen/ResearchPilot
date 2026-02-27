# 故障排查

## 常见问题速查表

| 现象 | 优先检查项 | 处理建议 |
| --- | --- | --- |
| 小程序登录失败 | `WECHAT_APP_ID` / `WECHAT_APP_SECRET`、`runtime.js`、`/healthz` | 校验微信配置与服务可达性 |
| AnyService target/config 错误 | `cloudbase.env`、`anyServiceName`、`vmService` | 补齐目标配置并重试 |
| Citations 提示 `format failed, please retry` | `LLM_API_KEY`、`LLM_MODEL_POOL`、LLM 超时 | 提高稳定模型优先级并检查网关超时 |
| Review/DataViz 长时间 `RUNNING` | 上传文件 URL、任务轮询接口、后端错误日志 | 校验输入资源与任务执行日志 |
| 容器重启后任务状态丢失 | 当前状态存储方案 | 任务状态改造为 DB/队列持久化 |

## 重点问题: Citations `format failed, please retry`

优先排查顺序：

1. 检查 `deploy/.env` 中 `LLM_API_KEY` 是否有效。
2. 检查 `LLM_MODEL_POOL` 的模型顺序与模型可用性。
3. 检查 `CITATION_LLM_TIMEOUT_MS` 是否过小。
4. 查看 `rp-api`、`rp-nginx` 日志，重点关注超时与 `499`。

## 常用排障命令

```bash
curl http://127.0.0.1:3005/healthz
curl http://127.0.0.1:8081/healthz
docker logs --tail 200 rp-api
docker logs --tail 200 rp-nginx
```

## 关联文档

- [部署与运维](Deployment-and-Ops)
- [系统架构](Architecture)
- [后端 API 参考](API-Reference)
