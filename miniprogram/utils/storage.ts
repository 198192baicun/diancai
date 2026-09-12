import type { DraftItem, Member, PendingIntent, SystemInfo } from './types'

const BASE_URL_KEY = 'diancai.baseURL.v1'
const SYSTEM_KEY = 'diancai.system.v1'
const MEMBER_KEY = 'diancai.member.v1'
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'

export function getBaseURL(): string {
  const value = wx.getStorageSync(BASE_URL_KEY)
  return typeof value === 'string' && value ? value : DEFAULT_BASE_URL
}
export function setBaseURL(value: string): void { wx.setStorageSync(BASE_URL_KEY, value) }
export function getStoredSystem(): SystemInfo | null {
  const value = wx.getStorageSync(SYSTEM_KEY)
  return value && typeof value === 'object' ? value as SystemInfo : null
}
export function setStoredSystem(value: SystemInfo): void { wx.setStorageSync(SYSTEM_KEY, value) }
export function getStoredMember(): Member | null {
  const value = wx.getStorageSync(MEMBER_KEY)
  return value && typeof value === 'object' ? value as Member : null
}
export function setStoredMember(value: Member | null): void {
  if (value) wx.setStorageSync(MEMBER_KEY, value)
  else wx.removeStorageSync(MEMBER_KEY)
}


export function scopeForIntent(intent: PendingIntent): string {
  return `${intent.baseURL}|${intent.instanceId}|${intent.dataEpoch}|${intent.memberId}`
}

export function currentScope(): string | null {
  const app = getApp<IAppOption>()
  const system = app.globalData.system
  const member = app.globalData.member
  if (!system || !system.instanceId || !system.dataEpoch || !member || !member.id) return null
  return `${app.globalData.baseURL}|${system.instanceId}|${system.dataEpoch}|${member.id}`
}

function scopedKey(kind: 'draft' | 'pending', scope: string): string {
  return `diancai.${kind}.v1.${encodeURIComponent(scope)}`
}

export function getDraft(scope = currentScope()): DraftItem[] {
  if (!scope) return []
  const value = wx.getStorageSync(scopedKey('draft', scope))
  return Array.isArray(value) ? value as DraftItem[] : []
}

export function saveDraft(items: DraftItem[], scope = currentScope()): void {
  if (!scope) throw new Error('缺少草稿上下文')
  wx.setStorageSync(scopedKey('draft', scope), items)
}

export function getPending(scope = currentScope()): PendingIntent | null {
  if (!scope) return null
  const value = wx.getStorageSync(scopedKey('pending', scope))
  return value && typeof value === 'object' ? value as PendingIntent : null
}

export function savePending(intent: PendingIntent, scope = currentScope()): void {
  if (!scope) throw new Error('缺少提交上下文')
  wx.setStorageSync(scopedKey('pending', scope), intent)
}

export function clearPending(scope = currentScope()): void {
  if (!scope) return
  wx.removeStorageSync(scopedKey('pending', scope))
}

export function clearDraft(scope = currentScope()): void {
  if (!scope) return
  wx.removeStorageSync(scopedKey('draft', scope))
}

export function makeLocalId(prefix = 'draft'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

export function uuidV4(): string {
  // 幂等键不是认证凭证；小程序环境使用随机 UUID 形状，服务端只把它作为同成员同代次的重放键。
  const hex = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return hex.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
