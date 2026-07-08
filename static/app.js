
let state = {
  channels: [],
  categories: [],
  stats: null,
  currentPage: 1,
  totalPages: 0,
  search: '',
  category: '',
  hasSourcePath: false,
  editingId: null,
}

function $(id) { return document.getElementById(id) }

const loadBtn = $('loadBtn')
const urlInput = $('urlInput')
const channelsContainer = $('channelsContainer')
const errorBox = $('errorBox')
const toolbar = $('toolbar')
const filtersContainer = $('filtersContainer')
const searchInput = $('searchInput')
const categoryFilter = $('categoryFilter')
const pagination = $('pagination')
const prevBtn = $('prevBtn')
const nextBtn = $('nextBtn')
const pageInfo = $('pageInfo')
const toast = $('toast')
const m3u8Bar = $('m3u8Bar')
const m3u8Url = $('m3u8Url')
const status = $('status')
const saveBtn = $('saveBtn')
const copyM3u8Btn = $('copyM3u8Btn')

const playerOverlay = $('playerOverlay')
const playerVideo = $('playerVideo')
const playerChannelName = $('playerChannelName')
const playerStatus = $('playerStatus')
const closePlayerBtn = $('closePlayerBtn')

const editModal = $('editModal')
const editModalTitle = $('editModalTitle')
const editForm = $('editForm')
const editId = $('editId')
const editName = $('editName')
const editUrl = $('editUrl')
const editCategory = $('editCategory')
const editLogo = $('editLogo')
const editLanguage = $('editLanguage')
const editQuality = $('editQuality')
const editRadio = $('editRadio')
const editSubmitBtn = $('editSubmitBtn')
const deleteBtn = $('deleteBtn')
const closeEditModalBtn = $('closeEditModalBtn')
const cancelEditBtn = $('cancelEditBtn')
const addChannelBtn = $('addChannelBtn')
const exportBtn = $('exportBtn')

let toastTimeout

function showToast(msg) {
  clearTimeout(toastTimeout)
  toast.textContent = msg
  toast.style.display = 'block'
  toastTimeout = setTimeout(function() { toast.style.display = 'none' }, 3000)
}

function showError(msg) {
  errorBox.textContent = msg
  errorBox.style.display = 'block'
}

function hideError() {
  errorBox.style.display = 'none'
}

async function loadList(input) {
  hideError()
  channelsContainer.innerHTML = '<div class="loading">Cargando lista...</div>'

  var isUrl = input.startsWith('http://') || input.startsWith('https://')
  var body = isUrl ? { url: input } : { path: input }

  try {
    var res = await fetch('/api/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    var data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al cargar')

    state.stats = data.stats
    state.search = ''
    state.category = ''
    state.currentPage = 1
    state.hasSourcePath = data.hasSourcePath || false
    searchInput.value = ''
    categoryFilter.value = ''

    saveBtn.style.display = state.hasSourcePath ? '' : 'none'

    await loadCategories()
    updateStats()
    status.textContent = '· lista cargada'
    showToast('Lista cargada: ' + data.stats.total + ' canales')
    await fetchChannels()
  } catch (err) {
    channelsContainer.innerHTML = ''
    showError(err.message)
  }
}

async function loadCategories() {
  try {
    var res = await fetch('/api/categories')
    var data = await res.json()
    state.categories = data.items || []

    categoryFilter.innerHTML = '<option value="">Todas las categorías</option>'
    for (var i = 0; i < state.categories.length; i++) {
      var opt = document.createElement('option')
      opt.value = state.categories[i]
      opt.textContent = state.categories[i]
      categoryFilter.appendChild(opt)
    }
  } catch (e) {}
}

function updateStats() {
  if (!state.stats) return
  $('statTotal').textContent = state.stats.total
  $('statTv').textContent = state.stats.tv
  $('statRadio').textContent = state.stats.radio
  $('statCat').textContent = state.stats.categories
  statsContainer.style.display = 'grid'
  toolbar.style.display = 'flex'
  filtersContainer.style.display = 'flex'

  var url = location.origin + '/api/playlist.m3u8'
  m3u8Url.textContent = url
  m3u8Bar.style.display = 'block'
}

