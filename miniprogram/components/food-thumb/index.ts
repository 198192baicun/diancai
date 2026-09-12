Component({
  properties: {
    tone: { type: String, value: 'other' },
    src: { type: String, value: '' },
    large: { type: Boolean, value: false },
  },
  data: { failed: false },
  observers: {
    src() { this.setData({ failed: false }) },
  },
  methods: {
    preview() { if(this.data.src && !this.data.failed) wx.previewImage({current:this.data.src,urls:[this.data.src]}) },
    imageError() { this.setData({ failed: true }) },
  },
})
