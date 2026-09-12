# 开源整理检查记录

日期：2026-09-12。范围为当前工作区，包含开始整理时已存在的未提交业务修改；不代表已提交版本、GitHub Actions 运行或生产发布验收。

## 环境

- Windows，Node.js 24.16.0，Python 3.12.10，Python SQLite 3.49.1。
- Python 检查使用仓库 `.venv`，依赖版本见 `requirements-dev.txt`。
- Playwright 1.55.0，Chromium 140.0.7339.16。
- 预览使用本机 Microsoft YaHei 字体，未分发字体文件。

## 实际执行

| 命令 | 结果 |
|---|---|
| `npm test` | 45 项通过 |
| `npm run typecheck` | 通过 |
| `node --test tests/domain.test.cjs` | 29 项通过 |
| `python tests/schema_test.py` | 26 项通过，临时 SQLite 数据库 |
| `.venv/Scripts/python.exe tests/deployment_test.py` | 13 项通过，1 项因没有 systemd-analyze 跳过 |
| `python tools/build_prototype.py` | 通过，生成 90,319 字节 HTML |
| `.venv/Scripts/python.exe tests/browser_test.py` | 23 项通过，无页面异常；原型模拟数据 |
| `.venv/Scripts/python.exe tools/build_previews.py --font C:/Windows/Fonts/msyh.ttc` | 通过，16 张截图索引和总览；已目视检查总览 |
| `git diff --check` | 通过 |

工作流 YAML 已本地解析，并核对触发器、只读权限及 15 个步骤。GitHub Actions 尚未在远程运行；未执行 Linux systemd 日历解析、Docker 部署、停服、备份、恢复或微信真机验收。

## 仓库检查

已补齐贡献指南、安全说明、第三方声明、Issue/PR 模板、编辑与换行配置、固定版本的 Python 检查依赖、CI 配置及被引用的运维和决策文档。13 个乱码截图文件名已纠正，浏览器重新生成 16 张截图并构建预览。Markdown 本地链接检查无缺失目标。

部署检查 D03 改为 UTF-8 读取中文配置；D11 原先断言缺失文档中的历史选项编号，现在逐项断言有来源的当前业务与部署决定，并保留 10 个目录协作文件及其余检查。没有编造历史编号或改变备份/平台业务规则。

常见凭据模式检查覆盖 2 次 Git 提交、331 个不同 Git blob，以及当前受跟踪和未忽略的文本文件；未读取运行数据或私人配置，也未输出匹配值。当前文件无模式匹配；历史两份小程序配置包含原 AppID。AppID 不是密钥，当前配置已改为占位值，但历史未重写。该检查仅覆盖常见私钥、GitHub/OpenAI 令牌和 AppID 模式，不是完整秘密检测或素材权利审计。

所有者已选择 Apache-2.0。根目录 LICENSE 使用 Apache 官方完整文本；README、贡献指南、package.json 与 package-lock.json 已同步许可信息，第三方许可独立保留。该文档与元数据修改经一致性和差异空白检查，没有重跑业务测试。没有配置 Git 远程、提交、推送或修改 GitHub 仓库可见性。
