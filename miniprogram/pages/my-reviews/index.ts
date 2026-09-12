import { ListLoader } from '../../utils/list'
import { ensureCurrentContext } from '../../utils/context'
import type { PageResult, Review, Status } from '../../utils/types'
import { dateLabel } from '../../utils/format'
import { showError } from '../../utils/nav'

interface ReviewItemSummary { id: string; dishName: string; menuDate: string; status: Status }
interface MyReviewRow { review: Review; item: ReviewItemSummary }
interface ReviewView extends MyReviewRow { key: string; dateText: string; starText: string }

Page({
  list: null as unknown as ListLoader<MyReviewRow>,
  data: { nextCursor: null as string | null, listTotal: 0, rows: [] as ReviewView[], loading: true },
  async onShow() { if (await ensureCurrentContext()) await this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async onReachBottom() { if (!this.data.loading && this.data.nextCursor) await this.load(true) },
  async load(append = false) {
    if(!this.list)this.list=new ListLoader<MyReviewRow>();

    this.setData({ loading: true })
    try {
      const response = await this.list.read<PageResult<MyReviewRow>>('/api/me/reviews', { page_size: 10 }, append)
      if (!response) return
      this.setData({ nextCursor: response.data.nextCursor, listTotal: response.data.total })
      this.setData({ rows: response.data.items.map((row) => ({ ...row, key: row.review.id, dateText: dateLabel(row.item.menuDate), starText: `${'★'.repeat(row.review.rating)}${'☆'.repeat(5 - row.review.rating)}` })) })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: this.list.loading }) }
  },
  open(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }) },
})
