# HTTP 安全回归验证

日期：2026-09-12。范围为开发 HTTP 服务、Host/Origin 配置、媒体传输及临时 Docker 开发容器，不是目标 Linux 主机或微信真机验收。

## 实测结果

| 检查 | 结果 |
|---|---|
| `npm test` | 48 项通过，包含3项新增 HTTP 回归测试 |
| `npm run typecheck` | 通过 |
| `node --test tests/domain.test.cjs` | 29 项通过 |
| `python tests/schema_test.py` | 26 项通过，临时数据库 |
| `.venv/Scripts/python.exe tests/deployment_test.py` | 13 项通过，1 项因 Windows 无 systemd-analyze 跳过 |
| `docker compose -f deploy/compose.dev.yaml config --quiet` | 通过 |
| `docker compose -f deploy/compose.dev.yaml build` | 独立测试镜像 diancai-review-fix:20260912 构建通过 |
| `python tests/docker_smoke.py` | 同一独立测试镜像通过初始化、随机宿主端口访问、健康检查、原字节及重建持久化验证，详见 docker-smoke.json |

默认 Python 执行部署检查因缺少 PyYAML 未完成；使用项目已有 .venv 重跑通过，没有安装新依赖。Docker 构建与验证均显式设置 `DIANCAI_DEV_IMAGE=diancai-review-fix:20260912`，使用测试脚本创建并清理的独立项目和临时卷。

## 回归覆盖

- 任意域名、伪装本机域名、错误端口被拒绝；默认空 Origin 白名单拒绝普通、null、空串 Origin 和非允许预检，原生无 Origin 请求可用。
- 明确配置的 LAN Host 与映射端口可用；指定浏览器来源可预检且返回对应 CORS 头，后缀伪装来源被拒绝。
- 回环健康 GET 可用，业务接口、错误 Host 与非 GET 不获得探针例外；显式空 Host 列表拒绝业务请求。
- 模拟 EIO 使媒体展示与下载传输失败，文件流关闭且服务健康接口继续可用；客户端取消下载关闭流，随后原文件可完整下载。

EIO 为临时服务内故障注入，不是物理磁盘故障实测。未执行浏览器 DNS 重绑定攻击链、微信真机接入、真实家庭服务停服或生产发布。数据库结构与客户端业务意图未变更。
