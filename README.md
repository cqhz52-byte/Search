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

## 文献处理流程

系统按免费额度友好的 7 步流水线执行：

1. AI 扩充检索内容：扩展 PICO、同义词、MeSH/关键词和布尔逻辑。
2. 检索摘要：按小批量检索题录与摘要，只保存必要元数据。
3. AI 分析摘要：根据纳入/排除标准聚焦到候选文献。
4. 生成下载列表：整理 DOI、PMID、开放全文入口和失败待办。
5. 开始下载全文：仅下载开放或已授权来源，避免反复重试。
6. 解析全文并 AI 分析：优先抽取可复制文字的开放全文 XML/PDF 文本，DeepSeek 负责结构化提取；扫描版或无法抽取文本时再考虑 OCR/人工处理。
7. 生成分析结果：输出证据表、限制说明和结论草稿。
