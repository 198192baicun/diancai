import type { ApiEnvelope, ApiErrorBody, Media, Meta, SystemInfo, PageResult } from './types'
import { getBaseURL, setBaseURL, setStoredSystem, currentScope } from './storage'

export class ApiError extends Error {
  status: number
  code: string
  details: any
  meta: Meta | null
  network: boolean

  constructor(message: string, options: { status?: number; code?: string; details?: any; meta?: Meta | null; network?: boolean } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status === undefined ? 0 : options.status
    this.code = options.code === undefined ? 'NETWORK_ERROR' : options.code
    this.details = options.details
    this.meta = options.meta === undefined ? null : options.meta
    this.network = options.network === undefined ? false : options.network
  }

  get responseIsDefinite(): boolean {
    return !this.network && this.status > 0 && this.status < 500 && this.status !== 503
  }
}

function normalizeBaseURL(input: string): string {
  const value = input.trim().replace(/\/$/, '')
  if (!/^https?:\/\/[A-Za-z0-9\[\].:_-]+$/i.test(value)) throw new ApiError('请输入有效的 http:// 或 https:// 家庭服务地址', { status: 400, code: 'INVALID_INPUT' })
  return value
}

function currentContextHeaders(write: boolean, includeMember = true): Record<string, string> {
  const app = getApp<IAppOption>()
  const out: Record<string, string> = {}
  if (includeMember && app.globalData.member && app.globalData.member.id) out['X-Member-Id'] = app.globalData.member.id
  if (write) {
    const system = app.globalData.system
    if (!system || !system.instanceId || !system.dataEpoch || !app.globalData.member || !app.globalData.member.id) throw new ApiError('当前家庭上下文不完整，请重新连接并选择成员', { status: 409, code: 'CONTEXT_REQUIRED' })
    out['X-Instance-Id'] = system.instanceId
    out['X-Data-Epoch'] = system.dataEpoch
  }
  return out
}

function queryString(query?: Record<string, string | number | boolean | null | undefined>): string {
  if (!query) return ''
  const parts: string[] = []
  Object.keys(query).forEach((key) => {
    const value = query[key]
    if (value !== undefined && value !== null && value !== '') parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  })
  return parts.length ? `?${parts.join('&')}` : ''
}

function parseError(status: number, data: unknown): ApiError {
  const body = data as ApiErrorBody
  if (body && body.error && body.error.code) return new ApiError(body.error.message || body.error.code, { status, code: body.error.code, details: body.error.details, meta: body.meta || null })
  return new ApiError(`家庭服务返回 ${status}`, { status, code: 'HTTP_ERROR' })
}

