# 可复现的任务与上下文测量

默认不调用模型，不查找环境变量或已有应用密钥。真实运行需要明确的 `--live`，并在终端通过不回显输入提供自己的 DeepSeek 官方 API Key。密钥只在内存中，不保存在实验文件里。

```sh
npm test
npm run benchmark -- --out test-results/dry-run
npm run benchmark:context -- --out test-results/context-results.json
```

真实任务每阶段最多 4 次模型请求、4,096 输出 token、24,000 总 token 软限。两组使用相同工具和条件，只改变材料及已有成果正文是否放入起始上下文。每题先做初版，再接受固定修改。所有调用和失败都计量；达到限制时保留成果和停止原因。

```sh
node benchmarks/run.mjs --live --max-cny 4 --max-requests 48 --out test-results/my-pilot
```

`--max-cny` 是按照记录价格设置的客户端保守预留，不是服务商账户的硬额度；未知返回用量后停止。开始前应查看脚本中 `prices` 的核对日期与官方价格，设置适合自己的预算，不应在价格变化后沿用旧价。缓存只作为输入明细，推理只作为输出明细，均不重复加到总 token。

产品检查需要另外安装 Playwright 并准备 Chromium 或 Edge，再显式提供路径：

```sh
node benchmarks/run.mjs --live --max-cny 4 --max-requests 48 --out test-results/my-browser-pilot --playwright /path/to/node_modules/playwright --browser /path/to/chromium
```

没有浏览器时，产品功能标记为未测，不能视作通过。浏览器在临时本地 HTTP origin 中操作生成的 HTML，拦截外部资源；检查新增、历史日期、刷新保存、删除与修改后的标签筛选。精确可访问名称属于预先约定的自动检查规则，失败原因需结合成果解释。

输出包括材料快照与独立真值、逐请求用量、版本与哈希、每阶段成果、自动检查、执行耗时及验证耗时。`data/workspace.json` 是该次合成任务的隔离工作区，独立于应用的 `.local-data`。

公开数据、人工复核和方法限制见 [首轮结果](../docs/benchmark.md)。测试任务及上下文案例均为合成数据。默认 `npm test` 仅使用本地模拟服务；本文的真实运行命令才会计费。