function copyM3u8Url() {
  var text = m3u8Url.textContent
  navigator.clipboard.writeText(text).then(function() { showToast('URL copiada') }).catch(function() {
    var ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    showToast('URL copiada')
  })
}

// --- Transmuxer (TS → fMP4) ---

var TS_SIZE = 188

function readU16(data, off) { return (data[off] << 8) | data[off + 1] }
function readU32(data, off) { return (data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3] }
function writeU32(data, off, val) { data[off] = val >> 24; data[off + 1] = val >> 16; data[off + 2] = val >> 8; data[off + 3] = val }
function writeU16(data, off, val) { data[off] = val >> 8; data[off + 1] = val }

function makeBox(type, ...parts) {
  var len = 8
  for (var i = 0; i < parts.length; i++) len += parts[i].byteLength
  var buf = new Uint8Array(len)
  writeU32(buf, 0, len)
  for (var i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i)
  var off = 8
  for (var i = 0; i < parts.length; i++) { buf.set(parts[i], off); off += parts[i].byteLength }
  return buf
}

function boxString(s) {
  var buf = new Uint8Array(s.length)
  for (var i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i)
  return buf
}

function makeFullBox(type, version, flags, ...parts) {
  var hdr = new Uint8Array(4)
  writeU32(hdr, 0, (version << 24) | flags)
  return makeBox(type, hdr, ...parts)
}

function makeStsd(codecStr, avcCData) {
  var sampleEntry
  if (codecStr === 'avc1') {
    var avc1 = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0
    ])
    sampleEntry = makeBox('avc1', avc1, avcCData)
  } else {
    sampleEntry = makeBox(codecStr, new Uint8Array(28))
  }
  return makeBox('stsd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), sampleEntry)
}

function buildFtyp() {
  return makeBox('ftyp', boxString('iso5'), new Uint8Array([0, 0, 2, 0]), boxString('iso5iso6mp41'))
}

function buildMoov(timescale, duration, avcC) {
  var mvhd = makeFullBox('mvhd', 0, 0,
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    writeU32toBuf(timescale), writeU32toBuf(duration),
    new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    new Uint8Array([2, 0, 0, 0])
  )

  var tkhd = makeFullBox('tkhd', 0, 0x0F,
    writeU32toBuf(1), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    writeU32toBuf(1), writeU32toBuf(duration),
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0, 0, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0]),
    new Uint8Array([0x01, 0, 0, 0])
  )
  tkhd.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0, 0, 0, 0], 48)

  var mdhd = makeFullBox('mdhd', 0, 0,
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]),
    writeU32toBuf(timescale), writeU32toBuf(duration),
    new Uint8Array([0, 0xC0, 0, 0])
  )

  var hdlr = makeFullBox('hdlr', 0, 0, boxString('vide'), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), boxString('VideoHandler\x00'))
  var vmhd = makeFullBox('vmhd', 0, 1, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))
  var dinf = makeBox('dinf', makeFullBox('dref', 0, 0, new Uint8Array([0, 0, 0, 1]), makeFullBox('url ', 0, 1)))
  var stsd = makeStsd('avc1', avcC)
  var stts = makeFullBox('stts', 0, 0, new Uint8Array([0, 0, 0, 0]))
  var stsc = makeFullBox('stsc', 0, 0, new Uint8Array([0, 0, 0, 0]))
  var stsz = makeFullBox('stsz', 0, 0, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))
  var stco = makeFullBox('stco', 0, 0, new Uint8Array([0, 0, 0, 0]))
  var stbl = makeBox('stbl', stsd, stts, stsc, stsz, stco)
  var minf = makeBox('minf', vmhd, dinf, stbl)
  var mdia = makeBox('mdia', mdhd, hdlr, minf)
  var trak = makeBox('trak', tkhd, mdia)
  var mvex = makeBox('mvex', makeFullBox('trex', 0, 0, writeU32toBuf(1), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])))
  return makeBox('moov', mvhd, trak, mvex)
}

var seqNum = 1

