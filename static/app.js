// Load hls.js dynamically (catches extension errors gracefully)
;(function() {
  var s = document.createElement('script')
  s.src = '/hls.js/hls.min.js'
  s.onerror = function() { console.warn('hls.js load failed') }
  document.head.appendChild(s)
})()

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

const $ = (id) => document.getElementById(id)

const loadBtn = $('loadBtn')
const urlInput = $('urlInput')
const statsContainer = $('statsContainer')
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

const playerOverlay = $('playerOverlay')
const playerVideo = $('playerVideo')
const playerChannelName = $('playerChannelName')
const playerStatus = $('playerStatus')

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

let hlsInstance = null
let toastTimeout

function showToast(msg) {
  clearTimeout(toastTimeout)
  toast.textContent = msg
  toast.style.display = 'block'
  toastTimeout = setTimeout(() => { toast.style.display = 'none' }, 3000)
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

  const isUrl = input.startsWith('http://') || input.startsWith('https://')
  const body = isUrl ? { url: input } : { path: input }

  try {
    const res = await fetch('/api/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
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
    const res = await fetch('/api/categories')
    const data = await res.json()
    state.categories = data.items || []

    categoryFilter.innerHTML = '<option value="">Todas las categorías</option>'
    state.categories.forEach((cat) => {
      const opt = document.createElement('option')
      opt.value = cat
      opt.textContent = cat
      categoryFilter.appendChild(opt)
    })
  } catch (e) {
    // ignore
  }
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

  const url = location.origin + '/api/playlist.m3u8'
  m3u8Url.textContent = url
  m3u8Bar.style.display = 'block'
}

function copyM3u8Url() {
  const text = m3u8Url.textContent
  navigator.clipboard.writeText(text).then(() => showToast('URL copiada')).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    showToast('URL copiada')
  })
}

// --- Player ---

function tryPlay() {
  playerVideo.play().catch((e) => {
    if (e.name === 'NotAllowedError') {
      playerVideo.muted = true
      playerVideo.play().catch(() => {})
    }
  })
}

function openInTab(url) {
  closePlayer()
  window.open(url, '_blank')
  showToast('Abriendo en nueva pestaña...')
}

function fallbackPlay(name, url, proxied) {
  if (proxied) { openInTab(url); return }
  playerVideo.src = url
  playerVideo.load()
  playerStatus.textContent = 'Cargando...'
  tryPlay()
}

function openPlayer(name, rawUrl) {
  let url = rawUrl
  if (url.startsWith('/')) {
    url = location.origin + url
  }

  let isProxied = false
  if (location.protocol === 'https:' && url.startsWith('http:')) {
    url = '/api/proxy?url=' + encodeURIComponent(url)
    isProxied = true
  }

  playerChannelName.textContent = name
  playerOverlay.classList.add('active')
  playerStatus.textContent = 'Iniciando stream...'

  if (hlsInstance) {
    hlsInstance.destroy()
    hlsInstance = null
  }

  playerVideo.src = ''
  playerVideo.load()
  playerVideo.muted = false

  let hlsSupported = false
  try { hlsSupported = typeof Hls !== 'undefined' && Hls.isSupported() } catch (_) {}

  if (hlsSupported) {
    try {
      hlsInstance = new Hls()
      hlsInstance.loadSource(url)
      hlsInstance.attachMedia(playerVideo)
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        playerStatus.textContent = ''
        tryPlay()
      })
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
          fallbackPlay(name, rawUrl, isProxied)
        }
      })
    } catch (_) {
      fallbackPlay(name, rawUrl, isProxied)
    }
  } else if (playerVideo.canPlayType('application/vnd.apple.mpegurl')) {
    playerVideo.src = url
    playerVideo.addEventListener('loadedmetadata', () => {
      playerStatus.textContent = ''
      tryPlay()
    }, { once: true })
    playerVideo.addEventListener('error', () => {
      playerStatus.textContent = 'Error al cargar el stream.'
    }, { once: true })
  } else {
    fallbackPlay(name, rawUrl, isProxied)
  }
}

function closePlayer() {
  playerOverlay.classList.remove('active')
  playerVideo.pause()
  playerVideo.src = ''
  playerStatus.textContent = ''
  if (hlsInstance) {
    hlsInstance.destroy()
    hlsInstance = null
  }
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
  setTimeout(() => editName.focus(), 100)
}

function closeEditModal() {
  editModal.classList.remove('active')
  state.editingId = null
}

