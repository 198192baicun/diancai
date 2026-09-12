import { getBaseURL, getStoredMember, getStoredSystem } from './utils/storage'

App<IAppOption>({
  globalData: {
    baseURL: getBaseURL(),
    system: getStoredSystem(),
    member: getStoredMember(),
  },
})