function buildMoof(samples, baseOffset) {
  var duration = 0
  for (var i = 0; i < samples.length; i++) duration += samples[i].dur
  if (duration === 0) duration = 1

  var tfhd = makeFullBox('tfhd', 0, 0x020000, writeU32toBuf(1), new Uint8Array([0, 0, 0, 0]))
  var tfdt = makeFullBox('tfdt', 1, 0, writeU32toBuf(seqNum === 1 ? 0 : 0))

  var trunData = []
  trunData.push(writeU32toBuf(samples.length))
  trunData.push(writeU32toBuf(0x000301))
  trunData.push(writeU32toBuf(samples[0].off))
  for (var i = 0; i < samples.length; i++) {
    trunData.push(writeU32toBuf(samples[i].dur))
    trunData.push(writeU32toBuf(samples[i].size))
    trunData.push(writeU32toBuf(samples[i].flags))
  }

  var trunData2 = new Uint8Array(samples.length * 12)
  for (var i = 0; i < samples.length; i++) {
    var off2 = i * 12
    writeU32(trunData2, off2, samples[i].dur)
    writeU32(trunData2, off2 + 4, samples[i].size)
    writeU32(trunData2, off2 + 8, samples[i].flags)
  }

  var traf = makeBox('traf', tfhd, tfdt, makeFullBox('trun', 0, 0x000301,
    writeU32toBuf(samples.length),
    writeU32toBuf(samples[0].off + baseOffset),
    trunData2
  ))

  var mfhd = makeFullBox('mfhd', 0, 0, writeU32toBuf(seqNum))
  seqNum++
  return makeBox('moof', mfhd, traf)
}

function writeU32toBuf(v) {
  var b = new Uint8Array(4)
  writeU32(b, 0, v)
  return b
}

function writeU16toBuf(v) {
  var b = new Uint8Array(2)
  writeU16(b, 0, v)
  return b
}

function concat(arrays) {
  var len = 0
  for (var i = 0; i < arrays.length; i++) len += arrays[i].byteLength
  var r = new Uint8Array(len)
  var off = 0
  for (var i = 0; i < arrays.length; i++) { r.set(arrays[i], off); off += arrays[i].byteLength }
  return r
}

// --- M3U8 Parser (browser) ---

function parseM3u8Segments(text, baseUrl) {
  var lines = text.split(/\r?\n/)
  var segs = []
  var baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1)

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line.startsWith('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
      var next = lines[i + 1].trim()
      if (next && !next.startsWith('#')) {
        return { redirect: resolveUrl(next, baseDir) }
      }
    }
    if (line.startsWith('#EXTINF:')) {
      for (var j = i + 1; j < lines.length; j++) {
        var next = lines[j].trim()
        if (!next || next.startsWith('#')) continue
        segs.push(resolveUrl(next, baseDir))
        break
      }
    }
  }
  return { segments: segs }
}

// --- TS Parser ---

function tsPacket(data, off) {
  if (data[off] !== 0x47) return null
  var pid = ((data[off + 1] & 0x1f) << 8) | data[off + 2]
  var pus = !!(data[off + 1] & 0x40)
  var adapt = (data[off + 3] >> 6) & 3
  var off2 = off + 4
  if (adapt === 2 || adapt === 3) off2 += data[off2] + 1
  return { pid: pid, pus: pus, payload: data.subarray(off2, off + TS_SIZE) }
}

// --- fMP4 Builders for H.264 ---

function findAvcConfig(nalUnits) {
  // Find SPS and PPS
  var sps = null
  var pps = null
  for (var i = 0; i < nalUnits.length; i++) {
    var type = nalUnits[i][0] & 0x1f
    if (type === 7) sps = nalUnits[i]
    else if (type === 8) pps = nalUnits[i]
  }
  if (!sps || !pps) return null

  var spsLen = sps.byteLength
  var ppsLen = pps.byteLength
  var avcC = new Uint8Array(7 + 2 + spsLen + 1 + 2 + ppsLen)
  avcC[0] = 1 // version
  avcC[1] = sps[1] // profile
  avcC[2] = sps[2] // profile compat
  avcC[3] = sps[3] // level
  avcC[4] = 0xfc | 3 // lengthSizeMinusOne
  avcC[5] = 0xe0 | 1 // num SPS
  writeU16(avcC, 6, spsLen)
  avcC.set(sps, 8)
  var off2 = 8 + spsLen
  avcC[off2] = 1 // num PPS
  writeU16(avcC, off2 + 1, ppsLen)
  avcC.set(pps, off2 + 3)
  return avcC
}

