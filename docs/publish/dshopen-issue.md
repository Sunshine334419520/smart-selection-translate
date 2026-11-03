# dshopen.org 提交内容

提交入口：<https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml>

## 标题

```
[plugin-add] dsh-smart-selection-translate
```

## 插件地址

```
dsh-smart-selection-translate
```

（或 `https://github.com/Sunshine334419520/smart-selection-translate`）

## 简短说明

```
选中英文就地翻译的 DeepSeek Harness 插件：单词出词典条目（英/美音标、按词性分组的释义、网络释义、真人发音），句子走机器翻译。支持有道 / 必应双词典源、可切换触发方式与译文语言，卡片与设置页跟随宿主主题。
```

## 补充信息

```
npm：https://www.npmjs.com/package/dsh-smart-selection-translate （latest 0.1.2）
仓库：https://github.com/Sunshine334419520/smart-selection-translate （MIT）
截图：docs/screenshots/card-word.png、docs/screenshots/card-sentence.png
环境：Windows 11 + DSH Desktop 0.2.1-rc.3，27 项 Host 单测通过

说明：插件通过 patch 自带一行 @deepseek-ai/dsh-experimental-translator 作为翻译引擎（该包随 dsh 分发）；
官方「思考翻译」bundle 使用同一 row id，二者同时启用需二选一，README 已注明。
```
