# 上架状态

| 渠道 | 状态 | 还需要什么 |
|---|---|---|
| npm | ✅ 已发布 `0.1.2` | — |
| 自建索引 | ✅ 已就绪（raw 地址可直接用） | 把地址发给用户，或加到「发现 → 索引源」 |
| 可视化市场（dshmarket） | ⏳ 待提 PR | 在 awesome-dsh-plugin 提一个文件 |
| 官方「发现」（dshopen.org） | ⏳ 待开 issue | 按模板填三个字段 |

## 1. npm（已完成）

`dsh-smart-selection-translate@0.1.2`，latest 指向 0.1.2。

```bash
npm view dsh-smart-selection-translate version   # 0.1.2
```

升级流程：改代码 → 改 `package.json` 的 `version` → `npm publish`。同一版本号不能重发。

## 2. 自建索引（现在就能用）

[`index.json`](index.json) 是合法的 format-1 索引，已指向 npm 上的 0.1.2（`publishTimestamp` = npm 的真实发布时间）。

raw 地址：

```
https://raw.githubusercontent.com/Sunshine334419520/smart-selection-translate/main/docs/publish/index.json
```

用法：**插件 → 发现 → 添加索引源**，粘贴该地址，即可在市场里搜到并一键安装。不需要审核、不需要 GitHub Pages。

## 3. 可视化市场（dshmarket）

数据源是 `awesome-dsh-plugin/awesome-dsh-plugin`，不是市场仓库本身。

提 PR：新增 `data/plugins/Sunshine334419520__smart-selection-translate.yml`，内容直接取
[`Sunshine334419520__smart-selection-translate.yml`](Sunshine334419520__smart-selection-translate.yml)。

要求核对：

- `package.json` 声明 `dsh.bundle` → ✅
- 有真实可用代码 → ✅
- 仓库创建满 1 天 → ✅（建于 2026-10-30）
- 图标是 GitHub 托管的位图 → ✅ `assets/icon-180.png`

## 4. 官方「发现」（dshopen.org）

开 issue：<https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml>

要填的文字见 [`dshopen-issue.md`](dshopen-issue.md)。他们会核对 npm release + 公开仓库 + 许可证，三项都已具备。
