# 参与贡献

欢迎提交可复现的问题、文档修正和范围明确的 Pull Request。先阅读 [README](README.md)、[产品规则](docs/01_产品规则.md)、[配置与决策](docs/06_配置与决策.md) 和修改目录的 `AGENTS.md`。

## 开发环境

使用 Node.js 24、npm 和 Python 3.12。微信客户端由微信开发者工具打开仓库根目录。正式服务交付仅面向 Linux amd64；在其他系统运行开发检查不代表支持该平台的生产交付。

```bash
npm ci
python -m venv .venv
```

Linux/macOS 激活环境：`source .venv/bin/activate`；Windows PowerShell：`.venv\Scripts\Activate.ps1`。然后安装检查所需依赖：

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
```

Python 依赖仅供现有检查与原型构建使用：PyYAML 解析 Compose，Playwright 执行浏览器检查，Pillow 生成预览。新增依赖须说明必要性并锁定版本。

## 验证修改

在项目根目录运行：

```bash
npm test
npm run typecheck
node --test tests/domain.test.cjs
python tests/schema_test.py
python tests/deployment_test.py
python tools/build_prototype.py
python tests/browser_test.py
python tools/build_previews.py
```

Docker 开发镜像检查需另备运行中的 Linux amd64 Docker 引擎及 Compose v2：先执行 `docker compose -f deploy/compose.dev.yaml build`，再执行 `python tests/docker_smoke.py`。脚本只对自行创建的临时项目和虚构数据执行容器重建及测试卷清理；说明见 [中文 Docker 教程](docs/DOCKER.zh-CN.md) / [English tutorial](docs/DOCKER.en.md)。

预览构建需要已安装的中文字体；没有 `fc-match` 的系统可传 `--font` 和本机中文字体的绝对路径。Linux CI 安装 `fonts-noto-cjk`。浏览器检查使用模拟数据，不能替代微信真机验收。测试会更新 `tests/results/` 和原型产物；提交时逐项检查，只保留与本次修改对应的证据，不能把旧报告当作新测试结果。

## 提交约定

- 一个 PR 解决一个具体问题，说明触发条件、修改后的行为和真实验证结果。
- 建议提交标题采用 `feat:`、`fix:`、`docs:`、`test:` 或 `chore:` 加简短说明。
- 改变行为时同步产品规则、接口、模型/DDL、交互及对应测试；优先约定跨目录契约。
- 保留批次幂等、事务内权限检查、历史快照、媒体引用和恢复代次等约束。
- 不提交家庭数据库、原图/录音、备份、私人配置、个人 AppID、密钥或带私人信息的截图/日志。示例使用虚构数据并明确标注。
- 保留第三方版权及许可证声明。教程、照片和其他素材须有相应使用与分发权限。

本项目不接受扩大到公网、多租户、Windows 服务、Redis 或微服务的改动。真实数据清理、恢复、发布、覆盖和停服需要明确执行授权。失败检查须如实说明，不删用例或放宽断言来制造通过。

## 贡献许可

本项目采用 [Apache License 2.0](LICENSE)。除非明确另行声明或有单独协议，有意提交并纳入本项目的贡献按该许可证第 5 条处理。提交前请确保有权提供相关代码、文档和素材，保留第三方声明。
