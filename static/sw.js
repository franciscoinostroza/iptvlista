var PROXY_PREFIX = self.location.origin + '/api/sw-proxy/'

self.addEventListener('fetch', function(event) {
  if (!event.request.url.startsWith(PROXY_PREFIX)) return

  var targetUrl = decodeURIComponent(event.request.url.substring(PROXY_PREFIX.length))

  event.respondWith(handleProxy(targetUrl, event.request))
})

function resolveUrl(raw, baseDir) {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/')) return new URL(raw, baseDir).origin + raw
  return new URL(raw, baseDir).href
}

function rewriteM3u8(content, baseDir) {
  var proxyBase = PROXY_PREFIX
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

async function handleProxy(targetUrl, request) {
  var headers = {}
  if (request.headers.get('Range')) headers['Range'] = request.headers.get('Range')

  try {
    var response = await fetch(targetUrl, { headers: headers })
    var ct = response.headers.get('content-type') || ''
    var isPlaylist = /mpegurl|m3u8|vnd\.apple\.mpegurl/i.test(ct) || /\.m3u8/i.test(targetUrl)

    if (!isPlaylist) return response

    var text = await response.text()
    var baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1)
    var rewritten = rewriteM3u8(text, baseDir)

    return new Response(rewritten, {
      status: response.status,
      headers: {
        'Content-Type': 'application/x-mpegurl',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) {
    return new Response('Proxy error: ' + e.message, { status: 502 })
  }
}
