# 故障排查

## 1. 小程序登录失败

检查项：

1. `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 是否正确。
2. `runtime.js` 是否使用了正确的请求模式。
3. `/healthz` 是否可达。

## 2. AnyService 报 target/config 错误

- `cloudbase_env_not_configured`：`cloudbase.env` 为空。
- `anyservice_target_not_configured`：`anyServiceName` 与 `vmService` 都为空。

## 3. Citations 页面出现 `format failed, please retry`

常见原因：

1. 上游 LLM 响应慢导致客户端先超时。
2. 模型 key 无效或模型不可用。

建议：

1. 检查 `LLM_API_KEY`。
2. 调整 `LLM_MODEL_POOL` 优先级。
3. 调整 `CITATION_LLM_TIMEOUT_MS`。
4. 查看 `rp-api` 与 `rp-nginx` 日志（关注 `499`）。

## 4. Review/DataViz 任务长时间不结束

1. 检查上传文件 URL 是否有效。
2. 检查任务状态接口是否持续返回 `RUNNING`。
3. 检查 LLM 或解析错误日志。

## 5. 容器重启后任务状态丢失

当前任务状态基于进程内内存，重启后会丢失。建议后续演进为 DB/队列持久化。