async function saveEdit(event) {
  event.preventDefault()

  const body = {
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
    let res
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

    const data = await res.json()
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
    const res = await fetch('/api/channels/' + state.editingId, {
      method: 'DELETE',
    })
    const data = await res.json()
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
  const a = document.createElement('a')
  a.href = '/api/playlist.m3u8'
  a.download = 'playlist.m3u8'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  showToast('Descargando playlist.m3u8')
}

async function savePlaylist() {
  try {
    const res = await fetch('/api/playlist/save', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    showToast('Lista guardada en el servidor')
  } catch (err) {
    showError(err.message)
  }
}

// --- Data ---

async function refreshAfterEdit() {
  await loadCategories()
  const statsRes = await fetch('/api/stats')
  if (statsRes.ok) {
    state.stats = await statsRes.json()
    updateStats()
  }
  state.currentPage = 1
  await fetchChannels()
}

async function fetchChannels() {
  const params = new URLSearchParams()
  params.set('page', state.currentPage)
  params.set('limit', '50')

  if (state.search) params.set('q', state.search)
  if (state.category) params.set('category', state.category)

  channelsContainer.innerHTML = '<div class="loading">Buscando...</div>'

  try {
    const res = await fetch('/api/channels?' + params.toString())
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)

    state.totalPages = data.totalPages
    renderChannels(data.items)
    renderPagination(data)
  } catch (err) {
    channelsContainer.innerHTML = '<div class="empty">Error: ' + err.message + '</div>'
  }
}

function renderChannels(items) {
  if (!items || items.length === 0) {
    channelsContainer.innerHTML = '<div class="empty">No se encontraron canales</div>'
    return
  }

  channelsContainer.innerHTML = items
    .map(
      (ch) => {
        const chJson = escapeHtml(JSON.stringify(ch))
        return `
    <div class="channel">
      <img src="${ch.tvgLogo || 'data:,'}" alt="" loading="lazy" onerror="this.style.display='none'" />
      <div class="channel-info">
        <div class="channel-name">${escapeHtml(ch.name)}</div>
        <div class="channel-meta">
          ${ch.groupTitle ? '<span>' + escapeHtml(ch.groupTitle) + '</span>' : ''}
          ${ch.quality ? '<span>' + escapeHtml(ch.quality) + '</span>' : ''}
          ${ch.tvgLanguage ? '<span>' + escapeHtml(ch.tvgLanguage) + '</span>' : ''}
          ${ch.radio ? '<span>Radio</span>' : ''}
        </div>
        <div class="channel-url" onclick="copyUrl(this)" title="Copiar URL">${escapeHtml(ch.url)}</div>
      </div>
      <div class="channel-actions">
        <button class="play-btn" onclick="openPlayer(${escapeHtml(JSON.stringify(ch.name))}, ${escapeHtml(JSON.stringify(ch.url))})">▶</button>
        <button class="edit-btn" onclick="openEditModal(${chJson})">✎</button>
      </div>
    </div>
  `
      }
    )
    .join('')
}

function copyUrl(el) {
  const text = el.textContent
  navigator.clipboard.writeText(text).then(() => showToast('URL copiada')).catch(() => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    showToast('URL copiada')
  })
}

function renderPagination(data) {
  if (data.totalPages <= 1) {
    pagination.style.display = 'none'
    return
  }
  pagination.style.display = 'flex'
  prevBtn.disabled = data.page <= 1
  nextBtn.disabled = data.page >= data.totalPages
  pageInfo.textContent = `Pág ${data.page} de ${data.totalPages} · ${data.total} canales`
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Eventos
loadBtn.addEventListener('click', () => {
  const url = urlInput.value.trim()
  if (!url) {
    showError('Ingresa una URL de lista M3U8')
    return
  }
  loadList(url)
})

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click()
})

searchInput.addEventListener('input', () => {
  state.search = searchInput.value.trim()
  state.currentPage = 1
  fetchChannels()
})

categoryFilter.addEventListener('change', () => {
  state.category = categoryFilter.value
  state.currentPage = 1
  fetchChannels()
})

prevBtn.addEventListener('click', () => {
  if (state.currentPage > 1) {
    state.currentPage--
    fetchChannels()
  }
})

nextBtn.addEventListener('click', () => {
  if (state.currentPage < state.totalPages) {
    state.currentPage++
    fetchChannels()
  }
})

// Keyboard: Escape cierra modales
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (playerOverlay.classList.contains('active')) closePlayer()
    else if (editModal.classList.contains('active')) closeEditModal()
  }
})

// Clic fuera del modal de edición lo cierra
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditModal()
})

// Auto-cargar si el servidor ya tiene datos
async function init() {
  try {
    const res = await fetch('/api/stats')
    if (res.ok) {
      const stats = await res.json()
      state.stats = stats
      await loadCategories()
      updateStats()
      status.textContent = '· ' + stats.total + ' canales'
      await fetchChannels()
    }
  } catch (_) {}
}
init()
