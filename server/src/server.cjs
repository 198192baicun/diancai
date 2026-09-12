'use strict';

const { createApp } = require('./http.cjs');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const app = createApp();

app.server.listen(port, host, () => {
  console.log(`家庭点菜服务已启动：http://${host}:${port}`);
  console.log(`数据目录：${app.database.dataRoot}`);
  console.log(`SQLite：${app.database.sqliteVersion}`);
});

function shutdown(signal) {
  console.log(`${signal}: 正在停止服务`);
  app.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
