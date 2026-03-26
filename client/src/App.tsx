import { useMemo, useRef, useState } from 'react'
import './App.css'

type Speaker = 'user' | 'ai1' | 'ai2' | 'system'

type ChatMessage = {
  id: string
  speaker: Speaker
  text: string
  timestamp: string
  workNotes?: string
  toolTrace?: ToolTrace | null
}

type ToolTrace =
  | {
      type: 'search'
      provider: string
      query: string
      results: { title: string; url: string; snippet?: string }[]
    }
  | {
      type: 'fetch'
      provider: string
      url: string
      title?: string
      content?: string
      links?: string[]
    }

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [ai1Model, setAi1Model] = useState('qwen3:4b')
  const [ai2Model, setAi2Model] = useState('gemma3:4b')
  const [ai1Prompt, setAi1Prompt] = useState(
    'You are AI-1. Be direct, curious, and collaborative.'
  )
  const [ai2Prompt, setAi2Prompt] = useState(
    'You are AI-2. Offer alternative angles and challenge assumptions.'
  )
  const [temperature, setTemperature] = useState(0.6)
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [searchProvider, setSearchProvider] = useState('duckduckgo')
  const [searchFallback, setSearchFallback] = useState('duckduckgo')
  const [rounds, setRounds] = useState(3)
  const [busy, setBusy] = useState(false)
  const [activeThinker, setActiveThinker] = useState<Speaker | null>(null)
  const [workNotes, setWorkNotes] = useState({ ai1: '', ai2: '' })
  const [toolTraces, setToolTraces] = useState<{
    ai1: ToolTrace | null
    ai2: ToolTrace | null
  }>({ ai1: null, ai2: null })
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])

  const statusText = useMemo(() => {
    if (!busy) return 'Idle'
    if (activeThinker === 'ai1') return 'AI-1 thinking'
    if (activeThinker === 'ai2') return 'AI-2 thinking'
    return 'Working'
  }, [busy, activeThinker])

  const pushMessage = (
    speaker: Speaker,
    text: string,
    workNotesText?: string,
    trace?: ToolTrace | null
  ) => {
    const timestamp = new Date().toLocaleTimeString()
    const next = [
      ...messagesRef.current,
      {
        id: `${Date.now()}-${Math.random()}`,
        speaker,
        text,
        timestamp,
        workNotes: workNotesText,
        toolTrace: trace || null,
      },
    ]
    messagesRef.current = next
    setMessages(next)
    return next
  }

  const buildOllamaMessages = (all: ChatMessage[]) => {
    return all.map((msg) => ({
      role: msg.speaker === 'user' ? 'user' : 'assistant',
      content: `${msg.speaker.toUpperCase()}: ${msg.text}`,
    }))
  }

  const callModel = async (
    model: string,
    systemPrompt: string,
    history: ChatMessage[]
  ) => {
    const controller = new AbortController()
    abortRef.current = controller
    const payload = {
      model,
      messages: buildOllamaMessages(history),
      systemPrompt,
      temperature,
      toolsEnabled,
      maxToolSteps: 2,
      searchProvider,
      searchFallback,
    }
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || 'Chat request failed')
    }
    const data = await res.json()
    const response = (data.response as string) || ''
    if (!response.trim()) {
      throw new Error('Model returned an empty response.')
    }
    return {
      response,
      workNotes: data.workNotes as string | undefined,
      toolTrace: (data.toolTrace || null) as ToolTrace | null,
    }
  }

  const handleSend = async () => {
    if (!input.trim() || busy) return
    const content = input.trim()
    setInput('')
    const history = pushMessage('user', content)
    setBusy(true)
    try {
      setActiveThinker('ai1')
      const ai1 = await callModel(ai1Model, ai1Prompt, history)
      if (ai1.workNotes) {
        setWorkNotes((prev) => ({ ...prev, ai1: ai1.workNotes || '' }))
      }
      if (ai1.toolTrace) {
        setToolTraces((prev) => ({ ...prev, ai1: ai1.toolTrace || null }))
      }
      const historyAfterAi1 = pushMessage(
        'ai1',
        ai1.response,
        ai1.workNotes,
        ai1.toolTrace
      )
      setActiveThinker('ai2')
      const ai2 = await callModel(ai2Model, ai2Prompt, historyAfterAi1)
      if (ai2.workNotes) {
        setWorkNotes((prev) => ({ ...prev, ai2: ai2.workNotes || '' }))
      }
      if (ai2.toolTrace) {
        setToolTraces((prev) => ({ ...prev, ai2: ai2.toolTrace || null }))
      }
      pushMessage('ai2', ai2.response, ai2.workNotes, ai2.toolTrace)
    } catch (err) {
      pushMessage('system', `Error: ${err instanceof Error ? err.message : err}`)
    } finally {
      setActiveThinker(null)
      setBusy(false)
      abortRef.current = null
    }
  }

  const handleDuoLoop = async () => {
    if (busy) return
    setBusy(true)
    try {
      let history = messagesRef.current
      for (let i = 0; i < rounds; i += 1) {
        setActiveThinker('ai1')
        const ai1 = await callModel(ai1Model, ai1Prompt, history)
        if (ai1.workNotes) {
          setWorkNotes((prev) => ({ ...prev, ai1: ai1.workNotes || '' }))
        }
        if (ai1.toolTrace) {
          setToolTraces((prev) => ({ ...prev, ai1: ai1.toolTrace || null }))
        }
        history = pushMessage(
          'ai1',
          ai1.response,
          ai1.workNotes,
          ai1.toolTrace
        )
        setActiveThinker('ai2')
        const ai2 = await callModel(ai2Model, ai2Prompt, history)
        if (ai2.workNotes) {
          setWorkNotes((prev) => ({ ...prev, ai2: ai2.workNotes || '' }))
        }
        if (ai2.toolTrace) {
          setToolTraces((prev) => ({ ...prev, ai2: ai2.toolTrace || null }))
        }
        history = pushMessage(
          'ai2',
          ai2.response,
          ai2.workNotes,
          ai2.toolTrace
        )
      }
    } catch (err) {
      pushMessage('system', `Error: ${err instanceof Error ? err.message : err}`)
    } finally {
      setActiveThinker(null)
      setBusy(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setActiveThinker(null)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Trio Convo</p>
          <h1>Talk with two Ollama models and the web</h1>
          <p className="subtitle">
            You + AI-1 + AI-2. Each model can call web search tools when needed.
          </p>
        </div>
        <div className="status-card">
          <span className={`status-dot ${busy ? 'busy' : ''}`}></span>
          <div>
            <p className="status-title">Status</p>
            <p className="status-value">{statusText}</p>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="chat">
          <div className="chat-log">
            {messages.length === 0 && (
              <div className="empty">
                <p>Start by sending a message or run a duo loop.</p>
                <p className="muted">
                  Tip: keep prompts short and specific for faster responses.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`bubble ${msg.speaker}`}>
                <div className="bubble-meta">
                  <span className="speaker">{msg.speaker}</span>
                  <span className="time">{msg.timestamp}</span>
                </div>
                <p>{msg.text}</p>
                {msg.workNotes && (
                  <div className="work-notes">
                    <p className="work-title">Work notes</p>
                    <pre>{msg.workNotes}</pre>
                  </div>
                )}
                {msg.toolTrace?.type === 'search' && (
                  <div className="work-notes">
                    <p className="work-title">Web evidence</p>
                    <p className="work-meta">
                      Provider: {msg.toolTrace.provider} • Query:{' '}
                      {msg.toolTrace.query}
                    </p>
                    <div className="evidence-list">
                      {msg.toolTrace.results.map((item) => (
                        <div key={item.url} className="evidence-item">
                          <p className="evidence-title">{item.title}</p>
                          <p className="evidence-url">{item.url}</p>
                          {item.snippet && (
                            <p className="evidence-snippet">{item.snippet}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {msg.toolTrace?.type === 'fetch' && (
                  <div className="work-notes">
                    <p className="work-title">Web fetch</p>
                    <p className="work-meta">
                      Provider: {msg.toolTrace.provider} • URL:{' '}
                      {msg.toolTrace.url}
                    </p>
                    {msg.toolTrace.title && (
                      <p className="evidence-title">{msg.toolTrace.title}</p>
                    )}
                    {msg.toolTrace.content && (
                      <p className="evidence-snippet">
                        {msg.toolTrace.content.slice(0, 400)}
                        {msg.toolTrace.content.length > 400 ? '…' : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && activeThinker && (
              <div className={`bubble ${activeThinker}`}>
                <div className="bubble-meta">
                  <span className="speaker">{activeThinker}</span>
                  <span className="time">thinking…</span>
                </div>
                <p>Thinking…</p>
              </div>
            )}
          </div>
          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              rows={3}
            />
            <div className="composer-actions">
              <button onClick={handleSend} disabled={busy || !input.trim()}>
                Send to both
              </button>
              <button onClick={handleDuoLoop} disabled={busy}>
                Run duo loop
              </button>
              <button onClick={handleStop} className="ghost">
                Stop
              </button>
            </div>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-section">
            <h2>Models</h2>
            <label>
              AI-1 model
              <input
                value={ai1Model}
                onChange={(e) => setAi1Model(e.target.value)}
              />
            </label>
            <label>
              AI-1 system prompt
              <textarea
                value={ai1Prompt}
                onChange={(e) => setAi1Prompt(e.target.value)}
                rows={3}
              />
            </label>
            <label>
              AI-2 model
              <input
                value={ai2Model}
                onChange={(e) => setAi2Model(e.target.value)}
              />
            </label>
            <label>
              AI-2 system prompt
              <textarea
                value={ai2Prompt}
                onChange={(e) => setAi2Prompt(e.target.value)}
                rows={3}
              />
            </label>
          </div>

          <div className="panel-section">
            <h2>Web tools</h2>
            <label className="inline">
              <input
                type="checkbox"
                checked={toolsEnabled}
                onChange={(e) => setToolsEnabled(e.target.checked)}
              />
              Enable web search tool
            </label>
            <label>
              Primary provider
              <select
                value={searchProvider}
                onChange={(e) => setSearchProvider(e.target.value)}
              >
                <option value="duckduckgo">DuckDuckGo (no key)</option>
                <option value="ollama">Ollama Web Search (key)</option>
                <option value="tavily">Tavily (key)</option>
                <option value="serper">Serper (key)</option>
                <option value="serpapi">SerpAPI (key)</option>
              </select>
            </label>
            <label>
              Fallback provider
              <select
                value={searchFallback}
                onChange={(e) => setSearchFallback(e.target.value)}
              >
                <option value="duckduckgo">DuckDuckGo (no key)</option>
                <option value="ollama">Ollama Web Search (key)</option>
                <option value="tavily">Tavily (key)</option>
                <option value="serper">Serper (key)</option>
                <option value="serpapi">SerpAPI (key)</option>
              </select>
            </label>
          </div>

          <div className="panel-section">
            <h2>Thinking stream</h2>
            <div className="thinking-block">
              <p className="thinking-title">AI-1 notes</p>
              <pre>{activeThinker === 'ai1' ? 'Thinking…' : workNotes.ai1 || '—'}</pre>
            </div>
            <div className="thinking-block">
              <p className="thinking-title">AI-2 notes</p>
              <pre>{activeThinker === 'ai2' ? 'Thinking…' : workNotes.ai2 || '—'}</pre>
            </div>
            <div className="thinking-block">
              <p className="thinking-title">AI-1 evidence</p>
              {toolTraces.ai1?.type === 'search' ? (
                <div className="evidence-compact">
                  <p className="work-meta">
                    Provider: {toolTraces.ai1.provider} • Query:{' '}
                    {toolTraces.ai1.query}
                  </p>
                  {toolTraces.ai1.results.map((item) => (
                    <p key={item.url} className="evidence-title">
                      {item.title}
                    </p>
                  ))}
                </div>
              ) : toolTraces.ai1?.type === 'fetch' ? (
                <div className="evidence-compact">
                  <p className="work-meta">
                    Provider: {toolTraces.ai1.provider} • URL:{' '}
                    {toolTraces.ai1.url}
                  </p>
                  {toolTraces.ai1.title && (
                    <p className="evidence-title">{toolTraces.ai1.title}</p>
                  )}
                </div>
              ) : (
                <p className="work-meta">—</p>
              )}
            </div>
            <div className="thinking-block">
              <p className="thinking-title">AI-2 evidence</p>
              {toolTraces.ai2?.type === 'search' ? (
                <div className="evidence-compact">
                  <p className="work-meta">
                    Provider: {toolTraces.ai2.provider} • Query:{' '}
                    {toolTraces.ai2.query}
                  </p>
                  {toolTraces.ai2.results.map((item) => (
                    <p key={item.url} className="evidence-title">
                      {item.title}
                    </p>
                  ))}
                </div>
              ) : toolTraces.ai2?.type === 'fetch' ? (
                <div className="evidence-compact">
                  <p className="work-meta">
                    Provider: {toolTraces.ai2.provider} • URL:{' '}
                    {toolTraces.ai2.url}
                  </p>
                  {toolTraces.ai2.title && (
                    <p className="evidence-title">{toolTraces.ai2.title}</p>
                  )}
                </div>
              ) : (
                <p className="work-meta">—</p>
              )}
            </div>
          </div>

          <div className="panel-section">
            <h2>Control</h2>
            <label>
              Temperature: {temperature.toFixed(2)}
              <input
                type="range"
                min={0}
                max={1.2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </label>
            <label>
              Duo loop rounds
              <input
                type="number"
                min={1}
                max={12}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="panel-section footnote">
            <p>
              Ollama must be running locally. Example models:{' '}
              <code>qwen3:4b</code> and <code>gemma3:4b</code>.
            </p>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