// --- Main Playback ---

var mediaSource = null
var sourceBuffer = null
var abortStreaming = false

function resolveUrl(raw, baseDir) {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/')) return new URL(raw, baseDir).origin + raw
  return new URL(raw, baseDir).href
}

async function playChannel(channel) {
  var url = channel.url
  if (url.startsWith('/')) url = location.origin + url

  playerChannelName.textContent = channel.name
  playerStatus.textContent = 'Iniciando...'
  playerOverlay.classList.add('active')
  abortStreaming = false

  // HTTP streams → open in new tab (no mixed content, no transmux)
  if (location.protocol === 'https:' && url.startsWith('http:')) {
    window.open(url, '_blank')
    playerStatus.textContent = 'Abriendo en nueva pesta\u00f1a...'
    setTimeout(function() { closePlayer() }, 500)
    return
  }

  // HTTPS streams → fetch playlist + transmux
  try {
    var playlistRes = await fetch(url)
    if (!playlistRes.ok) throw new Error('HTTP ' + playlistRes.status)
    var playlistText = await playlistRes.text()
    var result = parseM3u8Segments(playlistText, url)

    // Follow variant playlist redirect
    while (result.redirect) {
      var res2 = await fetch(result.redirect)
      if (!res2.ok) throw new Error('HTTP ' + res2.status)
      var text2 = await res2.text()
      result = parseM3u8Segments(text2, result.redirect)
    }

    var segUrls = result.segments
    if (!segUrls || segUrls.length === 0) throw new Error('No segments found in playlist')

    playerStatus.textContent = 'Cargando segmentos...'

    // Setup MediaSource
    mediaSource = new MediaSource()
    playerVideo.src = URL.createObjectURL(mediaSource)
    playerVideo.load()

    await new Promise(function(resolve, reject) {
      mediaSource.addEventListener('sourceopen', resolve, { once: true })
      mediaSource.addEventListener('sourceerror', reject, { once: true })
    })

    if (abortStreaming) return

    // Fetch first segment to extract codec info
    var firstSegRes = await fetch(segUrls[0])
    if (!firstSegRes.ok) throw new Error('HTTP ' + firstSegRes.status)
    var firstSegBuffer = await firstSegRes.arrayBuffer()
    var firstSeg = new Uint8Array(firstSegBuffer)

    // Parse TS → extract NAL units → find SPS/PPS
    var nalUnits = extractNalUnits(firstSeg)
    var avcC = findAvcConfig(nalUnits)

    if (!avcC) throw new Error('Could not find H.264 codec config')

    var mime = 'video/mp4; codecs="avc1.' + avcC[1].toString(16).padStart(2, '0') + avcC[2].toString(16).padStart(2, '0') + avcC[3].toString(16).padStart(2, '0') + '"'

    // Determine timescale and duration
    var targetDuration = 10
    var playlistLines = playlistText.split(/\r?\n/)
    for (var i = 0; i < playlistLines.length; i++) {
      if (playlistLines[i].startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseInt(playlistLines[i].split(':')[1]) || 10
        break
      }
    }

    var timescale = 90000
    var fragmentDur = targetDuration * timescale

    sourceBuffer = mediaSource.addSourceBuffer(mime)

    // Wait for sourceBuffer to be ready
    await new Promise(function(resolve) {
      function check() { if (!sourceBuffer.updating) resolve(); else setTimeout(check, 10) }
      check()
    })

    if (abortStreaming) return

    // Build initialization segment (ftyp + moov)
    var initFtyp = buildFtyp()
    var initMoov = buildMoov(timescale, 0, avcC)
    var initSeg = concat([initFtyp, initMoov])

    sourceBuffer.appendBuffer(initSeg)
    await waitForUpdate(sourceBuffer)
    if (abortStreaming) return

    playerStatus.textContent = 'Reproduciendo...'

    // Process first segment
    var firstSamples = extractSamplesFromTs(firstSeg, nalUnits)
    var moof1 = buildMoof(firstSamples, initSeg.byteLength + 8 + 8)
    var mdat1 = buildMdat(firstSamples)
    var frag1 = concat([moof1, mdat1])
    sourceBuffer.appendBuffer(frag1)
    await waitForUpdate(sourceBuffer)
    if (abortStreaming) return

    playerVideo.play().catch(function(e) {
      if (e.name === 'NotAllowedError') {
        playerVideo.muted = true
        playerVideo.play().catch(function() {})
      }
    })

    // Process remaining segments
    for (var s = 1; s < segUrls.length; s++) {
      if (abortStreaming) return
      playerStatus.textContent = 'Segmento ' + (s + 1) + '/' + segUrls.length

      var segRes = await fetch(segUrls[s])
      if (!segRes.ok) continue
      var segBuf = await segRes.arrayBuffer()
      var segData = new Uint8Array(segBuf)
      var samples = extractSamplesFromTs(segData, null)
      if (samples.length === 0) continue

      var moof = buildMoof(samples, 0)
      var mdat = buildMdat(samples)
      var frag = concat([moof, mdat])

      sourceBuffer.appendBuffer(frag)
      await waitForUpdate(sourceBuffer)
      if (abortStreaming) return
    }

    playerStatus.textContent = 'Stream finalizado'

  } catch (err) {
    playerStatus.textContent = 'Error: ' + err.message
  }
}

