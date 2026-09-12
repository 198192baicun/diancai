/// <reference path="./types/index.d.ts" />

interface DiancaiSystem {
  initialized: boolean
  familyName: string | null
  timezone: 'Asia/Shanghai'
  today: string
  instanceId: string | null
  dataEpoch: string | null
  schemaVersion: number
  apiVersion: string
}

interface DiancaiMember {
  avatarMediaId?: string | null
  id: string
  name: string
  active: boolean
}

interface IAppOption {
  globalData: {
    baseURL: string
    system: DiancaiSystem | null
    member: DiancaiMember | null
  }
}
