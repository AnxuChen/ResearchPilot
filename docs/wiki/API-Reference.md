# 后端 API 参考

> 本页提供按模块组织的接口清单。字段级示例与请求体细节请查仓库文档 `docs/后端联调接口说明.md`。

## Auth

- `POST /auth/wx-login`
- `POST /auth/email-register`
- `POST /auth/email-login`

## Users

- `GET /users/me`
- `PUT /users/me/profile`
- `GET /users/me/liked-papers`

## Papers

- `GET /papers/feed`
- `GET /papers/:id`
- `POST /papers/:id/action`
- `POST /papers/:id/like`
- `POST /papers/:id/ai-reading`

## Comments

- `GET /papers/:id/comments`
- `POST /papers/:id/comments`
- `POST /papers/:id/comments/:commentId/like`

## Projects

- `GET /projects/conferences`
- `POST /projects/conferences`
- `PATCH /projects/conferences/:id`
- `DELETE /projects/conferences/:id`

## Profile

- `GET /profile/dashboard`

## Lab

| 子模块 | 接口 |
| --- | --- |
| AcademicPls | `POST /lab/academic-pls`, `GET /lab/academic-pls/recent`, `DELETE /lab/academic-pls/recent/:recordId` |
| Citations | `POST /lab/citations/format`, `GET /lab/citations/recent`, `DELETE /lab/citations/recent/:recordId` |
| DataViz | `POST /lab/data-viz/tasks`, `GET /lab/data-viz/tasks/:taskId`, `GET /lab/data-viz/recent` |
| Review Simulator | `POST /lab/review-simulator/tasks`, `GET /lab/review-simulator/tasks/:taskId`, `GET /lab/review-simulator/recent`, `DELETE /lab/review-simulator/recent/:recordId`, `POST /lab/review-simulator`(同步兼容) |

## 联调建议

1. 先按 [快速开始](Quick-Start) 跑通健康检查。
2. 再结合 [系统架构](Architecture) 选择请求模式。
3. 出现异常时按 [故障排查](Troubleshooting) 定位。
