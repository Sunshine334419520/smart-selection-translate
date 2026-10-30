# 上架清单

三个市场/渠道的提交材料，按需取用。

## 1. 发布到 npm（两个市场的共同前提）

```bash
npm login
npm publish          # 包名 dsh-smart-selection-translate
```

发布前确认：

- `package.json` 里 **没有** `private: true`（已移除）；
- `engines.dsh` 已声明（`^0.2.0-rc.1`）；
- `dsh.bundle` 与 `cordis.patch.yml` 同在仓库根（两个市场都靠它判断可安装性）。

## 2. 可视化市场（dshmarket）

数据源是 `awesome-dsh-plugin/awesome-dsh-plugin`，**不是**市场仓库本身。

提 PR：新增一个文件 `data/plugins/Sunshine334419520__smart-selection-translate.yml`，内容直接取 [`awesome-entry.yml`](awesome-entry.yml)。

要求（他们写的）：

- 仓库 `package.json` 声明 `dsh.bundle` —— 满足；
- 有真实可用代码 —— 满足；
- 仓库**创建满 1 天** —— 仓库建于 2026-10-30，次日再提；
- 图标是 **GitHub 托管的位图** —— 用 `assets/icon-180.png`（raw 链接已写进 yml）。

## 3. 官方「发现」索引（dshopen.org）

开 issue：<https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml>

三个字段这样填：

| 字段 | 内容 |
|---|---|
| 插件地址 | `dsh-smart-selection-translate`（或仓库 URL） |
| 简短说明 | 选中英文就地翻译：单词出词典条目（音标、词性释义、网络释义、真人发音），句子走机器翻译。 |
| 补充信息 | 截图 `docs/screenshots/card-word.png`、`docs/screenshots/card-sentence.png`；测试环境 Windows 11 + DSH Desktop 0.2.1-rc.3 |

他们要求 **npm release + 公开仓库 + 许可证**，三项都已具备（MIT）。

## 4. 自建索引（立刻可用，不必等审核）

[`index.json`](index.json) 是可直接托管的 format-1 索引。放到 GitHub Pages / raw 之后，用户在 **发现 → 添加索引源** 粘贴地址即可搜到并一键安装。
