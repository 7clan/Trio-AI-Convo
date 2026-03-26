import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const PORT = process.env.PORT || 3001
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

const PROVIDERS = ['duckduckgo', 'tavily', 'serper', 'serpapi', 'ollama']

const TOOL_INSTRUCTIONS = `
You can use web tools when needed.
If you need web search results, respond with EXACTLY a JSON object in one line like:
{"tool":"search","query":"your search query"}
If you need to fetch a specific URL, respond with:
{"tool":"fetch","url":"https://example.com"}
`.trim()

const RESPONSE_INSTRUCTIONS = `
When you have enough info, respond with EXACTLY one JSON object:
{
  "final":"<final answer>",
  "work_notes":"<brief, high-level notes (max 4 bullets). Include assumptions, evidence used, and next step. No hidden chain-of-thought.>"
}
Keep work_notes short and safe. If not needed, set "work_notes" to "".
`.trim()

const pickProvider = (primary, fallback) => {
  const normalizedPrimary = (primary || '').toLowerCase()
  const normalizedFallback = (fallback || '').toLowerCase()
  const primaryOk = PROVIDERS.includes(normalizedPrimary)
  const fallbackOk = PROVIDERS.includes(normalizedFallback)
  return {
    primary: primaryOk ? normalizedPrimary : 'duckduckgo',
    fallback: fallbackOk ? normalizedFallback : 'tavily',
  }
}

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const extractToolCall = (text) => {
  if (!text) return null
  const trimmed = text.trim()
  const direct = safeJsonParse(trimmed)
  if (direct?.tool === 'search' && typeof direct.query === 'string') {
    return { tool: 'search', query: direct.query }
  }
  if (direct?.tool === 'fetch' && typeof direct.url === 'string') {
    return { tool: 'fetch', url: direct.url }
  }
  const match = trimmed.match(/\{[\s\S]*"tool"\s*:\s*"(search|fetch)"[\s\S]*\}/)
  if (!match) return null
  const parsed = safeJsonParse(match[0])
  if (parsed?.tool === 'search' && typeof parsed.query === 'string') {
    return { tool: 'search', query: parsed.query }
  }
  if (parsed?.tool === 'fetch' && typeof parsed.url === 'string') {
    return { tool: 'fetch', url: parsed.url }
  }
  return null
}

const extractFinalPayload = (text) => {
  if (!text) return null
  const trimmed = text.trim()
  const direct = safeJsonParse(trimmed)
  if (direct && typeof direct.final === 'string') {
    const workNotes =
      typeof direct.work_notes === 'string'
        ? direct.work_notes
        : typeof direct.workNotes === 'string'
          ? direct.workNotes
          : ''
    return { final: direct.final, workNotes }
  }
  return null
}

const sanitizeWorkNotes = (notes) => {
  if (!notes) return ''
  const trimmed = String(notes).trim()
  if (!trimmed) return ''
  const lines = trimmed.split('\n').slice(0, 4)
  const collapsed = lines.map((line) => line.trim()).join('\n')
  return collapsed.slice(0, 600)
}

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const searchDuckDuckGo = async (query) => {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrioConvo/1.0)' },
  })
  if (!res.ok) {
    throw new Error(`DuckDuckGo status ${res.status}`)
  }
  const html = await res.text()
  const results = []
  const linkRegex =
    /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = linkRegex.exec(html)) !== null && results.length < 5) {
    const url = match[1]
    const title = stripTags(match[2])
    const snippetMatch = html
      .slice(match.index, match.index + 800)
      .match(/<div[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''
    results.push({ title, url, snippet, source: 'duckduckgo' })
  }
  if (results.length === 0) {
    const altRegex =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = altRegex.exec(html)) !== null && results.length < 5) {
      const url = match[1]
      const title = stripTags(match[2])
      results.push({ title, url, snippet: '', source: 'duckduckgo' })
    }
  }
  return results
}

const searchTavily = async (query) => {
  const key = process.env.TAVILY_API_KEY
  if (!key) {
    const err = new Error('Missing TAVILY_API_KEY')
    err.code = 'MISSING_KEY'
    throw err
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: 5,
      include_answer: false,
    }),
  })
  if (!res.ok) {
    throw new Error(`Tavily status ${res.status}`)
  }
  const data = await res.json()
  const results = (data.results || []).slice(0, 5).map((item) => ({
    title: item.title || item.url,
    url: item.url,
    snippet: item.content || '',
    source: 'tavily',
  }))
  return results
}

const searchSerper = async (query) => {
  const key = process.env.SERPER_API_KEY
  if (!key) {
    const err = new Error('Missing SERPER_API_KEY')
    err.code = 'MISSING_KEY'
    throw err
  }
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key,
    },
    body: JSON.stringify({ q: query, num: 5 }),
  })
  if (!res.ok) {
    throw new Error(`Serper status ${res.status}`)
  }
  const data = await res.json()
  const results = (data.organic || []).slice(0, 5).map((item) => ({
    title: item.title || item.link,
    url: item.link,
    snippet: item.snippet || '',
    source: 'serper',
  }))
  return results
}

const searchSerpApi = async (query) => {
  const key = process.env.SERPAPI_KEY
  if (!key) {
    const err = new Error('Missing SERPAPI_KEY')
    err.code = 'MISSING_KEY'
    throw err
  }
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('q', query)
  url.searchParams.set('engine', 'google')
  url.searchParams.set('api_key', key)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`SerpAPI status ${res.status}`)
  }
  const data = await res.json()
  const results = (data.organic_results || []).slice(0, 5).map((item) => ({
    title: item.title || item.link,
    url: item.link,
    snippet: item.snippet || '',
    source: 'serpapi',
  }))
  return results
}

