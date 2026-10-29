import type { AuditResult } from '@/lib/data/types'

export const auditActionLabels: Record<string, string> = {
  'com.selfcommand.admin.role.bootstrap': '初始化管理员',
  'com.selfcommand.admin.role.create': '授予角色',
  'com.selfcommand.admin.role.update': '修改角色',
  'com.selfcommand.admin.role.revoke': '撤销角色',
  'com.selfcommand.admin.role.list': '查询角色绑定',
  'com.selfcommand.admin.role.get': '查看角色绑定',
  'com.selfcommand.admin.account.list': '查询账号目录',
  'com.selfcommand.admin.account.get': '查看账号详情',
  'com.selfcommand.admin.audit.list': '查询审计日志',
  'com.selfcommand.admin.session.get': '读取后台身份',
}

export const auditActionOptions = Object.keys(auditActionLabels)

export const auditResultLabels: Record<AuditResult, string> = {
  success: '成功',
  denied: '拒绝',
  error: '失败',
}

export function auditActionLabel(action: string): string {
  return auditActionLabels[action] ?? action
}
