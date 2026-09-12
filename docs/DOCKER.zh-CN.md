# Docker 与微信小程序上手教程

[中文](DOCKER.zh-CN.md) | [English](DOCKER.en.md) · [返回 README](../README.md)

## 1. 适用范围

本教程运行仓库现有的 **HTTP/SQLite 开发实现**，用于试用和联调，请使用测试家庭数据。服务端容器固定为 `linux/amd64`；手机端仍需微信开发者工具，Docker 不会构建或发布微信小程序，也不提供网页客户端。

`deploy/compose.dev.yaml` 是本教程的可构建入口；`deploy/compose.yaml` 是生产设计模板，仍需正式实现与现场验收。开发容器不安装备份任务，不提供恢复或媒体清理命令。正式目标中的 TypeScript/Fastify、目标 Linux 主机和微信发布验收仍须完成。

只用于可信家庭局域网。成员选择不是认证，能访问接口的人可能冒用成员；禁止公网映射、公网反向代理或隧道发布。

## 2. 准备环境与代码

在 Linux amd64 主机安装 Docker Engine 与 Compose v2，参见 [Docker 官方安装说明](https://docs.docker.com/engine/install/)。本机开发可使用运行 Linux 容器的 Docker Desktop，其结果不能替代目标 Linux 主机验收。

从 GitHub 仓库下载 ZIP 并解压，或使用该仓库 Code 按钮提供的克隆地址。进入同时包含 `Dockerfile`、`README.md` 和 `package.json` 的项目根目录。

```bash
docker version
docker compose version
```

Docker 服务端应报告 `linux/amd64`。首次构建需要访问 Docker Hub。运行服务容器不要求宿主安装 Node、Python 或 npm 依赖。

## 3. 构建并启动

```bash
docker compose -f deploy/compose.dev.yaml config --quiet
docker compose -f deploy/compose.dev.yaml up -d --build --wait
docker compose -f deploy/compose.dev.yaml ps
curl --fail http://127.0.0.1:3000/health/ready
```

健康接口应返回 `{"status":"ready"}`。首次数据库由开发实现创建；健康不代表家庭已初始化。`GET /api/system` 可查看 `initialized` 状态。访问 `/` 没有网页界面是正常情况。

默认仅绑定宿主机 `127.0.0.1:3000`，只能供同机工具访问。镜像在本地构建为 `diancai-dev:local`，不是已经发布到 Docker Hub/GHCR 的镜像。基础镜像在 `Dockerfile` 中固定到版本与实际 amd64 digest，构建会核对 Node 24、Linux amd64 和 SQLite >= 3.51.3。

服务以 UID/GID `10001:10001` 运行，根文件系统只读；使用 Docker 本地命名卷保存 `/data/current` 下的 SQLite、媒体和上传数据。默认卷名为 `diancai-dev_data`；改变 Compose 项目名会使用另一卷，看起来像一个新家庭。

## 4. 连接微信开发者工具

在宿主机项目根目录运行 `npm ci`（需 Node.js 24），然后用微信开发者工具打开整个根目录，**不要只打开 `miniprogram/`**。公共配置使用 `touristappid`；需要自己的微信项目能力时填写自己的 AppID，提交代码时保留占位配置。

同机开发者工具连接 `http://127.0.0.1:3000`，依次操作：

1. 连接家庭服务，创建测试家庭与成员。
2. 在公共菜品管理中新增分类下的菜品，填写做法并选择可选图片。
3. 返回点菜页，加菜并确认提交；同一道菜可形成多个独立事项。
4. 选择成员认领做菜、完成，再查看评价与历史。

成员选择只记录业务操作者。提交结果尚未确认时保留原提交意图，通过原 Key 核对/重试，不重复下单。

## 5. 用手机连接家庭 LAN

先复制示例：Linux/macOS 使用 `cp deploy/dev.env.example deploy/dev.env`；PowerShell 使用 `Copy-Item deploy/dev.env.example deploy/dev.env`。编辑 `deploy/dev.env`：

```dotenv
# 示例地址，必须换成 Linux 主机实际的家庭 LAN IPv4。
DIANCAI_BIND_IP=192.168.1.100
DIANCAI_PORT=3000
DIANCAI_DEV_IMAGE=diancai-dev:local
```

使用该配置启动测试服务（修改已运行服务的绑定会重建容器并短暂中断）：

```bash
docker compose --env-file deploy/dev.env -f deploy/compose.dev.yaml up -d --build --wait
docker compose --env-file deploy/dev.env -f deploy/compose.dev.yaml ps
```

手机和服务器在同一允许访问的家庭网络，在小程序中填写 `http://实际LAN地址:3000`。手机的 `127.0.0.1` 指手机自身。显式绑定 LAN IP 不等于已经限制来源网络，需要核对 Docker/防火墙后端，并实测非允许网络不可访问；仅看 UFW 规则不足以证明隔离。

微信开发配置关闭域名检查仅服务于联调。iOS/Android 真机网络、局域网权限、上传下载、弱网、关闭调试和正式发布行为须按 [开发与验收](05_开发与验收.md) 单独验证。`deploy/dev.env` 不提交到仓库。

## 6. 日常查看与停止测试服务

默认配置的命令：

```bash
docker compose -f deploy/compose.dev.yaml logs --tail=100 app
docker compose -f deploy/compose.dev.yaml stop
docker compose -f deploy/compose.dev.yaml start
docker compose -f deploy/compose.dev.yaml down
```

使用自定义环境文件时，上述每条命令都加上 `--env-file deploy/dev.env`，放在 `-f` 之前。`stop` 与 `down` 会停服；`down` 移除本项目容器与网络，但默认保留命名卷。不要增加 `--volumes`，否则会删除卷内数据。

重建容器会保留卷中数据，但启动应用会应用尚未执行的数据库迁移；新版本不应直接接管真实家庭库。正式升级须先取得维护授权并具有已验证的完整备份和恢复方案。普通容器重建不会产生新的数据代次，正式恢复必须产生新代次。

备份策略仍为北京时间每日 04:00 排他停服、保留最近 10 份成功包、每周至少一次异介质副本；**容器不会自动执行这些操作**。必须同时保护数据库与被引用原媒体，不能把仅复制 `app.db` 当成完整备份。详见 [部署与数据运维](04_部署与数据运维.md)。

## 7. 常见问题

| 现象 | 检查方法 |
|---|---|
| 无法连接 Docker daemon | 启动 Docker 服务，核对 Linux 容器模式 |
| 无法拉取基础镜像 | 检查 Docker Hub 网络与代理，不随意换成来源不明的镜像 |
| 端口被占用 | 在环境文件改 `DIANCAI_PORT`，小程序连接地址同步改端口 |
| 手机上连接失败 | 检查 LAN 绑定、真实 IP、同一网络、防火墙与微信接入要求 |
| 容器 unhealthy | 查看服务日志；健康状态不会单独触发 `restart: unless-stopped` 自动重启 |
| 数据库不可写 | 检查命名卷和 UID/GID；不要通过 root、特权容器或 `chmod 777` 绕过 |
| 重建后要求新建家庭 | 检查是否改变项目名、挂载卷或环境；不要立即创建另一个家庭 |
| SQLite 版本检查失败 | 记录实际版本并检查基础镜像；不要开启版本门槛绕过开关 |

## 8. 开发者验证

构建后可运行 `python tests/docker_smoke.py`（需要 Python 3）。脚本使用随机项目名、临时命名卷、随机本机端口和虚构数据，检查初始化、原图保存以及容器重建后的数据库/媒体持久化，最后只移除它自己创建的测试项目与卷。输出为 `tests/results/docker-smoke.json`，不会挂载真实家庭数据。

Docker、Compose 与镜像上下文用法参考 [Compose 官方文档](https://docs.docker.com/compose/) 和 [构建上下文文档](https://docs.docker.com/build/concepts/context/)，核对日期：2026-09-12。
