# Trio AI Convo — Multi-Model Collaborative Chat

Trio AI Convo is an experimental application for letting **three configurable language-model participants work through the same conversation sequentially**, using a mixture of local and cloud-hosted Ollama-compatible models.

The project is best understood as **multi-model orchestration** rather than a claim of fully autonomous multi-agent research. Each participant receives the evolving conversation history, contributes a response, and passes that updated context to the next model.

## How it works

A normal turn follows this pattern:

```text
User message
    ↓
AI-1 (cloud or configured host)
    ↓
updated conversation history
    ↓
AI-2 (local/configured host)
    ↓
updated conversation history
    ↓
AI-3 (local/configured host)
    ↓
final shared history
```

The interface can also run repeated deliberation rounds, causing the three participants to continue responding to the conversation produced by the previous participants.

Each model has its own:

- model selection
- system prompt
- host selection
- visible response
- short work notes
- tool trace

## Tool use

The backend supports model-requested web tools through a structured JSON tool-call protocol.

Supported behaviors include:

- web search
- page fetching
- provider selection
- fallback providers when a configured provider is unavailable
- bounded tool steps
- structured final responses after tool use

Search implementations include DuckDuckGo plus optional provider integrations such as Tavily, Serper, SerpAPI, and Ollama web search when the corresponding credentials are available.

## Reliability behavior

The project evolved beyond simply calling three models in sequence. It also includes:

- request cancellation with `AbortController`
- local-vs-cloud host selection
- trimmed history for smaller local models
- provider fallbacks
- request timeouts
- retry/error handling
- validation of empty model responses
- parsing of structured tool calls
- safe, short high-level work notes rather than hidden reasoning traces
- visible tool results/errors for inspection in the UI

The later commits specifically focused on cloud-host/tool-trace improvements and model/tool error handling.

## Architecture

```text
React / TypeScript client
        ↓
Express API
        ↓
Conversation orchestrator
   ├── AI-1
   ├── AI-2
   └── AI-3
        ↓
Optional tool layer
   ├── search
   └── fetch
        ↓
Local Ollama or configured cloud host
```

## Technology

### Client

- React
- TypeScript
- Vite

### Server

- Node.js
- Express
- Ollama-compatible model endpoints
- configurable search/fetch integrations

## Running locally

Install the root, client, and server dependencies:

```bash
npm install
npm --prefix client install
npm --prefix server install
```

Start Ollama locally if you want to use local models, then run both the client and server:

```bash
npm run dev
```

The server defaults to:

```text
http://localhost:3001
```

and local Ollama defaults to:

```text
http://localhost:11434
```

Optional provider/API credentials can be placed in the server environment when those integrations are used.

## What I learned

This project helped separate several concepts that are easy to blur together when building AI applications:

- model capability vs orchestration logic
- shared context vs independent system prompts
- local inference vs hosted inference
- tool invocation vs ordinary generation
- failure recovery vs model quality
- a multi-model workflow vs genuinely autonomous agents

It became a useful bridge between simple LLM integration and the more stateful autonomous-agent architecture explored later in Money Machine.

## Scope

Trio AI Convo is a software-engineering experiment, not a published evaluation of whether three models outperform one. A rigorous next step would require defined tasks, baselines, reproducible metrics, cost/latency analysis, and controlled comparisons across orchestration strategies.
