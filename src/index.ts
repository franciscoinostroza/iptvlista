import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import channelRoutes, { setData } from './routes/channels'
import { loadFromPath } from './services/parser'
import type { Channel } from './types/channel'

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, '..', 'static')))

app.use('/api', channelRoutes)

async function autoLoadPlaylist() {
  const playlistPath = path.join(__dirname, '..', 'Casaiptv_Television.m3u8')
  if (fs.existsSync(playlistPath)) {
    try {
      const result = await loadFromPath(playlistPath)
      const tnChannel: Channel = {
        id: result.channels.length,
        name: 'TN (Todo Noticias)',
        url: '/api/stream/tn.m3u8',
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
      console.log(`Lista auto-cargada: ${result.stats.total} canales (incluye TN)`)
    } catch (err: any) {
      console.log('No se pudo auto-cargar la lista:', err.message)
    }
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`IPTV Lista API corriendo en http://0.0.0.0:${PORT}`)
  console.log(`Web UI: http://localhost:${PORT}`)
  await autoLoadPlaylist()
})
