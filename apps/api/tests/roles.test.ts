import { describe, expect, it } from 'vitest'
import {
  isRoleName,
  isValidDid,
  parseRole,
  permissionsFor,
  roleAllows,
  rolePermissions,
  sessionView,
  type Permission,
} from '../src/auth/roles.js'

const PERMISSIONS: readonly Permission[] = [
  'directory.read',
  'role.read',
  'role.write',
  'audit.read',
]

describe('role permission matrix', () => {
  it('grants every permission to admin', () => {
    for (const permission of PERMISSIONS) {
      expect(roleAllows('admin', permission)).toBe(true)
    }
  })

  it('limits operator and viewer to reading the account directory', () => {
    for (const role of ['operator', 'viewer'] as const) {
      expect(roleAllows(role, 'directory.read')).toBe(true)
      expect(roleAllows(role, 'role.read')).toBe(false)
      expect(roleAllows(role, 'role.write')).toBe(false)
      expect(roleAllows(role, 'audit.read')).toBe(false)
    }
  })
})

describe('role and DID validation', () => {
  it('accepts only the three known role names', () => {
    expect(parseRole('admin')).toBe('admin')
    expect(parseRole('operator')).toBe('operator')
    expect(parseRole('viewer')).toBe('viewer')
    expect(parseRole('superuser')).toBeNull()
    expect(parseRole(undefined)).toBeNull()
    expect(isRoleName('admin')).toBe(true)
    expect(isRoleName('Admin')).toBe(false)
  })

  it('accepts DID strings and rejects handles or malformed values', () => {
    expect(isValidDid('did:plc:alice')).toBe(true)
    expect(isValidDid('did:web:admin.example.com')).toBe(true)
    expect(isValidDid('alice.test')).toBe(false)
    expect(isValidDid('did:')).toBe(false)
    expect(isValidDid(42)).toBe(false)
  })
})

describe('session view', () => {
  it('exposes the DID, role and permissions of a bound caller', () => {
    expect(sessionView('did:plc:admin', 'admin')).toEqual({
      did: 'did:plc:admin',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    })
    expect(sessionView('did:plc:viewer', 'viewer')).toEqual({
      did: 'did:plc:viewer',
      role: 'viewer',
      permissions: ['directory.read'],
    })
    expect(rolePermissions('operator')).toEqual(['directory.read'])
  })

  it('omits the role and returns no permissions for an unbound caller', () => {
    const view = sessionView('did:plc:none', null)
    expect(view).toEqual({ did: 'did:plc:none', permissions: [] })
    expect('role' in view).toBe(false)
    expect(permissionsFor(null)).toEqual([])
  })
})
