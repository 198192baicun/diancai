import { currentScope } from './storage'
import type { Media } from './types'

export interface StepForm { key: string; content: string; mediaId: string | null; media: Media | null; previewURL: string; sizeText: string }
export interface RecipeDraft {
  id: string; revision: number; name: string; categoryId: string; estimatedMinutes: string; introduction: string
  voiceMediaId?: string|null; coverMediaId: string | null; coverMedia: Media | null; steps: StepForm[]; savedAt: number
}
function key(scope: string) { return `diancai.recipes.v1.${encodeURIComponent(scope)}` }
export function listRecipeDrafts(scope = currentScope()): RecipeDraft[] {
  if (!scope) return []
  const value = wx.getStorageSync(key(scope))
  return Array.isArray(value) ? value as RecipeDraft[] : []
}
export function getRecipeDraft(id: string, scope = currentScope()): RecipeDraft | null {
  return listRecipeDrafts(scope).find(d => d.id === id) || null
}
export function saveRecipeDraft(draft: RecipeDraft, scope = currentScope()): void {
  if (!scope) throw new Error('缺少家庭或成员信息')
  const clean = { ...draft, steps: draft.steps.map(step => ({ ...step, previewURL: '' })) }
  wx.setStorageSync(key(scope), [clean, ...listRecipeDrafts(scope).filter(d => d.id !== draft.id)])
}
export function removeRecipeDraft(id: string, scope = currentScope()): void {
  if (!scope) return
  wx.setStorageSync(key(scope), listRecipeDrafts(scope).filter(d => d.id !== id))
}