export function request<T>(options: {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  data?: any
  query?: Record<string, string | number | boolean | null | undefined>
  write?: boolean
  headers?: Record<string, string>
  baseURL?: string
  timeout?: number
  includeMember?: boolean
}): Promise<ApiEnvelope<T>> {
  const app = getApp<IAppOption>()
  const baseURL = options.baseURL || app.globalData.baseURL || getBaseURL()
  const method = options.method || 'GET'
  const write = options.write === undefined ? method !== 'GET' : options.write
  const headers: Record<string, string> = { ...currentContextHeaders(write, options.includeMember === undefined ? true : options.includeMember), ...(options.headers || {}) }
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseURL}${options.path}${queryString(options.query)}`,
      method: method as any,
      data: options.data,
      header: headers,
      timeout: options.timeout === undefined ? 10000 : options.timeout,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data as ApiEnvelope<T>)
        else reject(parseError(res.statusCode, res.data))
      },
      fail: (err) => reject(new ApiError(err.errMsg || '无法连接家庭服务', { network: true })),
    })
  })
}

export async function connect(baseURLInput: string): Promise<SystemInfo> {
  const baseURL = normalizeBaseURL(baseURLInput)
  const response = await request<SystemInfo>({ path: '/api/system', baseURL, write: false, timeout: 8000, includeMember: false })
  const app = getApp<IAppOption>()
  app.globalData.baseURL = baseURL
  app.globalData.system = response.data
  setBaseURL(baseURL)
  setStoredSystem(response.data)
  return response.data
}

export async function refreshSystem(): Promise<{ system: SystemInfo; instanceChanged: boolean; epochChanged: boolean }> {
  const app = getApp<IAppOption>()
  const old = app.globalData.system
  const baseURL = app.globalData.baseURL || getBaseURL()
  const response = await request<SystemInfo>({ path: '/api/system', baseURL, write: false, includeMember: false })
  if (app.globalData.baseURL !== baseURL || app.globalData.system !== old) throw new ApiError('家庭连接已变化，请刷新当前页面', { code: 'STALE_CONTEXT' })
  const system = response.data
  const instanceChanged = !!(old && old.instanceId) && !!system.instanceId && old.instanceId !== system.instanceId
  const epochChanged = !instanceChanged && !!(old && old.dataEpoch) && !!system.dataEpoch && old.dataEpoch !== system.dataEpoch
  app.globalData.system = system
  setStoredSystem(system)
  return { system, instanceChanged, epochChanged }
}

export async function setup(familyName: string, members: string[]): Promise<SystemInfo> {
  const app = getApp<IAppOption>()
  const response = await request<SystemInfo>({
    path: '/api/setup', method: 'POST', write: false, includeMember: false,
    data: { familyName, members: members.map((name) => ({ name })) },
  })
  app.globalData.system = response.data
  setStoredSystem(response.data)
  return response.data
}

export function getPublic<T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<ApiEnvelope<T>> {
  return request<T>({ path, query, method: 'GET', write: false, includeMember: false })
}
export function get<T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<ApiEnvelope<T>> {
  return request<T>({ path, query, method: 'GET', write: false })
}
export function post<T>(path: string, data: any, headers?: Record<string, string>): Promise<ApiEnvelope<T>> {
  return request<T>({ path, method: 'POST', data, write: true, headers })
}
export function put<T>(path: string, data: any): Promise<ApiEnvelope<T>> {
  return request<T>({ path, method: 'PUT', data, write: true })
}
export function patch<T>(path: string, data: any): Promise<ApiEnvelope<T>> {
  return request<T>({ path, method: 'PATCH', data, write: true })
}

export interface UploadHandle { task: WechatMiniprogram.UploadTask; promise: Promise<Media> }

export function uploadMedia(filePath: string, onProgress?: (percent: number) => void): UploadHandle {
  const app = getApp<IAppOption>()
  const headers = currentContextHeaders(true)
  let task!: WechatMiniprogram.UploadTask
  const promise = new Promise<Media>((resolve, reject) => {
    task = wx.uploadFile({
      url: `${app.globalData.baseURL}/api/media`,
      filePath,
      name: 'file',
      header: headers,
      timeout: 120000,
      success: (res) => {
        let data: unknown = null
        try { data = JSON.parse(res.data) } catch { /* handled below */ }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const envelope = data as ApiEnvelope<Media>
          if (envelope && envelope.data) resolve(envelope.data)
          else reject(new ApiError('文件上传响应格式无效', { status: res.statusCode, code: 'INVALID_RESPONSE' }))
        } else reject(parseError(res.statusCode, data))
      },
      fail: (err) => reject(new ApiError(err.errMsg || '文件上传中断', { network: true, code: 'UPLOAD_INTERRUPTED' })),
    })
    if (onProgress) task.onProgressUpdate((progress) => onProgress(progress.progress))
  })
  return { task, promise }
}

// 完整读取分页列表；上下文改变时不拼接另一家庭或成员的数据。
export async function getAll<T extends PageResult<any>>(path: string, query: Record<string, string | number | boolean | null | undefined> = {}): Promise<ApiEnvelope<T>> {
  const scope = currentScope()
  const response = await get<T>(path, query)
  const items = [...response.data.items]
  let cursor = response.data.nextCursor
  const seen = new Set<string>()
  while (cursor) {
    if (currentScope() !== scope) throw new ApiError('成员或家庭已切换，请刷新列表')
    if (seen.has(cursor)) throw new ApiError('分页响应重复，请刷新列表')
    seen.add(cursor)
    const page = await get<T>(path, { ...query, cursor })
    items.push(...page.data.items)
    cursor = page.data.nextCursor
  }
  if (currentScope() !== scope) throw new ApiError('成员或家庭已切换，请刷新列表')
  return { ...response, data: { ...response.data, items, nextCursor: null } }
}
