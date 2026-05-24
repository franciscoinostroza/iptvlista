export interface Channel {
  id: number
  name: string
  url: string
  duration: number
  tvgId: string
  tvgName: string
  tvgLogo: string
  tvgLanguage: string
  tvgCountry: string
  groupTitle: string
  quality: string
  radio: boolean
}

export interface M3u8ParseResult {
  channels: Channel[]
  categories: string[]
  stats: {
    total: number
    categories: number
    radio: number
    tv: number
  }
}

export interface LoadRequest {
  url?: string
  path?: string
}

export interface ChannelQuery {
  q?: string
  category?: string
  language?: string
  quality?: string
  radio?: string
  page?: number
  limit?: number
}