const fetchOllamaWeb = async (url) => {
  const key = process.env.OLLAMA_API_KEY
  if (!key) {
    const err = new Error('Missing OLLAMA_API_KEY')
    err.code = 'MISSING_KEY'
    throw err
  }
  const res = await fetch('https://ollama.com/api/web_fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    throw new Error(`Ollama web_fetch status ${res.status}`)
  }
  const data = await res.json()
  return {
    title: data.title || url,
    url,
    content: data.content || '',
    links: Array.isArray(data.links) ? data.links : [],
  }
}

const searchOllamaWeb = async (query) => {
  const key = process.env.OLLAMA_API_KEY
  if (!key) {
    const err = new Error('Missing OLLAMA_API_KEY')
    err.code = 'MISSING_KEY'
    throw err
  }
  const res = await fetch('https://ollama.com/api/web_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query, max_results: 5 }),
  })
  if (!res.ok) {
    throw new Error(`Ollama web_search status ${res.status}`)
  }
  const data = await res.json()
  const results = (data.results || []).slice(0, 5).map((item) => ({
    title: item.title || item.url,
    url: item.url,
    snippet: item.content || '',
    source: 'ollama',
  }))
  return results
}

const runSearchProvider = async (provider, query) => {
  if (provider === 'duckduckgo') return searchDuckDuckGo(query)
  if (provider === 'tavily') return searchTavily(query)
  if (provider === 'serper') return searchSerper(query)
  if (provider === 'serpapi') return searchSerpApi(query)
  if (provider === 'ollama') return searchOllamaWeb(query)
  return searchDuckDuckGo(query)
}

const searchWeb = async (query, primary, fallback) => {
  const { primary: p, fallback: f } = pickProvider(primary, fallback)
  try {
    const results = await runSearchProvider(p, query)
    if (results.length > 0) return { provider: p, results }
    throw new Error('No results')
  } catch (err) {
    if (err?.code === 'MISSING_KEY' && p !== 'duckduckgo') {
      // If a paid provider is missing a key, fall back to DuckDuckGo first.
      const results = await runSearchProvider('duckduckgo', query)
      return { provider: 'duckduckgo', results }
    }
    if (f && f !== p) {
      const results = await runSearchProvider(f, query)
      return { provider: f, results }
    }
    throw err
  }
}

const callOllama = async ({ model, messages, temperature }) => {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error ${res.status}: ${text}`)
  }
  return res.json()
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/', (_req, res) => {
  res.send('Trio Convo backend is running. Try /api/health.')
})

app.post('/api/search', async (req, res) => {
  const { query, provider, fallback } = req.body || {}
  if (!query) return res.status(400).json({ error: 'Missing query' })
  try {
    const data = await searchWeb(
      query,
      provider || process.env.SEARCH_PROVIDER,
      fallback || process.env.SEARCH_FALLBACK
    )
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Search failed' })
  }
})

app.post('/api/chat', async (req, res) => {
  const {
    model,
    messages = [],
    systemPrompt = '',
    temperature = 0.6,
    toolsEnabled = true,
    maxToolSteps = 2,
    searchProvider,
    searchFallback,
  } = req.body || {}

  if (!model) return res.status(400).json({ error: 'Missing model' })

  const history = []
  if (systemPrompt) {
    history.push({ role: 'system', content: systemPrompt })
  }
  if (toolsEnabled) {
    history.push({ role: 'system', content: TOOL_INSTRUCTIONS })
  }
  history.push({ role: 'system', content: RESPONSE_INSTRUCTIONS })
  for (const msg of messages) {
    if (!msg?.role || !msg?.content) continue
    history.push({ role: msg.role, content: msg.content })
  }

  let toolUsed = null
  let toolTrace = null
  let lastResponse = null

  try {
    for (let step = 0; step <= maxToolSteps; step += 1) {
      lastResponse = await callOllama({ model, messages: history, temperature })
      const content = lastResponse?.message?.content || ''
      const toolCall = toolsEnabled ? extractToolCall(content) : null
      if (!toolCall || step === maxToolSteps) {
        const finalPayload = extractFinalPayload(content)
        let finalText = finalPayload?.final ?? content
        if (!finalText || !finalText.trim()) {
          finalText = content?.trim() || 'No response from model.'
        }
        const workNotes = sanitizeWorkNotes(finalPayload?.workNotes || '')
        return res.json({
          response: finalText,
          workNotes,
          toolUsed,
          toolTrace,
          raw: lastResponse,
        })
      }
      toolUsed = toolCall
      if (toolCall.tool === 'search') {
        const search = await searchWeb(
          toolCall.query,
          searchProvider || process.env.SEARCH_PROVIDER,
          searchFallback || process.env.SEARCH_FALLBACK
        )
        toolTrace = {
          type: 'search',
          provider: search.provider,
          query: toolCall.query,
          results: search.results,
        }
        history.push({ role: 'assistant', content })
        history.push({
          role: 'system',
          content: `WebSearchResults (${search.provider}): ${JSON.stringify(
            search.results
          )}`,
        })
      } else if (toolCall.tool === 'fetch') {
        const fetched = await fetchOllamaWeb(toolCall.url)
        toolTrace = {
          type: 'fetch',
          provider: 'ollama',
          url: toolCall.url,
          title: fetched.title,
          content: fetched.content,
          links: fetched.links,
        }
        history.push({ role: 'assistant', content })
        history.push({
          role: 'system',
          content: `WebFetch (${toolCall.url}): ${JSON.stringify(fetched)}`,
        })
      }
    }
    res.json({
      response: lastResponse?.message?.content || '',
      toolUsed,
      raw: lastResponse,
    })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Chat failed' })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
