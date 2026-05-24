let state = {
  channels: [],
  categories: [],
  stats: null,
  currentPage: 1,
  totalPages: 0,
  search: '',
  category: '',
}

const $ = (id) => document.getElementById(id)

const loadBtn = $('loadBtn')
const urlInput = $('urlInput')
const statsContainer = $('statsContainer')
const channelsContainer = $('channelsContainer')
const errorBox = $('errorBox')
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
    searchInput.value = ''
    categoryFilter.value = ''

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
      (ch) => `
    <div class="channel">
      <img src="${ch.tvgLogo || '/favicon.ico'}" alt="" loading="lazy" onerror="this.src='/favicon.ico'" />
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
      <a class="play-btn" href="${escapeHtml(ch.url)}" target="_blank">▶ Abrir</a>
    </div>
  `
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
