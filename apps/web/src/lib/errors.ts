import { AdminApiError } from '@/lib/api/admin-client'

export function isNotConfigured(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === 'NotConfigured'
}

export function describeAdminError(error: unknown): string {
  if (isNotConfigured(error)) {
    return '该功能需要账号服务管理员凭据，当前部署尚未配置，请联系部署管理员完成配置后重试。'
  }
  if (error instanceof AdminApiError) {
    if (error.status === 429 || error.code === 'RateLimited') {
      return '操作过于频繁，请稍后再试。'
    }
    if (error.kind === 'unauthorized') return '登录状态已失效，请重新登录。'
    if (error.kind === 'forbidden') return '当前账号没有执行该操作的权限。'
    if (error.kind === 'conflict') return '操作与当前数据冲突，请刷新后重试。'
    if (error.kind === 'validation') return '提交的内容不合法，请检查后重试。'
    if (error.kind === 'not_found') return '目标记录不存在，可能已被其他管理员修改。'
    if (error.kind === 'network') return '无法连接后台服务，请检查网络后重试。'
    const requestId = error.requestId?.slice(0, 64)
    return requestId
      ? `后台服务暂时不可用，请稍后重试。（请求标识：${requestId}）`
      : '后台服务暂时不可用，请稍后重试。'
  }
  return '操作失败，请稍后重试。'
}
