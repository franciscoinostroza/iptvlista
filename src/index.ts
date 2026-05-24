import express from 'express'
import cors from 'cors'
import path from 'path'
import channelRoutes from './routes/channels'

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, '..', 'static')))

app.use('/api', channelRoutes)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IPTV Lista API corriendo en http://0.0.0.0:${PORT}`)
  console.log(`Web UI: http://localhost:${PORT}`)
})
