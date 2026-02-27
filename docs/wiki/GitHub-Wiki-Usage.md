# GitHub Wiki 使用指南

## 1. 什么是 GitHub Wiki

GitHub Wiki 是仓库附属的文档站点，适合放使用手册、运维手册、FAQ、设计说明。

每个仓库 Wiki 实际上是一个独立的 Git 仓库：

- 主仓库：`<repo>.git`
- Wiki 仓库：`<repo>.wiki.git`

## 2. 开启 Wiki

1. 打开仓库页面。
2. 进入 `Settings` -> `Features`。
3. 勾选 `Wikis`。
4. 回到仓库顶部点击 `Wiki` 标签。

## 3. 在线编辑方式

1. 在 `Wiki` 页面点击 `Create the first page`。
2. 创建 `Home` 页面。
3. 后续点击 `New Page` 新建内容。
4. 使用 Markdown 编写并保存。

## 4. 用 Git 管理 Wiki（推荐）

```bash
# 1) 克隆 wiki 仓库
git clone https://github.com/<owner>/<repo>.wiki.git
cd <repo>.wiki

# 2) 拷贝本项目 docs/wiki 页面
# 例如把 Home.md、Architecture.md 等复制进来

# 3) 提交并推送
git add .
git commit -m "docs: initialize project wiki"
git push
```

## 5. Wiki 页面组织建议

- `Home.md`：入口页
- `_Sidebar.md`：左侧导航
- 按主题拆分页面：Quick Start / API / Troubleshooting

## 6. 把本项目现有 wiki 草稿同步到 GitHub

本仓库已准备好：`docs/wiki/`。

你可以按以下步骤同步：

1. 克隆 `<repo>.wiki.git`
2. 复制 `docs/wiki/*.md` 到 wiki 仓库根目录
3. 提交并推送
4. 在 GitHub Wiki 页面确认导航和链接

## 7. 常见问题

### Q1: Wiki 支持 PR 审核流程吗？

Wiki 仓库是独立仓库，通常直接推送。若需要 PR 审核，建议在主仓库 `docs/` 维护，再定期同步到 wiki。

### Q2: 图片怎么放？

可将图片放到 Wiki 仓库内并使用相对路径，或使用外部图床。
