import { Router, Request, Response } from 'express'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { Channel, M3u8ParseResult, LoadRequest, ChannelQuery } from '../types/channel'
import { loadFromUrl, loadFromPath } from '../services/parser'

let data: M3u8ParseResult | null = null
let sourcePath: string | null = null
let sourceUrl: string | null = null

export function setData(newData: M3u8ParseResult) {
  data = newData
}

export function setSourcePath(path: string | null) {
  sourcePath = path
}

export function setSourceUrl(url: string | null) {
  sourceUrl = url
}

export function getData(): M3u8ParseResult | null {
  return data
}

export function getSourcePath(): string | null {
  return sourcePath
}

const router = Router()

function recalculate() {
  if (!data) return
  const categoriesSet = new Set<string>()
  let radioCount = 0
  for (const ch of data.channels) {
    if (ch.groupTitle) categoriesSet.add(ch.groupTitle)
    if (ch.radio) radioCount++
  }
  data.categories = Array.from(categoriesSet).sort()
  data.stats = {
    total: data.channels.length,
    categories: data.categories.length,
    radio: radioCount,
    tv: data.channels.length - radioCount,
  }
}

function generateM3u8(channels: Channel[], req: Request): string {
  const baseUrl = `${req.protocol}://${req.get('host')}`
  let output = '#EXTM3U\n'
  for (const ch of channels) {
    const attrs: string[] = []
    if (ch.tvgId) attrs.push(`tvg-id="${ch.tvgId}"`)
    if (ch.tvgName) attrs.push(`tvg-name="${ch.tvgName}"`)
    if (ch.tvgLogo) attrs.push(`tvg-logo="${ch.tvgLogo}"`)
    if (ch.groupTitle) attrs.push(`group-title="${ch.groupTitle}"`)
    if (ch.tvgLanguage) attrs.push(`tvg-language="${ch.tvgLanguage}"`)
    if (ch.tvgCountry) attrs.push(`tvg-country="${ch.tvgCountry}"`)
    if (ch.radio) attrs.push(`radio="true"`)
    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
    output += `#EXTINF:${ch.duration}${attrStr},${ch.name}\n`
    const finalUrl = ch.url.startsWith('/') ? `${baseUrl}${ch.url}` : ch.url
    output += `${finalUrl}\n`
  }
  return output
}

router.post('/load', async (req: Request, res: Response) => {
  try {
    const { url, path: filePath } = req.body as LoadRequest

    if (!url && !filePath) {
      return res.status(400).json({ error: 'Se requiere url o path' })
    }

    if (url && filePath) {
      return res.status(400).json({ error: 'Solo uno de url o path, no ambos' })
    }

    data = url ? await loadFromUrl(url) : await loadFromPath(filePath!)
    sourcePath = filePath || null
    sourceUrl = url || null

    res.json({
      message: 'Lista cargada correctamente',
      stats: data.stats,
      hasSourcePath: !!sourcePath,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/channels', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  const {
    q,
    category,
    language,
    quality,
    radio,
    page = '1',
    limit = '50',
  } = req.query as unknown as ChannelQuery

  let filtered: Channel[] = [...data.channels]

  if (q) {
    const search = q.toLowerCase()
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(search) ||
        c.tvgName.toLowerCase().includes(search) ||
        c.groupTitle.toLowerCase().includes(search)
    )
  }

  if (category) {
    filtered = filtered.filter((c) => c.groupTitle.toLowerCase() === category.toLowerCase())
  }

  if (language) {
    filtered = filtered.filter((c) => c.tvgLanguage.toLowerCase() === language.toLowerCase())
  }

  if (quality) {
    filtered = filtered.filter((c) => c.quality.toLowerCase() === quality.toLowerCase())
  }

  if (radio !== undefined) {
    const isRadio = radio === 'true' || radio === '1'
    filtered = filtered.filter((c) => c.radio === isRadio)
  }

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
  const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50))
  const total = filtered.length
  const totalPages = Math.ceil(total / limitNum)
  const start = (pageNum - 1) * limitNum
  const items = filtered.slice(start, start + limitNum)

  res.json({
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
    items,
  })
})

router.get('/channels/search', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  const q = (req.query.q as string || '').trim()
  if (!q) {
    return res.status(400).json({ error: 'Parámetro q requerido' })
  }

  const search = q.toLowerCase()
  const results = data.channels.filter(
    (c) =>
      c.name.toLowerCase().includes(search) ||
      c.tvgName.toLowerCase().includes(search) ||
      c.groupTitle.toLowerCase().includes(search)
  )

  res.json({ total: results.length, items: results.slice(0, 100) })
})

router.get('/channels/:id', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  const id = parseInt(req.params.id, 10)
  const channel = data.channels.find((c) => c.id === id)

  if (!channel) {
    return res.status(404).json({ error: 'Canal no encontrado' })
  }

  res.json(channel)
})

router.post('/channels', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada' })
  }

  const { name, url, groupTitle, tvgLogo, tvgLanguage, quality, radio, tvgId, tvgName, tvgCountry } = req.body
  if (!name || !url) {
    return res.status(400).json({ error: 'Nombre y URL son requeridos' })
  }

  const maxId = data.channels.reduce((max, ch) => Math.max(max, ch.id), -1)

  const newChannel: Channel = {
    id: maxId + 1,
    name,
    url,
    duration: -1,
    tvgId: tvgId || '',
    tvgName: tvgName || name,
    tvgLogo: tvgLogo || '',
    tvgLanguage: tvgLanguage || '',
    tvgCountry: tvgCountry || '',
    groupTitle: groupTitle || '',
    quality: quality || '',
    radio: radio || false,
  }

  data.channels.push(newChannel)
  recalculate()

  res.status(201).json(newChannel)
})

