# Memento — AI 贴纸手帐

把照片里的小物件做成贴纸，收进一本可以自由拼贴、数据留在本地的数字手帐。

当前生产回滚入口仍保留在 [Vercel](https://memento-sticker-journal.vercel.app)；Cloudflare Workers 预览验收通过后再切换主地址。

## 技术栈

- Node.js 24 LTS、React 19.2、React Router 8、TypeScript 6
- Vite 8、Tailwind CSS 4、shadcn/ui CLI v4（new-york + Radix）
- Dexie 4、Zod 4
- Vitest、React Testing Library、Playwright、axe
- Cloudflare Vite Plugin、Workers Static Assets、Module Worker

一个 Worker 同时发布 SPA 静态资源和 `/api/cutout`。项目不依赖 Next.js、Vercel Function、Upstash 或阿里云 Node SDK。

## 本地开发

需要 Node.js 24：

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

`.dev.vars` 只用于本地，已被 Git 忽略。未配置阿里云凭据时，界面和本地数据功能可正常使用，抠图接口返回 `503`。

常用命令：

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e
npm run build
npm run check:cloudflare
```

## 数据与迁移

新版使用 `memento-journal-react` Dexie 数据库，图片 Blob 与业务元数据分离。首次启动会在同一 Origin 内尝试读取旧的 `memento-journal` IndexedDB 和 `memento-journal-v2` localStorage；迁移成功前不会删除旧数据。

Vercel 与 Workers 地址属于不同 Origin，浏览器不能自动跨域读取 IndexedDB。迁移步骤是：

1. 在旧 Vercel 站导出 v1 备份。
2. 在 Cloudflare 站点击“导入 v1 备份”。
3. 新版校验备份后，经二次确认写入 Dexie。
4. 核对贴纸、手帐、页面与图片后再把 Cloudflare 地址设为主入口。

新导出格式为 v2，同时继续支持导入 v1。当前没有账号或云同步；`SyncAdapter` 与变更日志已预留，未来可接 D1 元数据和 R2 图片。

## `/api/cutout`

```text
POST /api/cutout
Content-Type: multipart/form-data
image: JPEG | PNG | WebP，最大 3 MiB
```

成功返回 `200 image/png`、`Cache-Control: no-store` 和 `X-Cutout-Source: alibaba-cloud`。错误响应包含用户信息和稳定 `code`。Worker 会验证 MIME 与文件签名，限制输出为 6 MiB，并对上传、分割和下载分别设置超时。

Cloudflare Rate Limiting binding 按不可逆 IP 摘要限制为每 60 秒 8 次。日志只记录 request ID、耗时、状态与字节数，不记录图片、原始 IP、凭据或完整上游 URL。

## Cloudflare 配置与发布

首次部署前写入 Secrets：

```bash
npx wrangler secret put ALIBABA_CLOUD_ACCESS_KEY_ID
npx wrangler secret put ALIBABA_CLOUD_ACCESS_KEY_SECRET
npx wrangler secret put RATE_LIMIT_SALT
```

预览与生产命令：

```bash
npm run deploy:preview
npm run deploy
```

Workers Builds 连接 GitHub 后使用：

- Production branch：`main`
- Build command：`npm ci && npm run build`
- Deploy command：`npx wrangler deploy`
- 非生产分支：`npx wrangler versions upload`

生产 Worker 名称为 `memento-sticker-journal`。发布后至少保留 Vercel 版本 7 天；回滚只需恢复旧站对外链接，不删除 Cloudflare 部署历史或本地数据。

## 项目结构

```text
src/app/             路由布局与数据 Provider
src/pages/           贴纸库、手帐列表与编辑器
src/components/      Memento 组合组件与 shadcn/ui
src/data/            Dexie、迁移、备份、repository、同步边界
src/domain/          Zod 模型与编辑历史
worker/index.ts      Cloudflare Worker 与阿里云 Web Crypto 调用
public/_headers      CSP 与静态安全响应头
tests/unit/          数据、编辑历史与 Worker 单元测试
tests/e2e/           手机与桌面 Playwright 全流程测试
wrangler.jsonc       Static Assets、限流与 Observability
```

## 第三方许可

撕贴纸预览按需加载 [Sticker Forge](https://github.com/CatsJuice/sticker-forge)，采用 MIT 许可；完整许可证随静态资源发布于 `public/vendor/STICKER_FORGE_LICENSE.txt`。`html2canvas` 通过 npm 动态导入，只在导出页面时加载。
