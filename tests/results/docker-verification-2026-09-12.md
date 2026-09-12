# Docker 与双语文档验证

日期：2026-09-12。范围为当前工作区的开发 HTTP/SQLite 容器，包含已有未提交业务修改。

## 实测环境

- 宿主为 Windows Docker Desktop 4.52.0，服务端引擎是 Linux amd64。
- Docker Engine 29.0.1，Compose 2.40.3-desktop.1。
- 官方基础镜像：`node:24.16.0-bookworm-slim`。
- 实际 amd64 基础 digest：`sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f`，已固定于 Dockerfile。
- 容器查询结果：Node v24.16.0、SQLite 3.53.0、Linux x64、UID 10001、Asia/Shanghai。
- 本地构建镜像：`diancai-dev:local`，实际 image ID 见 `docker-smoke.json`；没有推送镜像仓库。

## 实际执行与结果

| 命令 | 结果 |
|---|---|
| `docker compose -f deploy/compose.dev.yaml config --quiet` | 通过 |
| `docker compose -f deploy/compose.dev.yaml build` | 通过；镜像构建核对实际 Node、平台和 SQLite 门槛 |
| `python tests/docker_smoke.py` | 通过；结果见 `docker-smoke.json` |
| `.venv/Scripts/python.exe tests/deployment_test.py` | 13 项通过；Windows 没有 systemd-analyze，1 项跳过 |
| Markdown 本地链接及工作流 YAML 检查 | 通过 |
| `git diff --check` | 通过 |

容器检查覆盖本机随机端口、临时项目归属、非 root/只读根/capabilities 配置、镜像内应用文件范围、未初始化健康探针、家庭初始化、引用原图字节、强制重建容器后家庭标识/代次/菜品/媒体持久化。使用虚构数据与自行创建的命名卷；检查结束只清理临时项目资源，没有挂载真实家庭数据。

中文 README 与英文 README 提供语言切换；中文和英文 Docker 教程覆盖同一开发配置、微信接入、LAN 设置、数据保留、停止与重建语义、维护边界及排错。英文文档明确客户端 UI 仍为中文，详细产品/API 规范仍为中文。

## 未覆盖

未执行独立目标 Linux 主机安装、真实 LAN 来源网络隔离、微信 iOS/Android/正式发布、真实数据迁移、备份、恢复和媒体清理。未在 GitHub 运行 CI。当前 Docker 容器封装开发实现，不完成 TypeScript/Fastify 生产目标，不自动安装每日备份任务。
