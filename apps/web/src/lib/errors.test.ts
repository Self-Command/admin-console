import { describe, expect, it } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import { describeAdminError } from '@/lib/errors'

describe('describeAdminError', () => {
  it('asks the operator to sign in again on 401', () => {
    expect(describeAdminError(new AdminApiError('unauthorized', 401))).toBe(
      '登录状态已失效，请重新登录。',
    )
  })

  it('reports a missing permission on 403', () => {
    expect(describeAdminError(new AdminApiError('forbidden', 403))).toBe(
      '当前账号没有执行该操作的权限。',
    )
  })

  it('shows a generic 500 message with the request id but no internal detail', () => {
    const message = describeAdminError(
      new AdminApiError('server', 500, 'InternalError', 'req-42'),
    )
    expect(message).toContain('后台服务暂时不可用')
    expect(message).toContain('请求标识：req-42')
    expect(message).not.toContain('InternalError')
  })

  it('reports network failures and unknown errors', () => {
    expect(describeAdminError(new AdminApiError('network', null))).toBe(
      '无法连接后台服务，请检查网络后重试。',
    )
    expect(describeAdminError(new Error('boom'))).toBe('操作失败，请稍后重试。')
  })
})
