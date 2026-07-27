# Memento — AI 贴纸手帐

把照片里的小物件做成贴纸，收进一本可以自由拼贴的数字手帐。

线上版本：[memento-sticker-journal.vercel.app](https://memento-sticker-journal.vercel.app)

## 功能

- 从相册上传或调用相机拍照，框选主体后生成透明背景贴纸。
- 接入阿里云图像分割；云端不可用时自动提供本地快速抠图作为降级方案。
- 在贴纸库中搜索、分组筛选、排序、重命名、移动分组或删除贴纸。
- 新建多本手帐，选择封面与纸张，并用提示词帮助开始记录。
- 在画布上添加、拖动、旋转、缩放和调整贴纸层级；支持撤销、重做、编辑页面文字与新增页面。
- 将单页手帐导出为 PNG。
- 贴纸和手帐数据默认保存在浏览器 IndexedDB 中，无需账号即可使用。

## 技术栈

- 原生 HTML、CSS、JavaScript
- Vercel Serverless Function：`api/cutout.js`
- 阿里云图像分割 SDK：`@alicloud/imageseg20191230`
- 浏览器端 `html2canvas` 动态加载，用于页面导出
- Node.js 20+

## 本地运行

```bash
npm ci
npm run check
npm run build
python3 -m http.server 4173
```

然后打开 <http://127.0.0.1:4173>。

静态服务器可完整预览界面和本地快速抠图；`/api/cutout` 需要 Vercel Function 或等效的 Node 服务，因此本地静态预览中云端抠图不可用是预期行为。

## 环境变量

云端 AI 抠图需要在 Vercel 项目中配置以下环境变量：

```bash
ALIBABA_CLOUD_ACCESS_KEY_ID=your_access_key_id
ALIBABA_CLOUD_ACCESS_KEY_SECRET=your_access_key_secret
```

不要将 Access Key 写入仓库、README、前端代码或公开截图。未配置时接口返回 `503`，前端会引导用户使用快速抠图。

## AI 抠图接口

`POST /api/cutout`

请求体：

```json
{
  "image": "data:image/png;base64,..."
}
```

- 输入支持 JPEG、PNG、WebP；云端接口限制为 3MB。
- 成功时返回 `image/png`。
- 接口按来源 IP 限流为每分钟 8 次；响应不缓存。
- 选择云端抠图时，图片会发送到阿里云图像分割服务处理；本地快速抠图不会调用该服务。

## 部署到 Vercel

```bash
npx vercel
npx vercel --prod
```

部署前请确认项目已关联 Vercel，并已配置上述生产环境变量。`npm run build` 会生成 `public/` 和 `dist/`；它们是构建产物，不建议直接修改。

## 项目结构

```text
.
├── index.html          # 应用结构与可访问性语义
├── styles.css          # 视觉系统与响应式布局
├── app.js              # 贴纸、手帐、画布与本地持久化逻辑
├── api/cutout.js       # Vercel 云端抠图接口
├── worker/index.js     # 静态/Worker 部署入口
├── assets/             # 内置贴纸与 Open Graph 图片
├── scripts/build.mjs   # 构建脚本
├── UX_RESEARCH.md      # 竞品调研与多轮可用性测试记录
└── vercel.json         # 安全响应头配置
```

## 数据与隐私

- 日常贴纸、手帐、页面文字和排版保存在当前浏览器设备中；清除站点数据会清除这些内容。
- 当前原型没有账户、跨设备同步或多人协作。
- 云端抠图属于按需调用：只有用户选择该能力时才会上传已框选的图片。

## 验证

```bash
npm run check
npm run build
```

产品调研、测试范围与下一轮用户研究建议见 [UX_RESEARCH.md](UX_RESEARCH.md)。
