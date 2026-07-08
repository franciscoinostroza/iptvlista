import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import channelRoutes, { setData, getData, setSourcePath } from './routes/channels'
import { loadFromPath } from './services/parser'
import type { Channel } from './types/channel'

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, '..', 'static')))

app.use('/api', channelRoutes)

async function refreshTnUrl(): Promise<string> {
  try {
    const { Innertube } = await import('youtubei.js' as any)
    const yt = await Innertube.create({ lang: 'es' })
    const info = await yt.getInfo('cb12KmMMDJA')
    const url = info.streaming_data?.hls_manifest_url || ''
    if (url) console.log('TN URL obtenida correctamente')
    return url
  } catch (err: any) {
    console.log('Error obteniendo TN URL:', err.message)
    return ''
  }
}

function updateTnUrl(url: string) {
  const d = getData()
  if (d) {
    const tn = d.channels.find((c: Channel) => c.tvgId === 'TN.ar')
    if (tn) tn.url = url
  }
}

async function autoLoadPlaylist() {
  const playlistPath = path.join(__dirname, '..', 'Casaiptv_Television.m3u8')
  if (!fs.existsSync(playlistPath)) return

  try {
    const [result, tnUrl] = await Promise.all([loadFromPath(playlistPath), refreshTnUrl()])
    const tnChannel: Channel = {
      id: result.channels.length,
      name: 'TN (Todo Noticias)',
      url: tnUrl || '',
      duration: -1,
      tvgId: 'TN.ar',
      tvgName: 'TN',
      tvgLogo: 'https://upload.wikimedia.org/wikipedia/commons/4/4f/TN_todo_noticias_logo.svg',
      tvgLanguage: 'Spanish',
      tvgCountry: 'AR',
      groupTitle: 'Noticias',
      quality: '720p',
      radio: false,
    }
    result.channels.push(tnChannel)
    if (!result.categories.includes('Noticias')) {
      result.categories.push('Noticias')
      result.categories.sort()
    }
    result.stats.total++
    result.stats.tv++
    result.stats.categories = result.categories.length
    setData(result)
    setSourcePath(playlistPath)
    console.log(`Lista auto-cargada: ${result.stats.total} canales (incluye TN)`)

    setInterval(async () => {
      try {
        const newUrl = await refreshTnUrl()
        if (newUrl) updateTnUrl(newUrl)
      } catch (_) {}
    }, 5 * 60 * 60 * 1000)
  } catch (err: any) {
    console.log('No se pudo auto-cargar la lista:', err.message)
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`IPTV Lista API corriendo en http://0.0.0.0:${PORT}`)
  console.log(`Web UI: http://localhost:${PORT}`)
  await autoLoadPlaylist()
})
