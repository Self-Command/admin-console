export type RoleName = 'admin' | 'moderator' | 'operator' | 'viewer'

export type Permission =
  | 'directory.read'
  | 'content.read'
  | 'content.write'
  | 'moderation.read'
  | 'moderation.write'
  | 'moderation.queue.manage'
  | 'verification.read'
  | 'verification.write'
  | 'notification.read'
  | 'notification.write'
  | 'policy.read'
  | 'policy.write'
  | 'account.write'
  | 'account.admin'
  | 'analytics.read'
  | 'role.read'
  | 'role.write'
  | 'audit.read'
  | 'settings.read'
  | 'settings.write'
  | 'security.read'
  | 'security.write'
  | 'chat.read'
  | 'announcement.read'
  | 'announcement.write'
  | 'announcement.publish'

export const allPermissions: readonly Permission[] = [
  'directory.read',
  'content.read',
  'content.write',
  'moderation.read',
  'moderation.write',
  'moderation.queue.manage',
  'verification.read',
  'verification.write',
  'notification.read',
  'notification.write',
  'policy.read',
  'policy.write',
  'account.write',
  'account.admin',
  'analytics.read',
  'role.read',
  'role.write',
  'audit.read',
  'settings.read',
  'settings.write',
  'security.read',
  'security.write',
  'chat.read',
  'announcement.read',
  'announcement.write',
  'announcement.publish',
]

export const roleLabels: Record<RoleName, string> = {
  admin: '管理员',
  moderator: '审核员',
  operator: '运营',
  viewer: '只读',
}

export const roleDescriptions: Record<RoleName, string> = {
  admin: '全部权限，覆盖审核、账号、角色、审计与系统设置',
  moderator: '处理举报、内容与认证，可查看账号目录与审核分析',
  operator: '查看账号目录、内容、举报与分析，不执行处置',
  viewer: '只读查看账号目录、内容、举报、认证与分析',
}

export const rolePermissions: Record<RoleName, readonly Permission[]> = {
  admin: allPermissions,
  moderator: [
    'directory.read',
    'content.read',
    'content.write',
    'moderation.read',
    'moderation.write',
    'verification.read',
    'verification.write',
    'notification.read',
    'notification.write',
    'policy.read',
    'account.write',
    'analytics.read',
    'chat.read',
    'announcement.read',
  ],
  operator: [
    'directory.read',
    'content.read',
    'moderation.read',
    'notification.read',
    'analytics.read',
    'announcement.read',
  ],
  viewer: [
    'directory.read',
    'content.read',
    'moderation.read',
    'verification.read',
    'analytics.read',
  ],
}

export const permissionLabels: Record<Permission, string> = {
  'directory.read': '查看账号目录',
  'content.read': '查看与检索内容',
  'content.write': '处置内容',
  'moderation.read': '查看审核队列',
  'moderation.write': '执行审核处置',
  'moderation.queue.manage': '管理举报队列',
  'verification.read': '查看认证',
  'verification.write': '管理认证',
  'notification.read': '查看通知',
  'notification.write': '发送通知',
  'policy.read': '查看策略',
  'policy.write': '修改策略',
  'account.write': '管理账号运营记录',
  'account.admin': '管理账号账号信息',
  'analytics.read': '查看审核分析',
  'role.read': '查看管理员与角色',
  'role.write': '管理管理员与角色',
  'audit.read': '查看审计日志',
  'settings.read': '查看系统设置',
  'settings.write': '修改系统设置',
  'security.read': '查看后台安全',
  'security.write': '管理后台安全',
  'chat.read': '查看聊天审核',
  'announcement.read': '查看站内公告',
  'announcement.write': '创建与编辑公告草稿',
  'announcement.publish': '发布与下线公告',
}

export const permissionDescriptions: Record<Permission, string> = {
  'directory.read': '浏览账号目录与账号详情。',
  'content.read': '检索内容、查看内容详情与审核状态。',
  'content.write': '对内容执行下架、恢复与标注等处置。',
  'moderation.read': '查看举报、审核事件、举报队列与定时处置。',
  'moderation.write': '处理举报、执行处置动作与取消定时处置。',
  'moderation.queue.manage': '新建、修改、删除举报队列并迁移队列中的举报。',
  'verification.read': '查看认证记录与认证状态。',
  'verification.write': '授予或撤销认证。',
  'notification.read': '查看通知模板与发送记录。',
  'notification.write': '编辑通知模板并向账号发送通知。',
  'policy.read': '查看策略选项、策略集合与外链规则。',
  'policy.write': '修改策略选项、策略集合与外链规则。',
  'account.write': '维护账号备注、标签与同步暂停状态。',
  'account.admin': '修改账号邮箱、账号名与邀请设置，或删除账号。',
  'analytics.read': '查看审核量、结案率与趋势分析。',
  'role.read': '查看角色绑定、权限矩阵并导出角色。',
  'role.write': '新增、修改、撤销角色，批量导入与删除角色。',
  'audit.read': '查看审计日志详情，并按权限导出记录。',
  'settings.read': '查看系统状态、索引器状态与运行时设置。',
  'settings.write': '修改品牌、外观、导航、功能入口与系统参数。',
  'security.read': '查看管理员访问记录与审批请求。',
  'security.write': '封锁后台访问、解除封锁并处理审批请求。',
  'chat.read': '查看聊天审核状态与聊天审核记录。',
  'announcement.read': '查看公告列表、公告详情与发布状态。',
  'announcement.write': '创建公告草稿并修改草稿内容。',
  'announcement.publish': '经审批发布公告或将已发布公告下线。',
}

export function isRoleName(value: unknown): value is RoleName {
  return (
    value === 'admin' ||
    value === 'moderator' ||
    value === 'operator' ||
    value === 'viewer'
  )
}
