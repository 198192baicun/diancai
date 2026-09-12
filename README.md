# 家庭点菜 · diancai 微信小程序

**中文** | [English](README.en.md)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

一起决定吃什么，认领做菜，再留下这顿饭的记录。

**当前状态：可本地联调的开发项目。** 生产镜像、停服维护命令和微信正式发布仍需实机验收。仅用于可信家庭局域网，禁止暴露公网；成员选择是业务归属，不是身份认证，能访问服务的人可能冒用成员。

![浏览器交互原型总览，非微信真机截图](prototype/screenshots/14_页面总览.png)

家庭局域网使用的原生微信小程序项目。仓库包含：

- `miniprogram/`：微信原生 WXML / SCSS / TypeScript 客户端，共 30 个页面；
- `server/`：可本地启动的 HTTP / SQLite 开发运行服务；
- `Dockerfile`、`deploy/compose.dev.yaml`：Linux amd64 开发容器与本地构建入口；
- `contracts/`：HTTP API 语义契约；
- `docs/`：产品、系统、交互、部署、验收与已确认配置；
- `prototype/`：交互原型，仅作设计参照，不参与正式客户端运行；
- `tests/`：领域、DDL、部署契约、服务集成和小程序静态检查。

## Docker 快速启动

安装 Docker Engine 与 Compose v2，使用 Linux amd64 容器引擎，在项目根目录运行：

```bash
docker compose -f deploy/compose.dev.yaml up -d --build --wait
```

默认仅监听宿主机 `http://127.0.0.1:3000`，健康接口为 `/health/ready`。这是现有 HTTP/SQLite 开发实现，数据保存在独立的 Docker 本地命名卷中；不会自动备份，也不提供网页客户端。首次构建需要访问 Docker Hub，当前没有发布到镜像仓库的应用镜像。

完整的微信连接、手机局域网配置、数据保留和排错步骤见 [中文教程](docs/DOCKER.zh-CN.md) / [English tutorial](docs/DOCKER.en.md)。Docker 启动和直接运行服务不要同时占用同一个宿主端口。

## 直接运行

### 1. 启动家庭服务

先安装 Node.js 24 与 npm。项目生产目标是 Linux `amd64`、Node.js 24、`Asia/Shanghai`。下载或克隆仓库后，进入包含 `package.json` 的根目录运行：

```bash
npm ci
npm run server:dev
```

默认监听：

```text
http://0.0.0.0:3000
```

开发数据默认写入：

```text
server/.local-data/current/
```

首次启动数据库为空是正常状态；小程序连接后会进入“创建家庭”初始化页。开发数据目录已加入 `.gitignore`，不会包含在交付包中。

> 服务端开发运行实现使用 Node 内置 HTTP 与 `node:sqlite`，用于直接联调 HTTP 契约和业务事务。设计中的正式生产目标仍要求 Node.js 24 / TypeScript / Fastify、`linux/amd64` 镜像，以及镜像内实际 SQLite `>= 3.51.3`。正式部署不得用开发环境版本结论替代生产验收。

### 2. 打开微信小程序

用微信开发者工具直接打开**本项目根目录 `diancai/`**。`project.config.json` 已设置：

```text
miniprogramRoot = miniprogram/
```

因此不要只打开 `miniprogram/` 子目录。

公共配置使用 `touristappid` 占位。需要自己的微信项目能力时，在开发者工具中配置自己的 AppID；提交前保持公共配置为占位值。`project.private.config.json` 是本机配置，不提交到仓库。占位配置不代表已取得真机或发布权限。

开发者工具联调默认服务地址为：

```text
http://127.0.0.1:3000
```

项目开发配置已关闭 URL 合法域名检查，方便开发者工具访问本机 HTTP 服务。启动后按页面流程：

```text
连接家庭服务 → 创建家庭 → 选择成员 → 首页
```

### 3. 真机访问局域网 Linux 服务

真机不能使用手机自身的 `127.0.0.1` 访问家庭服务器。在“连接家庭服务”中填写 Linux 主机的家庭 LAN 地址，例如：

```text
http://192.168.1.100:3000
```

手机与服务器必须位于允许访问的同一家庭网络。正式发布前仍需按 `docs/05_开发与验收.md` 验证微信网络规则、局域网授权、iOS / Android、上传下载、弱网和关闭调试后的行为；本仓库不把开发者工具可访问等同于正式发布验收。

直接运行 Node 服务时，默认 Host 白名单仅允许本机地址与实际监听端口。手机 LAN 联调须在启动前设置 `ALLOWED_HOSTS` 为实际 `IP:端口`（多个值用逗号分隔），例如 Linux 使用 `ALLOWED_HOSTS=192.168.1.100:3000 npm run server:dev`；示例 IP 必须替换。Docker 自动使用配置的绑定 IP 与发布端口。默认拒绝携带 Origin 的浏览器请求，确需浏览器联调时配置 `ALLOWED_ORIGINS`，详见 Docker 教程。原生无 Origin 请求无需此配置。

