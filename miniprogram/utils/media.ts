import { get } from './api'
import type { Media } from './types'
import { joinURL } from './format'

const previewCache: Record<string, Promise<string>> = Object.create(null)

export function previewURLForMedia(media: Media): Promise<string> {
  if (media.previewPolicy !== 'inline' || !media.contentUrl) return Promise.resolve('')
  const baseURL = getApp<IAppOption>().globalData.baseURL
  const remoteURL = joinURL(baseURL, media.contentUrl) || ''
  if (!remoteURL) return Promise.resolve('')
  const key = `${baseURL}\n${media.id}`
  if (!previewCache[key]) {
    previewCache[key] = new Promise((resolve) => {
      wx.downloadFile({
        url: remoteURL,
        timeout: 120000,
        success: (response) => resolve(response.statusCode >= 200 && response.statusCode < 300 ? response.tempFilePath : remoteURL),
        fail: () => resolve(remoteURL),
      })
    })
  }
  return previewCache[key]
}

export async function loadMediaPreviewURL(mediaId: string | null): Promise<string> {
  if (!mediaId) return ''
  try {
    const media = (await get<Media>(`/api/media/${encodeURIComponent(mediaId)}`)).data
    return await previewURLForMedia(media)
  } catch {
    return ''
  }
}
