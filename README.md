# Memento — AI 贴纸手帐

把照片里的小物件做成贴纸，收进一本可以自由拼贴、支持本地离线副本与账号云同步的数字手帐。

项目协作规则见 [AGENTS.md](AGENTS.md)，指令审计结果见 [审计记录](docs/instruction-audit.md)。

## 技术栈

- Node.js 24 LTS、React 19.2、React Router 8、TypeScript 6
- Vite 8、Tailwind CSS 4、shadcn/ui CLI v4（new-york + Radix）
- Dexie 4、Zod 4
- Vitest、React Testing Library、Playwright、axe
- Cloudflare Vite Plugin、Workers Static Assets、Module Worker

一个 Worker 同时发布 SPA 静态资源、抠图、AI 识别与分组建议、账户及同步 API。项目不依赖 Next.js、Vercel Function、Upstash 或阿里云 Node SDK。

## 产品结构与设计细节

### 产品定位

Memento 是一款“把眼前的小物收进手帐”的移动优先应用：用户拍摄或选择照片，通过云端抠图和可配置的 AI 识别生成贴纸；得到带白色描边的贴纸后，用户在自己的手帐页中移动、旋转、缩放和叠放它。产品把照片处理、收藏、拼贴和回顾组织为一条连续、轻量的路径，而不是一个通用图片编辑器。

### 信息架构

```text
登录 / 注册（邀请码）
└─ 贴纸库 /                         首页
   ├─ 搜索、分组筛选、重新下坠
   ├─ 贴纸详情：改名称 / 分组、删除、放进手帐
   ├─ 新建贴纸：相机 / 相册 → 云端抠图 → 描边预览 → 保存
   └─ 使用帮助

手帐列表 /journals
└─ 手帐编辑器 /journals/:journalId
   ├─ 页面文字
   ├─ 画布贴纸：拖拽、任意角度旋转、缩放、层级、删除
   ├─ 撤销 / 重做、翻页 / 新增页
   ├─ 贴纸底栏
   └─ 导出当前页面 PNG
```

全局底部导航只在贴纸库和手帐列表显示：左侧进入贴纸库，中间为新增贴纸，右侧进入手帐列表。帮助、搜索、贴纸详情、新建手帐、编辑文字和确认删除均为就地 Dialog 或底部 Sheet，不改变主路由。账户状态提供同步状态、手动同步和退出入口。

### 核心体验

1. **收集**：从相机或相册选 JPEG、PNG、WebP；客户端先压缩，再以 `multipart/form-data` 上传到 `/api/cutout`。
2. **做成贴纸**：抠图结果先进入“可剥离”预览；用户命名、分组并在 1–10px 范围内调节白色描边后保存。
3. **浏览与管理**：贴纸按创建时间排列，可搜索、按分组过滤。每次打开或点击重放按钮，贴纸会以重力下坠的方式落到容器底部；动画结束后保留物理落点，不切换成规则网格。
4. **拼贴**：从编辑器底部贴纸栏加入页面。选中后可以直接拖动；右下角旋转把手支持拖到任意角度，键盘左右方向键可作 1° 微调（`Shift` 为 15°）。工具条提供缩放、前后层级和删除。
5. **留存与恢复**：页面支持最多 30 步贴纸历史的撤销/重做和 PNG 导出；登录账号会自动同步到云端。

### 视觉与动效系统

- **基调**：内容型浅色纸张，暖米白背景、深可可文字、低饱和陶土/金色强调，不提供默认深色模式。
- **排版**：品牌、页面标题和手帐文字使用 Georgia 衬线字体，导航、说明和表单使用 Geist；大标题紧凑、辅助文字克制。
- **材质**：半透明圆角导航和 Sheet、柔和阴影、纸张纹理（点阵、横线、日历、账本、撒点）、书脊封面和遮蔽胶带让界面保持手作感。
- **贴纸**：默认和上传贴纸都以统一视觉尺寸呈现；上传抠图使用可调白色轮廓与投影，避免普通方形图片卡片的观感。
- **运动**：贴纸库的下坠带有碰撞、弹性和有限的角速度衰减；落稳即停止持续旋转。`prefers-reduced-motion` 会显著缩短动画。

### 响应式与可访问性

