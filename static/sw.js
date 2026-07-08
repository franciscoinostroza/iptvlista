var PROXY_PREFIX = '/api/sw-proxy/'

self.addEventListener('fetch', function(event) {
  var url = event.request.url
  var origin = self.location.origin
  if (!url.startsWith(origin + PROXY_PREFIX)) return

  var targetUrl = url.substring(origin.length + PROXY_PREFIX.length)
  targetUrl = decodeURIComponent(targetUrl)

  event.respondWith(proxyRequest(targetUrl, event.request))
})

async function proxyRequest(targetUrl, request) {
  var headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
  }
  if (request.headers.get('Range')) {
    headers['Range'] = request.headers.get('Range')
  }

  var response = await fetch(targetUrl, { headers: headers })

  var ct = response.headers.get('content-type') || ''
  var isPlaylist = /mpegurl|m3u8|vnd\.apple\.mpegurl/i.test(ct) || /\.m3u8/i.test(targetUrl)

  if (!isPlaylist) return response

  var text = await response.text()
  var baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1)
  var rewritten = rewriteM3u8(text, baseDir, origin + PROXY_PREFIX)

  return new Response(rewritten, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': 'application/x-mpegurl',
      'Access-Control-Allow-Origin': '*',
    }
  })
}

function resolveUrl(raw, baseDir) {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/')) return new URL(raw, baseDir).origin + raw
  return new URL(raw, baseDir).href
}

function rewriteM3u8(content, baseDir, proxyBase) {
  var r = content.replace(/^([^#\r\n].*)$/gm, function(_, line) {
    var u = line.trim()
    if (!u) return line
    return proxyBase + encodeURIComponent(resolveUrl(u, baseDir))
  })
  r = r.replace(/URI="([^"]*)"/g, function(_, uri) {
    return 'URI="' + proxyBase + encodeURIComponent(resolveUrl(uri, baseDir)) + '"'
  })
  return r
}
