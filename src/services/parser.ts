import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { Channel, M3u8ParseResult } from '../types/channel'

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    proto.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject)
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

function inferQuality(name: string): string {
  const lower = name.toLowerCase()
  if (/4k|2160p|uhd/i.test(lower)) return '4K'
  if (/1080p|1080|fhd|full.?hd/i.test(lower)) return '1080p'
  if (/720p|720|hd/i.test(lower)) return '720p'
  if (/576p|576|sd/i.test(lower)) return '576p'
  if (/480p|480/i.test(lower)) return '480p'
  if (/360p|360/i.test(lower)) return '360p'
  return ''
}

function parseAttributes(attrs: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*([^\s"]+)/g
  let match
  while ((match = regex.exec(attrs)) !== null) {
    const key = (match[1] || match[3]).toLowerCase()
    const value = match[2] || match[4] || ''
    result[key] = value
  }
  return result
}

export function parseM3u8Content(content: string): M3u8ParseResult {
  const lines = content.split(/\r?\n/)
  const channels: Channel[] = []
  const categoriesSet = new Set<string>()
  let idCounter = 0
  let radioCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('#EXTINF:')) continue

    const durationMatch = line.match(/#EXTINF:\s*(-?\d+\.?\d*)/)
    const duration = durationMatch ? parseFloat(durationMatch[1]) : -1

    const commaIndex = line.lastIndexOf(',')
    const name = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : ''

    const attrsPart = line.substring(line.indexOf(':') + 1, commaIndex !== -1 ? commaIndex : line.length)
    const attrs = parseAttributes(attrsPart)

    let url = ''
    let extgrp = ''
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j].trim()
      if (nextLine.startsWith('#EXTGRP:')) {
        extgrp = nextLine.substring(8).trim()
        continue
      }
      if (!nextLine || nextLine.startsWith('#')) continue
      url = nextLine
      break
    }

    const groupTitle = attrs['group-title'] || attrs['grupo'] || extgrp || ''
    const quality = attrs['quality'] || inferQuality(name)
    const radio = attrs['radio'] === 'true' || /\(radio\)/i.test(name)

    if (groupTitle) categoriesSet.add(groupTitle)
    if (radio) radioCount++

    channels.push({
      id: idCounter++,
      name,
      url,
      duration,
      tvgId: attrs['tvg-id'] || attrs['id'] || '',
      tvgName: attrs['tvg-name'] || attrs['name'] || '',
      tvgLogo: attrs['tvg-logo'] || attrs['logo'] || '',
      tvgLanguage: attrs['tvg-language'] || attrs['language'] || '',
      tvgCountry: attrs['tvg-country'] || attrs['country'] || '',
      groupTitle,
      quality,
      radio,
    })
  }

  const categories = Array.from(categoriesSet).sort()
  const total = channels.length

  return {
    channels,
    categories,
    stats: {
      total,
      categories: categories.length,
      radio: radioCount,
      tv: total - radioCount,
    },
  }
}

export async function loadFromUrl(url: string): Promise<M3u8ParseResult> {
  const content = await fetchUrl(url)
  return parseM3u8Content(content)
}

export async function loadFromPath(filePath: string): Promise<M3u8ParseResult> {
  const resolved = path.resolve(filePath)
  const content = fs.readFileSync(resolved, 'utf-8')
  return parseM3u8Content(content)
}

function resolveUrl(raw: string, baseDir: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/')) return new URL(raw, baseDir).origin + raw
  return new URL(raw, baseDir).href
}

export function fetchBinary(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const req = proto.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return fetchBinary(res.headers.location).then(resolve).catch(reject)
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('fetchBinary timeout')) })
  })
}

export async function getSegmentUrls(playlistUrl: string): Promise<{ segments: string[]; targetDuration: number }> {
  let url = playlistUrl
  const maxDepth = 5

  for (let depth = 0; depth < maxDepth; depth++) {
    const content = await fetchUrl(url)
    const baseDir = url.substring(0, url.lastIndexOf('/') + 1)
    const lines = content.split(/\r?\n/)

    if (content.includes('#EXT-X-STREAM-INF')) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
          const next = lines[i + 1].trim()
          if (next && !next.startsWith('#')) {
            url = resolveUrl(next, baseDir)
            break
          }
        }
      }
      continue
    }

    const segments: string[] = []
    let targetDuration = 10

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseInt(line.split(':')[1]) || 10
      }
      if (line.startsWith('#EXT-X-MAP:URI=')) {
        const m = line.match(/URI="([^"]*)"/)
        if (m) segments.push(resolveUrl(m[1], baseDir))
      }
      if (line.startsWith('#EXTINF:')) {
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j].trim()
          if (!next || next.startsWith('#')) continue
          segments.push(resolveUrl(next, baseDir))
          break
        }
      }
    }

    return { segments, targetDuration }
  }

  return { segments: [], targetDuration: 10 }
}