- 以 **320px** 为最小支持宽度，应用壳在宽屏下最多 430px，保留移动端单手使用的画布比例与底部主操作。
- 贴纸容器使用基于 `svh` 的弹性高度：正常视口在 300–620px 间伸缩；高度不超过 720px 时进一步压缩为 270–400px，并为固定底部导航留出安全空间。贴纸更多时在容器内部纵向滚动，不会被裁切或被导航遮住。
- 分组筛选和编辑器贴纸栏采用横向滚动；窄屏收紧标题、内边距与控件尺寸；旋转或改变屏幕方向时会重新测量贴纸下坠区域。
- 所有主要操作均有可见标签或 `aria-label`；Dialog/Sheet 由 Radix 管理焦点和 Escape 关闭。旋转也支持键盘操作，端到端测试包含 axe 的 serious/critical 检查。

### 数据与隐私边界

浏览器的 Dexie / IndexedDB 是每个账号的离线副本，图片 Blob 与业务数据分开保存。联网后，结构化记录同步到 D1，图片同步到私有 R2；启动同步合并云端记录，不清空本地待上传修改。远端图片下载并验证后会保存为本地 Blob；原图仅在重新抠图时按需下载并缓存。

网络不可用时，已加载的应用可继续使用本地副本，并在下次联网或手动点击同步时重试。会话检查遇到网络故障时，可用上次验证过的账号身份打开该账号本地库；这不是云端鉴权凭据。明确的会话失效或退出会清除该身份缓存，保留账号本地数据库。本项目不提供 Service Worker 应用壳缓存；完全断网后首次打开或重新加载整个站点，仍取决于浏览器是否能加载应用静态资源。

用户主动制作贴纸时，照片会发送给阿里云图像分割服务；配置 AI 识别后，抠图流程和重新识别操作也会将图片及已有分组候选发送给配置的百炼兼容接口，分组建议发送名称与分组候选。Worker 不记录图片、原始 IP、凭据或完整上游 URL。

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

## 账号与云同步 MVP

登录采用一次性邀请码、用户名和密码。抠图结果会优先在浏览器端压缩为透明 WebP；编码不可用或节省不足 10% 时回退 PNG。

首次启用前：

```bash
npx wrangler d1 create memento-journal
npx wrangler r2 bucket create memento-journal-assets
# 将输出的 D1 database_id 写入 wrangler.jsonc
npx wrangler d1 migrations apply memento-journal --remote
openssl rand -hex 32
npx wrangler secret put APP_SECRET
# 确保 .dev.vars 中已有 APP_SECRET=the_same_64_character_value
npm run invite:create -- --base-url https://your-journal.example
```

邀请码会由一条命令直接写入远程 D1，并输出可直接发送的注册链接；链接会在注册页自动带入邀请码。可用 `--count 3` 一次生成多个，或用 `--expires 7d` 设置过期时间（也支持 `h`、`w`）。`APP_SECRET` 会从本地、已被 Git 忽略的 `.dev.vars` 读取；将它安全保存且不要随意更换，否则现有密码校验和登录会话会失效。可用 `--dry-run` 只检查将执行的 SQL，或通过 `INVITE_DATABASE_NAME` 覆盖默认 D1 数据库名。首期硬限制为 150 个账号、每账号 50 MiB 图片；R2 达到 7 GB 时停止发码并检查用量。阿里云抠图用量独立计费。

## 同步、编辑与故障恢复

- 账号 IndexedDB v3 保存同步游标与确认序号。上传每批最多 50 条变更，只确认本批成功处理的序号，失败后继续从该位置重试；拉取每页 100 条并读完剩余分页。多次触发会合并，支持的浏览器用 Web Locks 串行处理同一账号的多标签页同步。
- 从旧版本升级时，不信任可能跳过记录的旧确认序号：首次合并保留未确认修改，再重放保留的日志并补发当前记录（含删除标记）。该补偿只排入一次；已经被旧逻辑删除、且没有其他副本的数据无法凭空恢复。
- 客户端与 Worker 共用同步模型，统一使用 `updatedAt`，兼容读取旧 `changedAt`。按修改时间排序，时间相同时按 `revision` 排序；同一记录的并发修改采用该规则选出最终版本，不做字段级或多人画布合并。服务端拒绝超出当前时间 5 分钟的未来时间戳，请保持设备时间正确。
- 云端返回每批记录的最终版本，客户端将确认进度与合并结果一起提交到 IndexedDB。游标过期时重新取快照并合并，保留同步期间产生的本地修改。图片内容带有对应记录版本；旧设备补偿同步会跳过已知较新的云端图片，Worker 也会拒绝内容与记录版本不一致的写入。
- 个人中心区分正在同步、已同步、离线和同步错误；网络、记录格式、额度或服务错误不会全部伪装成离线。明确的 401 会返回登录流程。
- 编辑、撤销与重做共用每页写入队列和操作序号。图片解码失败时保留原文档对象并显示重试入口，避免编辑其他对象时误删缺失贴纸；资源未就绪或存在加载错误时禁止导出不完整 PNG。
- 图片暂时性网络或 5xx 错误最多尝试三次；404 不持续重试，可通过个人中心的“立即同步”重试下载。图片重试与画布解码重试分别处理各自的失败。

