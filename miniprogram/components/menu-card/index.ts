import { categoryTone, statusText } from '../../utils/format'
import type { MenuItem } from '../../utils/types'
import { loadMediaPreviewURL } from '../../utils/media'
Component({
  properties: { item: { type: Object, value: {} } },
  data: { tone: 'other', statusLabel: '', primaryLabel: '', coverURL: '' },
  observers: {
    item(value: MenuItem | null) {
      if (!value || !value.id) return
      let primaryLabel = ''
      if (value.allowedActions && value.allowedActions.includes('claim')) primaryLabel = '我要做'
      else if (value.allowedActions && value.allowedActions.includes('complete')) primaryLabel = '继续做'
      else if (value.allowedActions && value.allowedActions.includes('review')) primaryLabel = '去评价'
      this.setData({ tone: categoryTone(value.categoryName), statusLabel: statusText[value.status], primaryLabel, coverURL: '' })
      if (value.coverMediaId) void this.loadCover(value.id, value.coverMediaId)
    },
  },
  methods: {
    async loadCover(itemId: string, mediaId: string) {
      const coverURL = await loadMediaPreviewURL(mediaId)
      const current = (this.data as any).item as MenuItem
      if (current && current.id === itemId) this.setData({ coverURL })
    },
    open() { this.triggerEvent('open', { id: (this.data as any).item.id }) },
    primary() { this.triggerEvent('primary', { item: (this.data as any).item }) },
  },
})
