# 后端 API 参考

## 认证

- `POST /auth/wx-login`
- `POST /auth/email-register`
- `POST /auth/email-login`

## 用户

- `GET /users/me`
- `PUT /users/me/profile`
- `GET /users/me/liked-papers`

## 论文

- `GET /papers/feed`
- `GET /papers/:id`
- `POST /papers/:id/action`
- `POST /papers/:id/like`
- `POST /papers/:id/ai-reading`

## 评论

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

- AcademicPls
  - `POST /lab/academic-pls`
  - `GET /lab/academic-pls/recent`
  - `DELETE /lab/academic-pls/recent/:recordId`

- Citations
  - `POST /lab/citations/format`
  - `GET /lab/citations/recent`
  - `DELETE /lab/citations/recent/:recordId`

- DataViz
  - `POST /lab/data-viz/tasks`
  - `GET /lab/data-viz/tasks/:taskId`
  - `GET /lab/data-viz/recent`

- Review Simulator
  - `POST /lab/review-simulator/tasks`
  - `GET /lab/review-simulator/tasks/:taskId`
  - `GET /lab/review-simulator/recent`
  - `DELETE /lab/review-simulator/recent/:recordId`
  - `POST /lab/review-simulator`（同步兼容）

详细字段示例请参考：`docs/后端联调接口说明.md`
