# GitHub Wiki 使用指南

## 1. 先区分两种链接

`raw.githubusercontent.com/wiki/.../*.md` 是 Markdown 源文件地址，只会显示源码，不会渲染。

请使用以下渲染地址：

- Wiki 首页：`https://github.com/bmh201708/ResearchPilot/wiki`
- 指定页面：`https://github.com/bmh201708/ResearchPilot/wiki/Quick-Start`

## 2. GitHub Wiki 的本质

每个仓库的 Wiki 都是独立 Git 仓库：

- 主仓库：`<repo>.git`
- Wiki 仓库：`<repo>.wiki.git`

因此推荐把 Wiki 当成“可版本化文档站点”来维护。

## 3. 开启与在线编辑

1. 打开仓库 `Settings -> Features`，勾选 `Wikis`。
2. 进入 `Wiki` 标签页，创建首页 `Home`。
3. 使用 `New Page` 新建页面并保存。

## 4. 推荐工作流: 主仓库维护 + Wiki 同步

本项目约定在主仓库维护 `docs/wiki/*.md`，再同步到 `.wiki.git`。

```bash
# 克隆 wiki 仓库
git clone https://github.com/<owner>/<repo>.wiki.git
cd <repo>.wiki

# 从主仓库拷贝页面
cp -R /path/to/repo/docs/wiki/* .

# 提交并推送
git add .
git commit -m "docs: sync wiki pages"
git push
```

## 5. 页面组织建议

- `Home.md` 作为统一入口页。
- `_Sidebar.md` 作为全局左侧导航。
- 内容页按主题拆分：`Quick-Start`、`Architecture`、`API-Reference`、`Troubleshooting`。

## 6. 链接写法建议

- 内部链接使用 `[标题](Quick-Start)`，不要写成 raw URL。
- 尽量不用 `.md` 后缀，保持页面跳转稳定。

## 7. FAQ

### Q1. Wiki 支持 PR 流程吗？

Wiki 仓库通常直接推送；若你需要 PR 审核，建议先在主仓库 `docs/wiki` 提交 PR，再由维护者同步到 Wiki。

### Q2. 图片怎么放？

可放在 Wiki 仓库内并使用相对路径引用，或使用外部图床链接。
