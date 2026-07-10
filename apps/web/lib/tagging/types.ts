import type { DraftTarget } from '@/lib/content/draftTypes'

export type TaggableEntityType = 'person' | 'page' | 'location'
export type TaggableEntitySource = 'historical_post_tag' | 'post_place' | 'ig_caption' | 'commenter' | 'manual'
export type TaggableEntityConfidence = 'ready' | 'needs_verification'

export interface TaggableEntity {
  id: string
  pageId: string
  type: TaggableEntityType
  displayName: string
  fbUserId?: string
  fbPageId?: string
  igUsername?: string
  locationId?: string
  enabledPlatforms: DraftTarget[]
  source: TaggableEntitySource
  confidence: TaggableEntityConfidence
  disabled?: boolean
  createdBy?: string
  lastSeenAt?: number
  createdAt?: number
  updatedAt: number
}

export interface TaggingSelection {
  fb?: {
    pageMentions?: string[]
    personTags?: string[]
    place?: string
  }
  ig?: {
    mentions?: string[]
    location?: string
  }
  th?: {
    location?: string
  }
}

export interface ResolvedPublishTagging {
  fb?: {
    pageMentionIds?: string[]
    personTagIds?: string[]
    placeId?: string
  }
  ig?: {
    usernames?: string[]
    locationId?: string
  }
  th?: {
    locationId?: string
  }
}
