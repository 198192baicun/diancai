import { loadMediaPreviewURL } from '../../utils/media'
Component({
  properties: {
    familyName: { type: String, value: '家庭点菜' },
    today: { type: String, value: '' },
    memberName: { type: String, value: '' },
    avatarId: { type: String, value: '' },
  },
  data: { memberInitial: '家', avatarSrc: '' },
  observers: {
    async avatarId(id: string) {
      this.setData({ avatarSrc: '' })
      const src = await loadMediaPreviewURL(id)
      if (this.data.avatarId === id) this.setData({ avatarSrc: src })
    },
    memberName(value: string) { this.setData({ memberInitial: value ? Array.from(value)[0] : '家' }) },
  },
  methods: {
    previewAvatar() { if (this.data.avatarSrc) wx.previewImage({ current: this.data.avatarSrc, urls: [this.data.avatarSrc] }) },
    onMember() { this.triggerEvent('member') },
  },
})
