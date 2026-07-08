import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import channelRoutes, { setData, setSourcePath } from './routes/channels'
import { loadFromPath } from './services/parser'

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, '..', 'static')))


app.use('/api', channelRoutes)

async function autoLoadPlaylist() {
  const playlistPath = path.join(__dirname, '..', 'Casaiptv_Television.m3u8')
  if (!fs.existsSync(playlistPath)) return

  try {
    const result = await loadFromPath(playlistPath)
    setData(result)
    setSourcePath(playlistPath)
    console.log(`Lista auto-cargada: ${result.stats.total} canales`)
  } catch (err: any) {
    console.log('No se pudo auto-cargar la lista:', err.message)
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IPTV Lista API corriendo en http://0.0.0.0:${PORT}`)
  console.log(`Web UI: http://localhost:${PORT}`)
  autoLoadPlaylist()
})
