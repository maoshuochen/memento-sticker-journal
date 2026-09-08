# 指令审计记录

日期：2026-09-06。范围：当前项目及用户随后授权的全局指令。

依据为实际读取的 [GPT-6 Astra 官方模型指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra) 中 Prompting best practices：明确授权和指令优先级，避免不必要的停顿，按任务设置分工与验证强度，保持表达简洁。本次是指令维护，不是应用模型迁移。

## 项目结果

初始检索包含隐藏和被忽略的文件，排除依赖、Git 内部及构建产物；没有发现项目自有 AGENTS.md、SKILL.md 或 references。未为不存在的技能创建重复包装。

- 新增 [AGENTS.md](../AGENTS.md)，只保留项目业务、安全边界和验证入口；通用协作与子代理偏好集中在全局 AGENTS.md。
- 修正 [README.md](../README.md) 的“仅本地／云端仅去背”描述，补充 AI 识别的数据流；合并重复存储说明，按当前配置修正限流数值并补齐部署 secret 名称。
- 为 [UX_RESEARCH.md](../UX_RESEARCH.md) 标记历史适用范围，保留原始研究与当时测试记录。“无需注册”和“暂不加入账户同步”不再被误读为现行功能约束。
- 保留邀请码、账号隔离、离线副本、D1/R2、150 账号和每账号 50 MiB、隐私与第三方许可约束。R2 达到 7 GB 停止发码仍是运维规则，未宣称实现了自动监控。

## 全局结果

扫描个人技能入口及相关 references 的行为条款，并对重点命中项读取上下文；另外检查系统技能路由。没有将每份供应商 API 手册重新认证为最新版本。

| 文件（相对 `~/.codex/`） | 修改 |
| --- | --- |
| `AGENTS.md` | 保留 luna_worker 分工偏好，明确独立并行的适用范围及工具不可用时的回退；集中授权、验证和简洁交付约定 |
| `skills/turnstile-spin/SKILL.md` | 移除启动与本地编辑的重复确认；保留精确云目标和密钥清单授权；安装技能改为用户请求时执行；加入按框架读取的链接 |
| `skills/turnstile-spin/tests/validation.md` | 文案修改不自动触发真实密钥测试；持久化验证仅在请求安装时适用 |
| `skills/turnstile-spin/README.md` | 明确这是本地定制，不要求修改另一仓库的托管 prompt |
| `skills/web-perf/SKILL.md` | 缺 DevTools MCP 时继续可执行分析；按问题选择阶段，不强制无障碍全审计；单次 trace 不作为资源永久无用的证明 |
| `skills/workers-best-practices/SKILL.md` | 使用项目安装版本作为审查基线，减少重复拉取；按变更读取上下文和选择检查 |
| `skills/workers-best-practices/references/review.md` | 与入口统一类型来源及验证规则 |
| `skills/workers-best-practices/references/rules.md` | 取消仅凭日期超过半年就报错或升级的规则，保留 API 兼容性核查 |
| `skills/wrangler/SKILL.md` | 922 行缩至 49 行；取消缺全局命令便安装最新版、定期改兼容日期及默认隐式建云资源的指令 |
| `skills/wrangler/references/commands.md` | 完整迁入原命令示例，按相关章节读取；命令示例不是执行授权 |
| `skills/cloudflare-email-service/SKILL.md` | 合并重复来源提示；按发送/接收路径检查前提；区分本地代码实现、域名配置和真实发信授权 |
| `skills/cloudflare-email-service/references/cli-and-mcp.md` | 本地默认 mock，真实发信要求明确授权及测试收件人 |
| `skills/.system/openai-docs/SKILL.md` | 明确内置 prompting guide 仅在当前官方资料不可用时回退 |
| `skills/.system/openai-docs/references/model-migration.md` | 消除入口要求读该路由、路由却禁止读 migration reference 的冲突 |

六个修改的 SKILL.md 入口合计 1,721 → 802 行。Wrangler 的大部分缩减来自移动示例，不代表删除了同等数量的技术内容。保留 Turnstile 的可信可执行文件、标准输入传递密钥、严格 hostname/action 校验、单次 token 与重放验证要求。

## 验证与限制

- 六个修改的技能入口通过 skill-creator 的 `quick_validate.py` 结构校验；检查了修改文件的相对文件链接和暂存内容哈希。
- 对照修改前副本验证：Turnstile 代码块未改变；Wrangler 命令目录逐字保留。未执行真实云操作、发信、部署或密钥测试。
- 检查项目新增指令中的 npm 脚本均存在，并对文档做差异和引用检查。本次未运行应用完整测试或构建，不将历史 UI 测试记录当作本次通过结果。
- 子代理独立核对项目约束、全局技能条款及系统路由；离线场景验证覆盖 Turnstile 授权、缺 MCP、仅修改发信代码和锁定 CLI 版本审查。
- 项目原有大量未提交修改；本次只新增 AGENTS.md、此记录及修改 README.md、UX_RESEARCH.md，不把整个 Git diff 计作本次工作。

仍存在的非本次指令问题：`.github/workflows/ci.yml` 使用 Node 22，而 package.json 要求 Node 24；CI 调用的 `npm run check` 不存在。子代理执行该命令确认了缺失脚本错误。本次未改 CI 或依赖。Playwright 配置默认指向 macOS Chrome，跨平台执行还需设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。

插件缓存保留原样：其中存在与个人技能同名的副本，部分内容相同、部分已有差异；没有删除或重定向插件。后续明确调用插件版本时仍会使用其自带指令。系统技能和个人技能也可能被更新覆盖，升级后应复查本次补丁。

14 个全局文件已应用，采用修改前哈希校验和逐文件替换，并核对安装后哈希。修改前副本、清单和完整差异保存到 `~/.codex/backups/instruction-audit-20260906/`，用于审阅或恢复。