function buildMdat(samples) {
  var totalSize = 0
  for (var i = 0; i < samples.length; i++) totalSize += samples[i].data.byteLength
  var buf = new Uint8Array(totalSize)
  var off = 0
  for (var i = 0; i < samples.length; i++) {
    buf.set(samples[i].data, off)
    off += samples[i].data.byteLength
  }
  return makeBox('mdat', buf)
}

function waitForUpdate(sb) {
  return new Promise(function(resolve) {
    if (!sb.updating) { resolve(); return }
    sb.addEventListener('updateend', resolve, { once: true })
  })
}

function extractNalUnits(tsData) {
  var pesData = collectPesData(tsData, findVideoPid(tsData))
  var nalUnits = []
  var i = 0
  while (i < pesData.length - 3) {
    if (pesData[i] === 0 && pesData[i + 1] === 0 && pesData[i + 2] === 1) {
      var start = i + 3
    } else if (pesData[i] === 0 && pesData[i + 1] === 0 && pesData[i + 2] === 0 && pesData[i + 3] === 1) {
      var start = i + 4
    } else {
      i++; continue
    }
    if (nalUnits.length > 0) {
      nalUnits[nalUnits.length - 1] = pesData.subarray(nalUnits[nalUnits.length - 1].start, start - (pesData[start - 1] === 1 ? 4 : 3))
    }
    nalUnits.push({ start: start, data: null })
    i = start
  }
  if (nalUnits.length > 0) {
    var last = nalUnits[nalUnits.length - 1]
    nalUnits[nalUnits.length - 1] = pesData.subarray(last.start)
  }
  return nalUnits.map(function(u) { return u.data ? u : null }).filter(function(u) { return u })
}

function collectPesData(tsData, pid) {
  var packets = []
  for (var off = 0; off + TS_SIZE <= tsData.byteLength; off += TS_SIZE) {
    var pkt = tsPacket(tsData, off)
    if (pkt && pkt.pid === pid && pkt.pus) {
      // Skip PES header (14 bytes minimum)
      var pesHdrSize = 9 + (pkt.payload[8] || 0)
      var pesData = pkt.payload.subarray(pesHdrSize)
      packets.push(pesData)
    } else if (pkt && pkt.pid === pid) {
      packets.push(pkt.payload)
    }
  }
  if (packets.length === 0) return new Uint8Array(0)
  var totalLen = 0
  for (var i = 0; i < packets.length; i++) totalLen += packets[i].byteLength
  var result = new Uint8Array(totalLen)
  var off2 = 0
  for (var i = 0; i < packets.length; i++) { result.set(packets[i], off2); off2 += packets[i].byteLength }
  return result
}

