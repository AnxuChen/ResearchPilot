# 前端实现说明

> 本页基于当前 `miniprogram/` 代码实现整理，面向前端开发、联调和维护。

## 技术栈与目录

| 项目 | 现状 |
| --- | --- |
| 框架 | 微信小程序原生（WXML/WXSS/JS） |
| 状态管理 | 页面 `data` + `app.globalData` + `wx.setStorageSync` |
| 请求层 | `miniprogram/utils/request.js` 统一封装 |
| 运行时配置 | `miniprogram/config/runtime.js` |
| 国际化 | `miniprogram/utils/language.js`（`en/zh`） |
| 导航 | `app.json` + 自定义 `custom-tab-bar` |

目录重点：

- `miniprogram/pages/*`：业务页面实现。
- `miniprogram/custom-tab-bar/*`：底部导航与全局搜索入口。
- `miniprogram/utils/request.js`：`direct-http` / `cloudbase-anyservice` 双模式请求。
- `miniprogram/config/runtime.js`：后端接入模式与 CloudBase AnyService 参数。

## 页面路由与导航结构

`app.json` 当前注册 14 个页面，入口流程为登录页。

Tab 页（自定义 TabBar）：

- `pages/lab/index`
- `pages/projects/index`
- `pages/explore/index`
- `pages/profile/index`

非 Tab 页（`navigateTo/redirectTo`）：

- 登录注册：`login`、`register`、`wx_profile_setup`
- Lab 子工具：`AcademicPls`、`Citations`、`DataViz`、`review_simulator`
- 文献详情：`paper/detail`
- Profile 设置：`profile_settings`
- 文献卡片模式：`explore_Card`

导航实现要点：

- 自定义 TabBar 中央按钮是“全局论文搜索”入口（弹出搜索框）。
- TabBar 搜索会先预请求 `/papers/feed`，再切换到 `Explore` 页面消费预加载结果。

## 请求层与运行时模式

统一请求入口：`miniprogram/utils/request.js`

- 自动附带 `Content-Type: application/json`。
- `auth: true` 时自动读取 `token` 并加 `Authorization: Bearer ...`。
- 统一 HTTP 正常/异常归一化（2xx 通过，非 2xx 抛 `Error`）。

两种请求模式：

1. `direct-http`
   - 通过 `wx.request` 直连 `runtimeConfig.apiBaseUrl`。
2. `cloudbase-anyservice`
   - 通过 `wx.cloud.callContainer` 转发。
   - 自动设置 `X-WX-SERVICE`、`X-AnyService-Name` / `X-Vm-Service`。

运行时配置文件：`miniprogram/config/runtime.js`

- `apiMode`: `direct-http` 或 `cloudbase-anyservice`
- `apiBaseUrl`: 直连模式后端地址
- `cloudbase.env/gatewayService/anyServiceName/vmService`: AnyService 接入参数

## 登录态、用户态与国际化

登录态：

- `token`、`user` 存在 `wx` 本地存储。
- 多数页面遇到 `401` 或 `missing_token` 会清空登录态并跳转登录页。

国际化：

- `language.js` 只维护 `en/zh`。
- 当前语言优先从 `app.globalData.language` 读取，否则使用本地存储。
- `profile_settings` 支持切换语言，并尝试同步到 `/users/me/profile`。

用户资料：

- Profile 与设置页读取 `/users/me`。
- 微信登录后若昵称/头像缺失，会进入 `wx_profile_setup` 强制补全。

## 核心页面实现

### 1) Auth: login/register/wx_profile_setup

- `login` 支持邮箱登录与微信登录（`/auth/email-login`、`/auth/wx-login`）。
- 微信登录请求失败时包含一次 `502` 重试逻辑。
- `register` 调用 `/auth/email-register` 并在成功后写入登录态。
- `wx_profile_setup` 调用 `/users/me/profile` 提交昵称与头像（base64 data URL）。

### 2) Library: explore/explore_Card/paper/detail

- `explore` 使用双列瀑布流分栏（`splitColumns`）。
- 支持关键词检索、下拉刷新、点赞切换。
- `explore_Card` 是同源数据的卡片化展示模式。
- `paper/detail` 集成论文详情、评论、收藏、阅读打点和 AI 阅读能力。

### 3) Projects

- 页面接口：`/projects/conferences`（GET/POST/PATCH/DELETE）。
- 本地计算 `deadline` 剩余天数并排序，过滤已过期会议卡片。
- 右上角“添加”按钮与卡片点击都进入同一编辑弹窗，支持新增/编辑/删除。
- 表单包含日期、进度、颜色主题、备注等字段校验。

### 4) Lab 工具页

同步工具：

- `AcademicPls`：输入限制 30-2000 字符；接口 `POST /lab/academic-pls`；支持最近记录 `GET/DELETE /lab/academic-pls/recent/*`。
- `Citations`：输入上限 500 字符；支持 `APA7/MLA9/CHICAGO/AUTO`；接口 `POST /lab/citations/format`；支持最近记录 `GET/DELETE /lab/citations/recent/*`。

异步工具（任务 + 轮询）：

- `DataViz`：上传 `csv/json/xls/xlsx`（最大 50MB）后创建任务并轮询结果，成功后渲染简化 Canvas 图表。
- `review_simulator`：上传 `pdf/txt/md`（最大 50MB）后创建任务并轮询，支持历史结果加载与删除。

### 5) Profile/profile_settings

- `profile` 展示用户信息与收藏论文（`/users/me/liked-papers`）。
- `profile_settings` 支持昵称编辑、徽章样式与文案、语言切换、头像压缩后转 base64 上传。
- 本地偏好 key：`profile_badge_preferences_v1`、`profile_local_preferences_v1`。

## 前端工程特征与注意点

- 认证错误处理逻辑在多个页面重复实现（可后续抽成公共 helper）。
- API 调用统一走 `request.js`，扩展新模块时建议沿用相同错误模型。
- 异步任务页面都使用“创建任务 + 轮询 + 超时失败”的统一范式。
- TabBar 使用自定义实现，页面布局需为底部导航预留安全区空间。

## 相关页面

- [系统架构](Architecture)
- [后端 API 参考](API-Reference)
- [快速开始](Quick-Start)
