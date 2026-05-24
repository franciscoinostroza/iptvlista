import { Router, Request, Response } from 'express'
import { Channel, M3u8ParseResult, LoadRequest, ChannelQuery } from '../types/channel'
import { loadFromUrl, loadFromPath } from '../services/parser'

let data: M3u8ParseResult | null = null

export function setData(newData: M3u8ParseResult) {
  data = newData
}

const router = Router()

// POST /api/load - Cargar lista desde URL o archivo local
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

    res.json({
      message: 'Lista cargada correctamente',
      stats: data.stats,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/channels - Listar canales con filtros
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

// GET /api/channels/search?q= - Búsqueda rápida por nombre
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

// GET /api/channels/:id - Detalle de canal
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

// GET /api/categories - Listar categorías
router.get('/categories', (_req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  res.json({ total: data.categories.length, items: data.categories })
})

// GET /api/stats - Estadísticas
router.get('/stats', (_req: Request, res: Response) => {
  if (!data) {
    return res.status(400).json({ error: 'No hay lista cargada. Usa POST /api/load primero' })
  }

  res.json(data.stats)
})

// GET /api/stream/tn.m3u8 - Obtener M3U8 fresca de TN vía YouTube
router.get('/stream/tn.m3u8', async (_req: Request, res: Response) => {
  try {
    const { Innertube } = await import('youtubei.js' as any)
    const yt = await Innertube.create({ lang: 'es' })
    const info = await yt.getInfo('cb12KmMMDJA')
    const stream = info.chooseFormat({ type: 'video+audio', quality: 'best' })
    if (!stream || !stream.url) {
      return res.status(502).type('text/plain').send('# Error: No se pudo obtener el stream de TN')
    }
    const m3u8Url = stream.url.includes('googlevideo.com') ? stream.url : info.streaming_data?.hls_manifest_url
    if (!m3u8Url) {
      return res.status(502).type('text/plain').send('# Error: No se encontró URL HLS para TN')
    }
    res.redirect(302, m3u8Url)
  } catch (err: any) {
    res.status(502).type('text/plain').send(`# Error obteniendo TN: ${err.message}`)
  }
})

// GET /api/playlist.m3u8 - Servir canales como lista M3U8 para reproductor
router.get('/playlist.m3u8', (req: Request, res: Response) => {
  if (!data) {
    return res.status(400).type('text/plain').send('# No hay lista cargada')
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`

  let output = '#EXTM3U\n'
  for (const ch of data.channels) {
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

  res.set('Content-Type', 'application/x-mpegurl')
  res.set('Content-Disposition', 'inline; filename="playlist.m3u8"')
  res.send(output)
})

export default router
