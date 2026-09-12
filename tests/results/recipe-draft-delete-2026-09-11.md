# 菜谱编辑草稿删除验证

环境：Windows，本地 Node.js 与项目锁定的 TypeScript；客户端使用模拟 Page、wx 和内存存储，无真实家庭数据操作。

- `node --test tests/review-regressions.test.cjs tests/miniprogram-static.test.cjs`：29 项通过，0 失败。
- `npm run typecheck`：通过。
- 删除回归覆盖新菜草稿、已有菜品草稿、取消确认、存储失败、确认期间切换上下文、其他成员草稿保留、删除最后一份与重新进入列表。

未执行微信开发者工具和真机交互验收；仍需在微信中检查删除确认、按钮触控和空状态显示。
