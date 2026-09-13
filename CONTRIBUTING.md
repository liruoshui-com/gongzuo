# Contributing

共作的目标是降低「完成真实任务」的总消耗，同时保留质量和用户自己的特点。

欢迎提交可重复的任务、错误复现、使用体验和改进代码。暂不把模型数量或功能数量当作进展指标。

## Local development

使用 Node.js 22 或更新版本，无需安装运行依赖。

```bash
npm start
npm run check
npm test
```

测试创建独立本机服务和 `test-results/` 数据，不需要真实 API 密钥。`npm test` 包含 CSV、模型协议、状态、用量、数据保存和故障路径。

## Browser acceptance

浏览器测试需要可用的 Playwright 包和 Chromium 浏览器。可使用你已有的安装：

```powershell
$env:PLAYWRIGHT_PATH = 'C:\path\to\node_modules\playwright'
$env:BROWSER_PATH = 'C:\path\to\msedge.exe'
node tests/browser-qa.cjs
```

Linux / macOS 使用对应环境变量语法和本机路径。运行结果和截图在 `test-results/browser-*`。浏览器测试仍使用模拟服务，不代表真实模型质量。

## A useful contribution

说明问题的触发条件、预期结果、实际结果，以及测试方法。若声称降低 token 或耗时，请附同模型、同材料、同工具条件的完整对照，包含失败和重试；参考 [验证方案](docs/benchmark.md)。

公开附件使用虚构或脱敏数据。不要提交 `.local-data/`、API 密钥、个人任务、第三方付费材料、运行截图中的私人内容或真实模型账单的敏感字段。

PR 应保持改动聚焦，并说明验证情况。对用户可见的变化请补充截图；界面标注应区分真实执行、模型建议和人工验收。
