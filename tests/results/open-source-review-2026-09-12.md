# 第二轮开源审查

日期：2026-09-12。审查范围为当前开发版源码、既有未提交客户端改动、Docker 开发配置、双语上手文档、许可和拟公开文件。结论：本轮未发现阻止以开发项目身份开源的问题；不构成无缺陷保证或生产验收。

## 检查结果

| 检查 | 实际结果 |
|---|---|
| `npm test` | 45 项通过 |
| `npm run typecheck` | 通过 |
| `node --test tests/domain.test.cjs` | 29 项通过 |
| `.venv/Scripts/python.exe tests/schema_test.py` | 26 项通过 |
| `.venv/Scripts/python.exe tests/deployment_test.py` | 13 项通过，1 项因 Windows 没有 systemd-analyze 跳过 |
| `.venv/Scripts/python.exe tools/build_prototype.py` | 通过 |
| `.venv/Scripts/python.exe tests/browser_test.py` | 23 项通过，无页面异常 |
| `.venv/Scripts/python.exe tools/build_previews.py --font C:/Windows/Fonts/msyh.ttc` | 通过 |
| `docker compose -f deploy/compose.dev.yaml config --quiet` | 通过 |
| `python tests/docker_smoke.py` | 通过；临时项目初始化、引用原图和跨容器重建持久化正常 |
| `npm audit --json` | 本次 npm 审计返回 0 个已知漏洞；不覆盖容器 OS 与 Python 依赖 |
| Markdown 本地链接、Apache-2.0 元数据、`git diff --check` | 通过 |

## 公开内容与审查边界

候选文件没有数据库、原始家庭媒体、私人微信配置、密钥文件或超过 50 MiB 的文件。常见私钥、GitHub/OpenAI 令牌及个人 AppID 模式扫描没有命中当前候选文本；这是有限模式扫描，不是完整安全或素材版权审计。

复核了已修改客户端的头像迟到响应、草稿删除作用域保护，服务批次与权限相关实现，以及开发 Docker 的持久化、非 root、只读根、版本门槛和构建上下文。开发版与生产模板在中英文文档中明确区分。Apache-2.0 不覆盖第三方的独立许可。

公开仓库使用清理后的当前内容作为起始版本，原有开发历史保留在本地，避免将历史 AppID 带入公开提交。真实 Linux 现场网络隔离、微信真机及发布、TypeScript/Fastify 生产实现、备份恢复和媒体清理仍按验收文档另行完成。