## 已实现业务范围

客户端与服务端覆盖家庭初始化、成员选择、今日菜单、菜品库、重复点同一道菜、独立备注、批次幂等提交、提交结果待确认、认领/取消认领/完成/取消、往日未完成、历史复点、评价、家庭投票、公共菜品、成员/分类管理、家庭设置、原文件上传/展示/下载等首期流程。

关键语义包括：批次发送前先持久化提交凭据；结果未知时只允许使用同一 Key、同一载荷、同一成员/服务实例/数据代次核对和重试；成员切换后的迟到响应不会覆盖另一成员草稿；服务恢复导致数据代次变化时旧意图不自动补送；菜单事项保留点菜时快照；取消项不进入有效进度和评分；评价按成员、菜品和菜单业务日期唯一且提交后不可修改；投票允许每位成员多选并按参与成员去重；往日终态事项按原日期自动归档；每轮投票最多生成一个菜单事项；媒体上限固定为 52,428,800 字节并保存原字节。

## 检查命令

在项目根目录可执行：

```bash
npm test
npm run typecheck
node --test tests/domain.test.cjs
python3 tests/schema_test.py
python3 tests/deployment_test.py
```

其中 `npm test` 包含服务端 HTTP 集成检查和小程序静态契约检查。TypeScript 类型检查依赖项目声明的开发依赖；微信实际编译仍以微信开发者工具为准。

Python 检查依赖、虚拟环境和完整原型检查步骤见 [贡献指南](CONTRIBUTING.md)。GitHub Actions 配置见 [.github/workflows/checks.yml](.github/workflows/checks.yml)，覆盖 Node 测试、类型检查、数据库与部署契约、浏览器和预览构建；具体结果以对应运行记录为准。

## 文档导航

- [Docker 与微信上手教程（中文）](docs/DOCKER.zh-CN.md) · [Docker and WeChat tutorial (English)](docs/DOCKER.en.md)
- [产品规则](docs/01_产品规则.md) · [系统与数据设计](docs/02_系统与数据设计.md) · [交互设计](docs/03_交互设计.md)
- [部署与数据运维](docs/04_部署与数据运维.md) · [开发与验收](docs/05_开发与验收.md) · [配置与决策](docs/06_配置与决策.md)
- [HTTP API](contracts/http-api.md) · [交互原型说明](prototype/README.md)
- [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可证

本项目原创代码与文档采用 [Apache License 2.0](LICENSE)。第三方组件、数据与素材适用各自的许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

`package.json` 中的 `private: true` 用于防止意外发布到 npm，不影响本项目开源。

## 生产边界

`deploy/compose.yaml`、备份策略与运维文档保留已确认的唯一 Linux `amd64` 部署路线。当前交付包不包含已经在目标 Linux 上验收的生产镜像、停服备份/恢复/媒体清理维护命令，也不包含微信 iOS/Android 真机与正式发布证据。这些必须在实际设备和目标主机上完成，不能由本地测试结果代替。


## 菜谱编辑与教程导入

“我的 → 我的待做”集中查看自己认领的未完成事项；“我的 → 菜谱编辑草稿”继续编辑本机草稿。草稿按成员与家庭隔离，保存公共菜谱后移除，也可在列表中确认删除。

“我的 → 导入图文教程”可尝试读取小红书公开图文，或选择已保存的教程图片与原文，先放入草稿再核对保存。链接导入仅支持小红书，不支持抖音。系统 DNS 返回特殊地址或解析失败时，使用固定地址的 HTTPS DNS 回退，仍只连接校验后的公网地址；平台限制或网络不可达时可使用图片导入。图片文字不自动识别。


## 成果与家庭互动

点菜页支持数量增减与随机选菜；随机结果确认后进入普通草稿、提交和认领流程。做菜完成时可保存成品照片、心得与语音，历史中保留本次成果。评价展示实际北京时间，图片支持点击放大。

投票收齐当前启用成员后自动停止收票；并列由发起人选定。每轮保留历史并在停收后公示投票成员及备注。语音支持菜品介绍、点菜备注、认领、完成、评价与投票。“我的”提供头像选择/上传、历次投票与家庭统计。分页列表触底加载，每页10条。

数据库通过 `003_family_experience.sql` 升级到 schema 3，生产库升级须在明确授权的维护流程中执行；本地测试仅使用临时库。小红书配图按最多三路并发读取并保持顺序；平台访问限制仍可能使导入不可用，可改用已保存图片导入。
