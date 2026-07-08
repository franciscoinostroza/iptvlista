
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

// --- Player ---

function openPlayer(name, channel) {
  playerChannelName.textContent = name
  playerVideo.src = '/api/stream/' + channel.id
  playerStatus.textContent = 'Iniciando stream...'
  playerOverlay.classList.add('active')

  playerVideo.play().catch(function(e) {
    if (e.name === 'NotAllowedError') {
      playerVideo.muted = true
      playerVideo.play().catch(function() {})
    }
  })
}

function closePlayer() {
  playerOverlay.classList.remove('active')
  playerVideo.pause()
  playerVideo.src = ''
  playerStatus.textContent = ''
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
