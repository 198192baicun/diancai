export type Status = 'pending' | 'cooking' | 'completed' | 'cancelled'

export interface Meta {
  requestId: string
  instanceId: string | null
  dataEpoch: string | null
  today: string
}

export interface ApiEnvelope<T> { data: T; meta: Meta }
export interface ApiErrorBody { error: { code: string; message: string; details?: any }; meta?: Meta }

export interface SystemInfo extends DiancaiSystem {}
export interface Member extends DiancaiMember { avatarMediaId?: string | null }
export interface Category { id: string; name: string; active: boolean }
export interface Rating { average: number | null; count: number }
export interface RecipeStep { id: string; position: number; content: string; mediaId: string | null }
export interface Dish {
  id: string
  name: string
  categoryId: string
  active: boolean
  estimatedMinutes: number | null
  voiceMediaId?: string | null
  introduction: string
  coverMediaId: string | null
  steps: RecipeStep[]
  revision: number
  rating: Rating
  createdBy: string
  createdAt: string
  updatedAt: string
}
export interface MenuItem {
  id: string
  menuDate: string
  dishId: string
  dishName: string
  categoryName: string
  coverMediaId: string | null
  orderedBy: string
  orderedName: string
  noteVoiceMediaId?: string | null
  claimVoiceMediaId?: string | null
  completionVoiceMediaId?: string | null
  completionNote?: string
  photoMediaIds?: string[]
  note: string
  status: Status
  cookId: string | null
  cookName: string | null
  claimedAt: string | null
  completedAt: string | null
  cancelledBy: string | null
  cancelledName: string | null
  cancelledAt: string | null
  cancelReason: string
  sourceVoteId: string | null
  sourceItemId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  allowedActions: string[]
}
export interface MenuSummary {
  date: string
  counts: Record<Status, number>
  effectiveCount: number
  progress: number | null
  rating: Rating
}
export interface Review {
  id: string
  menuItemId: string
  dishId: string
  reviewDate: string
  memberId: string
  memberName: string
  rating: number
  voiceMediaId?: string | null
  comment: string
  createdAt: string
  updatedAt: string
}
export interface VoteCandidate { dishId: string; dishName: string; coverMediaId: string | null; votes: number }
export interface Vote {
  id: string
  title: string
  initiatorId: string
  initiatorName: string
  status: 'active' | 'finished' | 'cancelled'
  createdAt: string
  closedAt: string | null
  winnerDishId: string | null
  candidates: VoteCandidate[]
  myDishIds: string[]
  votingClosedAt: string | null
  enabledMemberCount: number
  myNote: { note: string; voiceMediaId: string | null }
  ballots: Array<{memberId:string;memberName:string;note:string;voiceMediaId:string|null;dishIds:string[]}>
  participantCount: number
  addedItem: { id: string; menuDate: string; status: Status } | null
}
export interface Media {
  id: string
  originalName: string
  detectedMime: string
  byteSize: number
  sha256: string
  previewPolicy: 'inline' | 'download'
  contentUrl: string | null
  downloadUrl: string
  createdAt: string
}
export interface Receipt { idempotencyKey: string; targetDate: string; menuItemIds: string[]; submittedAt: string }
export interface PageResult<T> { items: T[]; nextCursor: string | null; total: number }
export interface MenuPage extends PageResult<MenuItem> { summary: MenuSummary }
export interface VoteEntry { active: Vote | null; latestResult: Vote | null }
export interface HistorySummary {
  menuDate: string
  cooks: string[]
  photoMediaIds: string[]
  itemNames: string[]
  itemCount: number
  completedCount: number
  hasUnfinished: boolean
  rating: Rating
}
export interface DraftItem { localId: string; dishId: string; dishName: string; note: string; noteVoiceMediaId?: string | null; sourceItemId: string | null }
export interface PendingIntent {
  key: string
  baseURL: string
  instanceId: string
  dataEpoch: string
  memberId: string
  targetDate: string
  items: Array<{ dishId: string; note: string; noteVoiceMediaId?: string | null; sourceItemId: string | null }>
  createdAt: number
}