## 图片额度迁移与只读核对

新增 `migrations/0002_asset_operations.sql`，在已有账号表上增加资产索引和持久化操作记录。后续发布前必须先应用该迁移；本地验证、构建和部署 dry-run 不会执行远程迁移。

图片写入先在 D1 原子预留增加的用量，同一资产的上传、覆盖与删除互斥；缩小或删除图片只有在 R2 成功后才释放差额。确定的条件写入失败会补偿预留；结果不确定时保留操作和额度，只在 R2 的操作标识或删除结果提供完成证据后结算。仅看到旧对象仍存在，不能证明在途写入失败，也不会触发超时释放。

存量 `user_usage` 可能受旧并发逻辑影响，新索引也不会自动覆盖历史 R2 对象。发布前应在无并发写入的维护窗口核对 D1 副本与完整 R2 对象清单，发现差异后单独安排经授权的修正。核对工具不联网、不修改数据库、不执行迁移：

```bash
# Node.js 24；使用本地 SQLite 数据库副本（已包含 0001/0002 表）
node scripts/reconcile-asset-usage.mjs --database /path/to/copy.sqlite --json
# 可选完整 R2 清单，格式为 [{"key":"users/.../assets/...","size":123}]
# 也接受 {"objects":[...]}；必须合并全部分页，不能是 truncated:true
node scripts/reconcile-asset-usage.mjs --database /path/to/copy.sqlite --r2-inventory /path/to/r2-inventory.json --json
```

未提供 R2 清单时只核对 D1 索引，不能据此断言实际 R2 用量正确。报告列出已记录用量、索引用量、预留额度、未完成操作，以及清单中的缺失或未入索引对象。无法确认结果的操作需要人工核对，不能直接清空操作表或释放预留。不要将实际账号清单或数据库副本提交到仓库。

## `/api/cutout`

```text
POST /api/cutout
Content-Type: multipart/form-data
image: JPEG | PNG | WebP，最大 3 MiB
```

成功返回 `200 image/png`、`Cache-Control: no-store` 和 `X-Cutout-Source: alibaba-cloud`。错误响应包含用户信息和稳定 `code`。Worker 会验证 MIME 与文件签名，限制输出为 6 MiB，并对上传、分割和下载分别设置超时。

Cloudflare Rate Limiting binding 按不可逆 IP 摘要限流；当前 `wrangler.jsonc` 配置抠图限额为每 60 秒 120 次，认证限额为每 60 秒 10 次。日志只记录 request ID、耗时、状态与字节数，不记录图片、原始 IP、凭据或完整上游 URL。

## Cloudflare 配置与发布

首次部署前写入 Secrets：

```bash
npx wrangler secret put ALIBABA_CLOUD_ACCESS_KEY_ID
npx wrangler secret put ALIBABA_CLOUD_ACCESS_KEY_SECRET
npx wrangler secret put APP_SECRET
npx wrangler secret put DASHSCOPE_API_KEY
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

生产 Worker 名称为 `memento-sticker-journal`。回滚可通过 Cloudflare Workers 的版本历史完成，不删除本地或云端数据。

## 项目结构

```text
src/app/             路由布局与数据 Provider
src/pages/           贴纸库、手帐列表与编辑器
src/components/      Memento 组合组件与 shadcn/ui
src/data/            Dexie、repository、同步边界
src/domain/          Zod 模型与编辑历史
worker/index.ts      Cloudflare Worker 与阿里云 Web Crypto 调用
worker/auth.ts       账号与同步 API
worker/assets.ts     R2 操作、额度预留与结果恢复
public/_headers      CSP 与静态安全响应头
tests/unit/          数据、编辑历史与 Worker 单元测试
tests/e2e/           手机与桌面 Playwright 全流程测试
wrangler.jsonc       Static Assets、限流与 Observability
```

## 第三方许可

撕贴纸预览按需加载 [Sticker Forge](https://github.com/CatsJuice/sticker-forge)，采用 MIT 许可；完整许可证随静态资源发布于 `public/vendor/STICKER_FORGE_LICENSE.txt`。PNG 导出使用 Fabric 底层画布与原生 Canvas 合成，不再依赖 `html2canvas`。
