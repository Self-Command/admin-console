# admin-console

AT Protocol 业务后台，与官方 atproto 服务解耦：官方 PDS / AppView / Ozone 保持零补丁，本仓库提供独立的业务 API 与管理界面。

## 组成

- `apps/api`：admin-api 业务服务，只通过公开 XRPC 与 firehose 和官方服务交互；
- `apps/web`：admin-web 管理后台（Next.js 15 + shadcn/ui + Refine）；
- `packages/lexicons`：自定义 `com.selfcommand.admin.*` 契约与 codegen 产物。

## 与官方服务的关系

- 不内嵌、不修改官方服务代码；
- 不直接读写 PDS / AppView / Ozone 的数据库；
- 鉴权使用 AT Protocol 服务 JWT，角色在服务端校验；
- 官方升级只需更新镜像与依赖版本，本仓库业务代码不受影响。

## 快速开始

```bash
corepack pnpm@11.28.5 install
corepack pnpm@11.28.5 typecheck
corepack pnpm@11.28.5 lint
corepack pnpm@11.28.5 test
```

需要 Node `>=24.18.0`。依赖安装属于大动作，首次执行前请确认。

## 本地开发

```bash
# admin-api（需要 Postgres 与 PDS）
export ADMIN_API_DATABASE_URL='postgresql://...'
export ADMIN_API_SERVICE_DID='did:web:localhost%3A2587'
export ADMIN_API_CORS_ORIGINS='http://127.0.0.1:8101'
corepack pnpm@11.28.5 migrate:up
corepack pnpm@11.28.5 dev:api

# admin-web（构建期公开配置）
NEXT_PUBLIC_ADMIN_API_URL='http://127.0.0.1:2587' \
NEXT_PUBLIC_ADMIN_API_DID='did:web:localhost%3A2587' \
NEXT_PUBLIC_DEFAULT_PDS='http://localhost:2583' \
corepack pnpm@11.28.5 --filter @admin/web dev
```

打开 `http://127.0.0.1:8101`。开发模式提供本地预览登录；生产构建隐藏预览入口。完整的环境变量、角色引导、审计、索引器与故障排查见工作区 `docs/development/admin-console.md`。

## 镜像

在仓库根目录执行：

```bash
docker build -f apps/api/Dockerfile -t admin-api .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_ADMIN_API_URL='http://localhost:2587' \
  --build-arg NEXT_PUBLIC_ADMIN_API_DID='did:web:localhost%3A2587' \
  --build-arg NEXT_PUBLIC_DEFAULT_PDS='http://localhost:2583' \
  -t admin-web .
```

两个镜像均以非 root 运行并带健康检查；admin-web 暴露 `http://127.0.0.1:8101/healthz`。`NEXT_PUBLIC_*` 在构建期写入，不能存放秘密。

## 状态

第一条纵向切片已实现：服务 JWT 鉴权、角色与权限、审计、账号目录索引、登录与权限守卫、角色/审计/目录页面、统一错误与空态。对应工作区 OpenSpec change `admin-console-foundation`（`openspec/changes/admin-console-foundation`）。

当前验证：`lexicons` 契约测试通过；`apps/api` 50 项单测通过、13 项数据库集成用例因未启动测试库跳过；`apps/web` 59 项测试通过；`typecheck`、`lint` 与生产构建通过。Docker 镜像运行与端到端联调待执行。

## 许可证

待定。仓库内暂不包含许可证文件，默认保留所有权利。