router.put('/channels/:id', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada' })
  }

  const id = parseInt(req.params.id, 10)
  const idx = data.channels.findIndex(c => c.id === id)
  if (idx === -1) {
    return res.status(404).json({ error: 'Canal no encontrado' })
  }

  const existing = data.channels[idx]
  const { name, url, groupTitle, tvgLogo, tvgLanguage, quality, radio, tvgId, tvgName, tvgCountry } = req.body

  data.channels[idx] = {
    ...existing,
    name: name !== undefined ? name : existing.name,
    url: url !== undefined ? url : existing.url,
    groupTitle: groupTitle !== undefined ? groupTitle : existing.groupTitle,
    tvgLogo: tvgLogo !== undefined ? tvgLogo : existing.tvgLogo,
    tvgLanguage: tvgLanguage !== undefined ? tvgLanguage : existing.tvgLanguage,
    quality: quality !== undefined ? quality : existing.quality,
    radio: radio !== undefined ? radio : existing.radio,
    tvgId: tvgId !== undefined ? tvgId : existing.tvgId,
    tvgName: tvgName !== undefined ? tvgName : existing.tvgName,
    tvgCountry: tvgCountry !== undefined ? tvgCountry : existing.tvgCountry,
  }

  recalculate()

  res.json(data.channels[idx])
})

router.delete('/channels/:id', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada' })
  }

  const id = parseInt(req.params.id, 10)
  const idx = data.channels.findIndex(c => c.id === id)
  if (idx === -1) {
    return res.status(404).json({ error: 'Canal no encontrado' })
  }

  data.channels.splice(idx, 1)
  recalculate()

  res.json({ message: 'Canal eliminado' })
})

router.get('/categories', (_req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  res.json({ total: data.categories.length, items: data.categories })
})

router.get('/stats', (_req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  res.json(data.stats)
})

router.post('/playlist/save', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada' })
  }

  if (sourceUrl && !sourcePath) {
    return res.status(400).json({
      error: 'La lista fue cargada desde URL. No se puede guardar en el servidor. Usá Exportar para descargar.',
      canExport: true,
    })
  }

  const saveTo = sourcePath
  if (!saveTo) {
    return res.status(400).json({ error: 'No hay archivo original para sobrescribir' })
  }

  try {
    const m3u8 = generateM3u8(data.channels, req)
    fs.writeFileSync(saveTo, m3u8, 'utf-8')
    res.json({ message: 'Lista guardada correctamente en ' + saveTo })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/playlist.m3u8', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).type('text/plain').send('# No hay lista cargada')
  }

  const output = generateM3u8(data.channels, req)

  res.set('Content-Type', 'application/x-mpegurl')
  res.set('Content-Disposition', 'attachment; filename="playlist.m3u8"')
  res.send(output)
})

const PLAYLIST_CT = /mpegurl|m3u8|vnd\.apple\.mpegurl/i

function resolveUrl(raw: string, baseDir: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/')) return new URL(raw, baseDir).origin + raw
  return new URL(raw, baseDir).href
}

function rewriteM3u8(content: string, baseDir: string, proxyPrefix: string): string {
  let r = content.replace(/^([^#\r\n].*)$/gm, (_, line: string) => {
    const u = line.trim()
    if (!u) return line
    return proxyPrefix + encodeURIComponent(resolveUrl(u, baseDir))
  })
  r = r.replace(/URI="([^"]*)"/g, (_, uri: string) => {
    return `URI="${proxyPrefix}${encodeURIComponent(resolveUrl(uri, baseDir))}"`
  })
  return r
}

router.get('/proxy', (req: Request, res: Response) => {
  const url = req.query.url as string
  if (!url) {
    return res.status(400).json({ error: 'url parameter required' })
  }

  const proto = url.startsWith('https') ? https : http
  const parsed = new URL(url)
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
  }
  if (req.headers.range) headers['Range'] = req.headers.range as string

  const opts = { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, headers, method: 'GET' }

  proto.get(opts, (proxyRes) => {
    if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      const loc = proxyRes.headers.location
      return res.redirect('/api/proxy?url=' + encodeURIComponent(loc.startsWith('http') ? loc : new URL(loc, url).href))
    }

    const ct = proxyRes.headers['content-type'] || ''
    const isPlaylist = PLAYLIST_CT.test(ct) || url.match(/\.m3u8/i)

    if (isPlaylist) {
      let data = ''
      proxyRes.on('data', (chunk: string) => data += chunk)
      proxyRes.on('end', () => {
        const baseDir = url.substring(0, url.lastIndexOf('/') + 1)
        const proxyBase = '/api/proxy?url='
        const rewritten = rewriteM3u8(data, baseDir, proxyBase)
        res.set('Content-Type', 'application/x-mpegurl')
        res.set('Access-Control-Allow-Origin', '*')
        res.send(rewritten)
      })
      return
    }

    res.status(proxyRes.statusCode || 200)
    if (ct) res.set('Content-Type', ct.split(';')[0])
    if (proxyRes.headers['content-length']) res.set('Content-Length', proxyRes.headers['content-length'] as string)
    if (proxyRes.headers['content-range']) res.set('Content-Range', proxyRes.headers['content-range'] as string)
    if (proxyRes.headers['accept-ranges']) res.set('Accept-Ranges', proxyRes.headers['accept-ranges'] as string)
    res.set('Access-Control-Allow-Origin', '*')
    proxyRes.pipe(res)
  }).on('error', (err: Error) => {
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message)
  })
})

export default router