function findVideoPid(tsData) {
  // Parse PAT (PID 0) to get PMT PID
  for (var off = 0; off + TS_SIZE <= tsData.byteLength; off += TS_SIZE) {
    var pkt = tsPacket(tsData, off)
    if (pkt && pkt.pid === 0 && pkt.pus) {
      var patData = pkt.payload.subarray(8)
      var pmtPid = readU16(patData, patData.byteLength - 3) & 0x1fff
      // Parse PMT
      for (var off2 = 0; off2 + TS_SIZE <= tsData.byteLength; off2 += TS_SIZE) {
        var pkt2 = tsPacket(tsData, off2)
        if (pkt2 && pkt2.pid === pmtPid && pkt2.pus) {
          var pmtData = pkt2.payload.subarray(12)
          var progLen = readU16(pmtData, 0) & 0xfff
          var pmtBody = pmtData.subarray(progLen + 4)
          var pos = 0
          while (pos + 5 < pmtBody.byteLength) {
            var streamType = pmtBody[pos]
            var pesPid = readU16(pmtBody, pos + 1) & 0x1fff
            var esInfoLen = readU16(pmtBody, pos + 3) & 0xfff
            if (streamType === 0x1b) return pesPid // H.264 video
            pos += 5 + esInfoLen
          }
        }
      }
    }
  }
  return 0x31 // fallback: common video PID
}

function extractSamplesFromTs(tsData, existingNals) {
  var nalUnits = existingNals || extractNalUnits(tsData)
  var samples = []
  var currentSample = null

  for (var i = 0; i < nalUnits.length; i++) {
    var type = nalUnits[i][0] & 0x1f
    var size = nalUnits[i].byteLength

    // Put size before NAL (AVCC format)
    var framed = new Uint8Array(4 + size)
    writeU32(framed, 0, size)
    framed.set(nalUnits[i], 4)

    if (type === 9) { // AUD (access unit delimiter)
      continue
    } else if (type === 6 || type === 7 || type === 8) { // SEI, SPS, PPS
      continue
    } else if (type === 5) { // IDR
      if (currentSample) samples.push(currentSample)
      currentSample = {
        dur: 3000,
        size: framed.byteLength,
        off: 0,
        flags: 0x02000000 | 0x01000000,
        data: framed,
        first: true
      }
    } else if (type === 1) { // Non-IDR
      if (!currentSample) {
        currentSample = {
          dur: 3000,
          size: framed.byteLength,
          off: 0,
          flags: 0x01010000,
          data: framed,
          first: true
        }
      } else {
        currentSample.size += framed.byteLength
        var newData = new Uint8Array(currentSample.data.byteLength + framed.byteLength)
        newData.set(currentSample.data)
        newData.set(framed, currentSample.data.byteLength)
        currentSample.data = newData
        currentSample.flags = 0x01000000
      }
    } else if (type === 7 || type === 8) {
      // Skip SPS/PPS (already in moov)
    } else if (currentSample) {
      currentSample.size += framed.byteLength
      var newData2 = new Uint8Array(currentSample.data.byteLength + framed.byteLength)
      newData2.set(currentSample.data)
      newData2.set(framed, currentSample.data.byteLength)
      currentSample.data = newData2
    }
  }

  if (currentSample) samples.push(currentSample)

  // Fix offsets
  for (var i = 0; i < samples.length; i++) {
    if (i === 0) samples[i].off = 0
    else samples[i].off = samples[i - 1].off + samples[i - 1].size
  }

  return samples
}

// --- Player ---

function openPlayer(name, channel) {
  closePlayer()
  playChannel(channel)
}

function closePlayer() {
  abortStreaming = true
  if (sourceBuffer) {
    try { if (!sourceBuffer.updating) sourceBuffer.abort() } catch (_) {}
    sourceBuffer = null
  }
  if (mediaSource) {
    try { if (mediaSource.readyState === 'open') mediaSource.endOfStream() } catch (_) {}
    try { URL.revokeObjectURL(playerVideo.src) } catch (_) {}
    mediaSource = null
  }
  playerOverlay.classList.remove('active')
  playerVideo.pause()
  playerVideo.removeAttribute('src')
  playerVideo.load()
  playerStatus.textContent = ''
  seqNum = 1
}

// --- Edit Modal ---

function openEditModal(channel) {
  state.editingId = channel.id
  editModalTitle.textContent = 'Editar Canal'
  editSubmitBtn.textContent = 'Guardar'
  deleteBtn.style.display = ''

  editId.value = channel.id
  editName.value = channel.name
  editUrl.value = channel.url
  editCategory.value = channel.groupTitle || ''
  editLogo.value = channel.tvgLogo || ''
  editLanguage.value = channel.tvgLanguage || ''
  editQuality.value = channel.quality || ''
  editRadio.checked = channel.radio || false

  editModal.classList.add('active')
}

