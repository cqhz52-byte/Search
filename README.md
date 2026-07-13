# 文献证据工作台

免费额度优先的文献检索、PDF 解析任务管理、证据提取与资源释放 PWA。

## 本地预览

```powershell
python -m http.server 5179 -d public
```

打开 `http://127.0.0.1:5179/`。

## Cloudflare 部署

1. 在 Cloudflare 创建 D1、KV、R2。
2. `wrangler.toml` 已配置生产绑定：
   - D1 database：`LIT_DB` -> `lit-db`
   - R2 bucket：`LIT_R2` -> `lit-r2`
   - 可选 KV namespace：`RESEARCH_AUTH_KV`
   - 可选 Queue：`LIT_QUEUE`
3. 执行 D1 migration：

```powershell
wrangler d1 migrations apply LIT_DB --remote
```

4. 通过 GitHub 连接 Cloudflare Pages，构建输出目录使用 `public`。

首次登录的账号会自动成为超级管理员。

说明：用户、项目、题录、任务和 session secret 都可以存 D1。KV 只是可选的 session secret 存储，不配置也能运行。
