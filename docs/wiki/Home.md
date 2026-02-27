# Research Pilot Wiki

> 面向科研工作流的微信小程序：找文献、读文献、管项目、做 AI 辅助写作与分析。

[产品概览](Product-Overview) · [快速开始](Quick-Start) · [前端实现](Frontend-Implementation) · [系统架构](Architecture) · [API 参考](API-Reference) · [部署与运维](Deployment-and-Ops) · [故障排查](Troubleshooting)

## 快速入口

| 入口 | 你会得到什么 | 建议阅读时机 |
| --- | --- | --- |
| [5 分钟启动](Quick-Start) | 拉起后端容器并连通小程序请求 | 第一次部署 |
| [前端实现说明](Frontend-Implementation) | 路由、请求层、登录态、各页面实现细节 | 前端开发和联调前 |
| [系统架构](Architecture) | 前后端、网关、数据库、LLM 调用链路全景 | 联调或排障前 |
| [后端 API 参考](API-Reference) | 主要业务接口清单与模块划分 | 前端开发中 |
| [部署与运维](Deployment-and-Ops) | 重启、健康检查、日志与配置变更流程 | 上线和维护时 |
| [故障排查](Troubleshooting) | 高频问题的定位顺序与处理建议 | 出现异常时 |

## 当前技术状态

| 组件 | 现状 |
| --- | --- |
| 小程序前端 | 微信原生小程序 |
| API 服务 | Node.js + Express |
| 数据库 | PostgreSQL |
| 网关 | Nginx |
| 请求模式 | `cloudbase-anyservice` 与 `direct-http` 可切换 |

## 阅读路径建议

1. 先读 [快速开始](Quick-Start) 完成可运行环境。
2. 前端同学建议看 [前端实现说明](Frontend-Implementation)。
3. 再看 [系统架构](Architecture) 建立全链路认知。
4. 开发联调时查 [后端 API 参考](API-Reference)。
5. 遇到异常直接跳 [故障排查](Troubleshooting)。

## 为什么会看到“未渲染 Markdown”

如果打开 `raw.githubusercontent.com/wiki/.../*.md`，看到的一定是源码文本，不会渲染样式。

请使用渲染地址：

- Wiki 首页: `https://github.com/bmh201708/ResearchPilot/wiki`
- 示例页面: `https://github.com/bmh201708/ResearchPilot/wiki/Quick-Start`

## 仓库内补充文档

- `docs/后端联调接口说明.md`
- `docs/后端技术架构规划.md`
- `docs/CloudBase-AnyService-wiki.md`