function openAddModal() {
  state.editingId = null
  editModalTitle.textContent = 'Añadir Canal'
  editSubmitBtn.textContent = 'Añadir'
  deleteBtn.style.display = 'none'

  editId.value = ''
  editName.value = ''
  editUrl.value = ''
  editCategory.value = ''
  editLogo.value = ''
  editLanguage.value = ''
  editQuality.value = ''
  editRadio.checked = false

  editModal.classList.add('active')
  setTimeout(function() { editName.focus() }, 100)
}

function closeEditModal() {
  editModal.classList.remove('active')
  state.editingId = null
}

async function saveEdit(event) {
  event.preventDefault()

  var body = {
    name: editName.value.trim(),
    url: editUrl.value.trim(),
    groupTitle: editCategory.value.trim(),
    tvgLogo: editLogo.value.trim(),
    tvgLanguage: editLanguage.value.trim(),
    quality: editQuality.value.trim(),
    radio: editRadio.checked,
  }

  if (!body.name || !body.url) {
    showError('Nombre y URL son requeridos')
    return
  }

  try {
    var res
    if (state.editingId !== null) {
      res = await fetch('/api/channels/' + state.editingId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } else {
      res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    var data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al guardar')

    closeEditModal()
    showToast(state.editingId !== null ? 'Canal actualizado' : 'Canal añadido')
    await refreshAfterEdit()
  } catch (err) {
    showError(err.message)
  }
}

async function deleteChannel() {
  if (state.editingId === null) return
  if (!confirm('¿Eliminar este canal?')) return

  try {
    var res = await fetch('/api/channels/' + state.editingId, {
      method: 'DELETE',
    })
    var data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al eliminar')

    closeEditModal()
    showToast('Canal eliminado')
    await refreshAfterEdit()
  } catch (err) {
    showError(err.message)
  }
}

// --- Export / Save ---

function exportPlaylist() {
  var a = document.createElement('a')
  a.href = '/api/playlist.m3u8'
  a.download = 'playlist.m3u8'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  showToast('Descargando playlist.m3u8')
}

async function savePlaylist() {
  try {
    var res = await fetch('/api/playlist/save', { method: 'POST' })
    var data = await res.json()
    if (!res.ok) throw new Error(data.error)
    showToast('Lista guardada en el servidor')
  } catch (err) {
    showError(err.message)
  }
}

// --- Data ---

async function refreshAfterEdit() {
  await loadCategories()
  var statsRes = await fetch('/api/stats')
  if (statsRes.ok) {
    state.stats = await statsRes.json()
    updateStats()
  }
  state.currentPage = 1
  await fetchChannels()
}

async function fetchChannels() {
  var params = new URLSearchParams()
  params.set('page', state.currentPage)
  params.set('limit', '50')

  if (state.search) params.set('q', state.search)
  if (state.category) params.set('category', state.category)

  channelsContainer.innerHTML = '<div class="loading">Buscando...</div>'

  try {
    var res = await fetch('/api/channels?' + params.toString())
    var data = await res.json()
    if (!res.ok) throw new Error(data.error)

    state.totalPages = data.totalPages
    renderChannels(data.items)
    renderPagination(data)
  } catch (err) {
    channelsContainer.innerHTML = '<div class="empty">Error: ' + err.message + '</div>'
  }
}

function escapeHtml(str) {
  var div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function renderChannels(items) {
  if (!items || items.length === 0) {
    channelsContainer.innerHTML = '<div class="empty">No se encontraron canales</div>'
    return
  }

  channelsContainer.innerHTML = items
    .map(function(ch) {
      var itemJson = escapeHtml(JSON.stringify(ch))
      return '<div class="channel" data-channel=\'' + itemJson + '\'>\n' +
        '  <img src="' + (ch.tvgLogo || 'data:,') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />\n' +
        '  <div class="channel-info">\n' +
        '    <div class="channel-name">' + escapeHtml(ch.name) + '</div>\n' +
        '    <div class="channel-meta">\n' +
        (ch.groupTitle ? '      <span>' + escapeHtml(ch.groupTitle) + '</span>\n' : '') +
        (ch.quality ? '      <span>' + escapeHtml(ch.quality) + '</span>\n' : '') +
        (ch.tvgLanguage ? '      <span>' + escapeHtml(ch.tvgLanguage) + '</span>\n' : '') +
        (ch.radio ? '      <span>Radio</span>\n' : '') +
        '    </div>\n' +
        '    <div class="channel-url" title="Copiar URL">' + escapeHtml(ch.url) + '</div>\n' +
        '  </div>\n' +
        '  <div class="channel-actions">\n' +
        '    <button class="play-btn" data-action="play">▶</button>\n' +
        '    <button class="edit-btn" data-action="edit">✎</button>\n' +
        '  </div>\n' +
        '</div>'
    })
    .join('')
}

function renderPagination(data) {
  if (data.totalPages <= 1) {
    pagination.style.display = 'none'
    return
  }
  pagination.style.display = 'flex'
  prevBtn.disabled = data.page <= 1
  nextBtn.disabled = data.page >= data.totalPages
  pageInfo.textContent = 'P\u00e1g ' + data.page + ' de ' + data.totalPages + ' \u00b7 ' + data.total + ' canales'
}

// --- Event Delegation ---

channelsContainer.addEventListener('click', function(e) {
  var target = e.target
  if (target.tagName !== 'BUTTON') return

  var channelEl = target.closest('.channel')
  if (!channelEl) return

  try {
    var ch = JSON.parse(channelEl.getAttribute('data-channel'))
  } catch (_) { return }

  var action = target.getAttribute('data-action')

  if (action === 'play') {
    openPlayer(ch.name, ch)
  } else if (action === 'edit') {
    openEditModal(ch)
  }
})

channelsContainer.addEventListener('dblclick', function(e) {
  var urlEl = e.target.closest('.channel-url')
  if (urlEl) {
    var text = urlEl.textContent
    navigator.clipboard.writeText(text).then(function() { showToast('URL copiada') }).catch(function() {
      var textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      showToast('URL copiada')
    })
  }
})

// --- Event Listeners ---

loadBtn.addEventListener('click', function() {
  var url = urlInput.value.trim()
  if (!url) {
    showError('Ingresa una URL de lista M3U8')
    return
  }
  loadList(url)
})

urlInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') loadBtn.click()
})

copyM3u8Btn.addEventListener('click', copyM3u8Url)
closePlayerBtn.addEventListener('click', closePlayer)
closeEditModalBtn.addEventListener('click', closeEditModal)
cancelEditBtn.addEventListener('click', closeEditModal)
addChannelBtn.addEventListener('click', openAddModal)
exportBtn.addEventListener('click', exportPlaylist)
saveBtn.addEventListener('click', savePlaylist)
deleteBtn.addEventListener('click', deleteChannel)

editForm.addEventListener('submit', saveEdit)

searchInput.addEventListener('input', function() {
  state.search = searchInput.value.trim()
  state.currentPage = 1
  fetchChannels()
})

categoryFilter.addEventListener('change', function() {
  state.category = categoryFilter.value
  state.currentPage = 1
  fetchChannels()
})

prevBtn.addEventListener('click', function() {
  if (state.currentPage > 1) {
    state.currentPage--
    fetchChannels()
  }
})

nextBtn.addEventListener('click', function() {
  if (state.currentPage < state.totalPages) {
    state.currentPage++
    fetchChannels()
  }
})

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (playerOverlay.classList.contains('active')) closePlayer()
    else if (editModal.classList.contains('active')) closeEditModal()
  }
})

editModal.addEventListener('click', function(e) {
  if (e.target === editModal) closeEditModal()
})
playerOverlay.addEventListener('click', function(e) {
  if (e.target === playerOverlay) closePlayer()
})

// --- Init ---

async function init() {
  try {
    var res = await fetch('/api/stats')
    if (res.ok) {
      var stats = await res.json()
      state.stats = stats
      await loadCategories()
      updateStats()
      status.textContent = '· ' + stats.total + ' canales'
      await fetchChannels()
    }
  } catch (_) {}
}
init()
