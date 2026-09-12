# 小红书教程导入检查

环境：Windows 开发工作区，Node v24.16.0，Python 3.12.10。

## 实际网络读取

- 系统 DNS 对 xhslink.cn 返回 198.18.4.54，属于被禁止连接的特殊地址。
- HTTPS DNS 回退取得公网地址 118.195.253.242；连接保留目标域名的 TLS 校验并固定已检查地址。
- 使用真实 openPublic 与 parseNote 读取 https://xhslink.cn/o/AQkLjy02F52，取得正文 791 个 UTF-16 代码单元、10 张配图。
- 10 张配图均完整读取至内存，字节数依次为 284801、210194、303310、271517、256478、275729、260282、293933、179035、260480。
- 此检查没有写入家庭数据库，没有创建公共菜品，没有验证微信真机保存或目标 Linux 部署。

## 自动检查

- `npm test`：36 项通过，0 失败；包含 Fake-IP 回退、回退结果仍拒绝私网与保留地址、抖音链接及配图拒绝测试，以及临时数据库导入原字节保存测试。原始输出见 xiaohongshu-tests.txt。
- `npm run typecheck`：通过。
- `node --test tests/domain.test.cjs`：29 项通过。
- `python tests/schema_test.py`：25 项通过。
- `python tests/deployment_test.py`：未能执行，当前 Python 缺少 PyYAML；没有尝试部署。
- 原型未修改，未运行原型构建、浏览器和预览检查。

## 外部接口依据

HTTPS DNS JSON 请求与响应字段参照 [Cloudflare 官方文档](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)，检索日期 2026-09-11。回退查询仅发送平台或图片域名，不发送分享路径、正文或家庭数据。网络无法访问解析服务或平台限制公开内容时，导入仍会明确失败并保留图片导入入口。
