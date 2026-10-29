# AGENTS.md — admin-console

> 本仓库是工作区第四个业务仓库。工作区根 `AGENTS.md` 与 `openspec/changes/admin-console-foundation` 的规范优先于本文件；冲突时停止并请用户裁决。

## 架构约束

- 官方 atproto 服务只读：不修改、不内嵌 PDS / AppView / bsync / Ozone 代码，不直连其数据库。
- 只通过公开 XRPC 与 firehose 与官方服务交互；写入必须走官方 XRPC。
- 契约先行：`packages/lexicons` → codegen → `apps/api` → `apps/web`，不手写与 Lexicon 不一致的请求/响应类型。
- 服务端鉴权是唯一权限边界：服务 JWT 验签、受众与方法校验、角色校验、审计缺一不可。
- 数据库迁移只增量：新增 schema、表、列、索引；禁止删除、改类型、重命名；破坏性变更需用户批准。
- UI 只能是 Next.js + shadcn/ui + Refine 一套体系；不引入第二套组件库、状态管理或低代码平台。
- 依赖新增需说明必要性、维护状态、许可证与体积；优先 MIT / Apache-2.0。

## 安全

- 不提交 `.env`、token、私钥、OAuth secret；本地配置使用环境变量。
- 日志与审计不得包含密码、令牌、邮箱、完整请求体。
- DID 文档解析必须使用受限 HTTP 客户端：协议与地址白名单、重定向与响应体限制。
- 前端菜单与路由守卫只改善体验，不作为授权依据。

## 测试与验证

- 单元与集成测试使用 Vitest；不跳过、不 mock 掉真实鉴权与数据库行为。
- 每个自定义 XRPC 方法必须有权限边界测试（匿名 / viewer / operator / admin）。
- 提交前运行 `corepack pnpm@11.28.5 verify`（typecheck + lint + test）。
- 涉及镜像与本地编排的改动，同时更新工作区 `dev-stack.yaml` 与 compose 并运行 `npm run verify:stack`。

## 停止并提问

遇到规范冲突、需改变策略或架构、需新增服务/依赖、验证连续两次失败、需要覆盖或删除数据时，停止并向用户说明现状、选项与建议，不擅自绕过检查。
