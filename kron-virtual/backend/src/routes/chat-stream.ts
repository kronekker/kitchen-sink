import { Router, Request, Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { DEFAULT_SUGGEST_PROMPT } from '../db/init';
import { characters, personas, rpMessages, rpSessions } from '../db/schema';
import {
  ChatMetrics,
  ChatStreamEvent,
  ChatStreamRequest,
  InferenceParams,
  SuggestReplyRequest,
  SuggestStreamEvent,
} from '@shared/index';
import { toCharacterDto } from './characters';
import { toPersonaDto } from './personas';
import { toMessageDto, toSessionDto } from './sessions';
import { resolveActiveEngine } from '../services/inference-router';
import { assemblePrompt, assembleSuggestPrompt } from '../services/prompt-assembler';

const router = Router();

function sendSse(res: Response, event: ChatStreamEvent): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function sanitizeStandardParams(params?: InferenceParams): Record<string, number> {
  const out: Record<string, number> = {};
  if (!params) return out;
  if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
    out['temperature'] = Math.max(0, Math.min(2, params.temperature));
  }
  if (typeof params.top_p === 'number' && Number.isFinite(params.top_p)) {
    out['top_p'] = Math.max(0, Math.min(1, params.top_p));
  }
  if (typeof params.max_tokens === 'number' && Number.isInteger(params.max_tokens) && params.max_tokens > 0) {
    out['max_tokens'] = params.max_tokens;
  }
  return out;
}

function sanitizeExtendedParams(params?: InferenceParams): Record<string, number> {
  const out: Record<string, number> = {};
  if (!params) return out;
  if (typeof params.min_p === 'number' && Number.isFinite(params.min_p)) {
    out['min_p'] = Math.max(0, Math.min(1, params.min_p));
  }
  if (typeof params.dry_multiplier === 'number' && Number.isFinite(params.dry_multiplier) && params.dry_multiplier > 0) {
    out['dry_multiplier'] = Math.max(0, Math.min(5, params.dry_multiplier));
    if (typeof params.dry_base === 'number' && Number.isFinite(params.dry_base)) {
      out['dry_base'] = Math.max(1, Math.min(4, params.dry_base));
    }
    if (typeof params.dry_allowed_length === 'number' && Number.isInteger(params.dry_allowed_length)) {
      out['dry_allowed_length'] = Math.max(1, Math.min(20, params.dry_allowed_length));
    }
  }
  return out;
}

class ThinkTagSplitter {
  private inThink = false;
  private buffer = '';

  push(chunk: string): { content: string; reasoning: string } {
    this.buffer += chunk;
    let content = '';
    let reasoning = '';

    while (this.buffer.length > 0) {
      if (!this.inThink) {
        const openIdx = this.buffer.indexOf('<think>');
        if (openIdx !== -1) {
          content += this.buffer.slice(0, openIdx);
          this.buffer = this.buffer.slice(openIdx + '<think>'.length);
          this.inThink = true;
          continue;
        }
        const partialIdx = this.buffer.lastIndexOf('<');
        if (partialIdx !== -1 && '<think>'.startsWith(this.buffer.slice(partialIdx))) {
          content += this.buffer.slice(0, partialIdx);
          this.buffer = this.buffer.slice(partialIdx);
          break;
        }
        content += this.buffer;
        this.buffer = '';
      } else {
        const closeIdx = this.buffer.indexOf('</think>');
        if (closeIdx !== -1) {
          reasoning += this.buffer.slice(0, closeIdx);
          this.buffer = this.buffer.slice(closeIdx + '</think>'.length);
          this.inThink = false;
          continue;
        }
        const partialIdx = this.buffer.lastIndexOf('<');
        if (partialIdx !== -1 && '</think>'.startsWith(this.buffer.slice(partialIdx))) {
          reasoning += this.buffer.slice(0, partialIdx);
          this.buffer = this.buffer.slice(partialIdx);
          break;
        }
        reasoning += this.buffer;
        this.buffer = '';
      }
    }

    return { content, reasoning };
  }

  flush(): { content: string; reasoning: string } {
    const rem = this.buffer;
    this.buffer = '';
    if (!rem) return { content: '', reasoning: '' };
    return this.inThink ? { content: '', reasoning: rem } : { content: rem, reasoning: '' };
  }
}

function buildMetrics(opts: {
  requestStartMs: number;
  firstTokenMs: number | null;
  lastTokenMs: number | null;
  exactCompletionTokens: number | null;
  exactPromptTokens: number | null;
  exactTps: number | null;
  streamedChunks: number;
}): ChatMetrics {
  const now = performance.now();
  const totalMs = Math.max(1, Math.round(now - opts.requestStartMs));
  const ttftMs = opts.firstTokenMs !== null ? Math.round(opts.firstTokenMs - opts.requestStartMs) : null;

  const estimated = opts.exactCompletionTokens === null;
  const completionTokens = opts.exactCompletionTokens ?? opts.streamedChunks;

  let tokensPerSecond: number | null = opts.exactTps;
  if (tokensPerSecond === null && completionTokens > 0) {
    const genWindowMs =
      opts.firstTokenMs !== null && opts.lastTokenMs !== null && opts.lastTokenMs > opts.firstTokenMs
        ? opts.lastTokenMs - opts.firstTokenMs
        : totalMs;
    tokensPerSecond = Number((completionTokens / (genWindowMs / 1000)).toFixed(2));
  } else if (tokensPerSecond !== null) {
    tokensPerSecond = Number(tokensPerSecond.toFixed(2));
  }

  return {
    ttftMs,
    totalMs,
    completionTokens,
    promptTokens: opts.exactPromptTokens,
    tokensPerSecond,
    estimated,
  };
}

// POST /api/chat/stream
router.post('/stream', async (req: Request, res: Response) => {
  const body: ChatStreamRequest = req.body ?? ({} as ChatStreamRequest);
  const sessionId = Number(body.sessionId);
  const regenerate = Boolean(body.regenerate);
  const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';

  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ success: false, error: 'Valid sessionId is required.' });
    return;
  }

  if (!regenerate && !userMessage) {
    res.status(400).json({ success: false, error: 'userMessage is required unless regenerate is true.' });
    return;
  }

  const sessionRow = db.select().from(rpSessions).where(eq(rpSessions.id, sessionId)).get();
  if (!sessionRow) {
    res.status(404).json({ success: false, error: 'RP session not found.' });
    return;
  }

  const charRow = db.select().from(characters).where(eq(characters.id, sessionRow.characterId)).get();
  const personaRow = db.select().from(personas).where(eq(personas.id, sessionRow.personaId)).get();
  if (!charRow || !personaRow) {
    res.status(404).json({ success: false, error: 'Session character or persona not found.' });
    return;
  }

  // Auto-detect active local inference engine (8080 or 8081)
  const engine = await resolveActiveEngine();
  if (engine.status !== 'online' || !engine.baseUrl || !engine.port) {
    res.status(503).json({
      success: false,
      error:
        engine.error ||
        'No active local inference engine found on localhost:8080 or localhost:8081.',
    });
    return;
  }

  const modelId = engine.activeModel || 'local-model';
  const engineLabel = engine.label || `localhost:${engine.port}`;
  const now = new Date().toISOString();

  // Persist any updated session-level RP controls sent along with the turn
  const currentSession = toSessionDto(sessionRow);
  const effectiveParams: InferenceParams = body.params ?? currentSession.params;
  const updatedSessionRow = db
    .update(rpSessions)
    .set({
      directives: body.directives !== undefined ? body.directives : sessionRow.directives,
      scenarioOverride:
        body.scenarioOverride !== undefined ? body.scenarioOverride : sessionRow.scenarioOverride,
      sceneNote: body.sceneNote !== undefined ? body.sceneNote : sessionRow.sceneNote,
      cadenceReminder:
        body.cadenceReminder !== undefined ? body.cadenceReminder : sessionRow.cadenceReminder,
      paramsJson: JSON.stringify(effectiveParams),
      updatedAt: now,
    })
    .where(eq(rpSessions.id, sessionId))
    .returning()
    .get();

  let savedUserMsgId: number | null = null;

  if (regenerate) {
    // Remove the trailing assistant message if present so we regenerate cleanly
    const existingMsgs = db
      .select()
      .from(rpMessages)
      .where(eq(rpMessages.sessionId, sessionId))
      .orderBy(asc(rpMessages.id))
      .all();
    const last = existingMsgs[existingMsgs.length - 1];
    if (last && last.role === 'assistant') {
      db.delete(rpMessages).where(eq(rpMessages.id, last.id)).run();
    }
  } else {
    const savedUser = db
      .insert(rpMessages)
      .values({
        sessionId,
        role: 'user',
        content: userMessage,
        reasoningContent: null,
        modelId,
        engineLabel,
        metricsJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    savedUserMsgId = savedUser.id;
  }

  // Assemble KV-cache-friendly XML prompt
  const historyRows = db
    .select()
    .from(rpMessages)
    .where(eq(rpMessages.sessionId, sessionId))
    .orderBy(asc(rpMessages.id))
    .all();

  const assembled = assemblePrompt({
    session: toSessionDto(updatedSessionRow),
    character: toCharacterDto(charRow),
    persona: toPersonaDto(personaRow),
    history: historyRows.map(toMessageDto),
  });

  const assembledSystemPrompt = assembled.messages[0]?.role === 'system' ? assembled.messages[0].content : '';

  // Switch response to SSE and emit 'start' (including assembled system prompt) BEFORE upstream fetch
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sendSse(res, {
    type: 'start',
    userMessageId: savedUserMsgId,
    modelId,
    engineLabel,
    port: engine.port,
    systemPrompt: assembledSystemPrompt,
  });

  const abortController = new AbortController();
  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  const baseUrl = engine.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  const standardParams = sanitizeStandardParams(effectiveParams);
  const extendedParams = sanitizeExtendedParams(effectiveParams);

  const fullPayload: Record<string, any> = {
    model: modelId,
    messages: assembled.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...standardParams,
    ...extendedParams,
  };

  const requestStartMs = performance.now();
  let firstTokenMs: number | null = null;
  let lastTokenMs: number | null = null;
  let streamedChunks = 0;
  let exactCompletionTokens: number | null = null;
  let exactPromptTokens: number | null = null;
  let exactTps: number | null = null;
  let fullContent = '';
  let fullReasoning = '';
  let lastMetricsEmitMs = 0;

  const splitter = new ThinkTagSplitter();

  try {
    let upstreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(fullPayload),
      signal: abortController.signal,
    });

    // Fallback for servers that reject stream_options or llama.cpp-specific samplers (min_p / dry_*)
    if (upstreamRes.status === 400 || upstreamRes.status === 422) {
      const minimalPayload: Record<string, any> = {
        model: modelId,
        messages: assembled.messages,
        stream: true,
        ...standardParams,
      };
      upstreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(minimalPayload),
        signal: abortController.signal,
      });
    }

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => '');
      sendSse(res, {
        type: 'error',
        error: `Upstream HTTP ${upstreamRes.status} (${engineLabel}): ${errText.slice(0, 300) || upstreamRes.statusText}`,
      });
      res.end();
      return;
    }

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.usage) {
          if (typeof parsed.usage.completion_tokens === 'number') {
            exactCompletionTokens = parsed.usage.completion_tokens;
          }
          if (typeof parsed.usage.prompt_tokens === 'number') {
            exactPromptTokens = parsed.usage.prompt_tokens;
          }
        }
        if (parsed.timings) {
          if (typeof parsed.timings.predicted_n === 'number') {
            exactCompletionTokens = parsed.timings.predicted_n;
          }
          if (typeof parsed.timings.prompt_n === 'number') {
            exactPromptTokens = parsed.timings.prompt_n;
          }
          if (typeof parsed.timings.predicted_per_second === 'number') {
            exactTps = parsed.timings.predicted_per_second;
          }
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        let outContent = '';
        let outReasoning = '';

        const rawReasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof rawReasoning === 'string' && rawReasoning.length > 0) {
          outReasoning += rawReasoning;
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          const split = splitter.push(delta.content);
          outContent += split.content;
          outReasoning += split.reasoning;
        }

        if (outContent || outReasoning) {
          const tickMs = performance.now();
          if (firstTokenMs === null) firstTokenMs = tickMs;
          lastTokenMs = tickMs;
          streamedChunks += 1;

          fullContent += outContent;
          fullReasoning += outReasoning;

          sendSse(res, {
            type: 'delta',
            content: outContent || undefined,
            reasoning: outReasoning || undefined,
          });

          if (tickMs - lastMetricsEmitMs >= 150) {
            lastMetricsEmitMs = tickMs;
            sendSse(res, {
              type: 'metrics',
              metrics: buildMetrics({
                requestStartMs,
                firstTokenMs,
                lastTokenMs,
                exactCompletionTokens,
                exactPromptTokens,
                exactTps,
                streamedChunks,
              }),
            });
          }
        }
      }
    }

    const tail = splitter.flush();
    if (tail.content || tail.reasoning) {
      fullContent += tail.content;
      fullReasoning += tail.reasoning;
      sendSse(res, {
        type: 'delta',
        content: tail.content || undefined,
        reasoning: tail.reasoning || undefined,
      });
    }
  } catch (err: any) {
    if (!clientDisconnected && err?.name !== 'AbortError') {
      sendSse(res, {
        type: 'error',
        error: err?.message || 'Error streaming from local inference engine.',
      });
    }
  }

  if (fullContent.length > 0 || fullReasoning.length > 0) {
    const finalMetrics = buildMetrics({
      requestStartMs,
      firstTokenMs,
      lastTokenMs,
      exactCompletionTokens,
      exactPromptTokens,
      exactTps,
      streamedChunks,
    });

    const completedAt = new Date().toISOString();
    const savedAssistant = db
      .insert(rpMessages)
      .values({
        sessionId,
        role: 'assistant',
        content: fullContent,
        reasoningContent: fullReasoning.length > 0 ? fullReasoning : null,
        systemPrompt: assembledSystemPrompt || null,
        modelId,
        engineLabel,
        metricsJson: JSON.stringify(finalMetrics),
        createdAt: completedAt,
        updatedAt: completedAt,
      })
      .returning()
      .get();

    db.update(rpSessions)
      .set({ updatedAt: completedAt })
      .where(eq(rpSessions.id, sessionId))
      .run();

    sendSse(res, { type: 'metrics', metrics: finalMetrics });
    sendSse(res, { type: 'done', assistantMessage: toMessageDto(savedAssistant) });
  }

  if (!res.writableEnded) {
    res.end();
  }
});

function sendSuggestSse(res: Response, event: SuggestStreamEvent): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function stripLeadingSpeakerLabel(text: string, personaName: string): string {
  const escaped = personaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*`, 'i');
  return text.replace(re, '').trim();
}

// POST /api/chat/suggest — KV-cache-friendly user reply suggestion (non-persisted)
router.post('/suggest', async (req: Request, res: Response) => {
  const body: SuggestReplyRequest = req.body ?? ({} as SuggestReplyRequest);
  const sessionId = Number(body.sessionId);

  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ success: false, error: 'Valid sessionId is required.' });
    return;
  }

  const sessionRow = db.select().from(rpSessions).where(eq(rpSessions.id, sessionId)).get();
  if (!sessionRow) {
    res.status(404).json({ success: false, error: 'RP session not found.' });
    return;
  }

  const charRow = db.select().from(characters).where(eq(characters.id, sessionRow.characterId)).get();
  const personaRow = db.select().from(personas).where(eq(personas.id, sessionRow.personaId)).get();
  if (!charRow || !personaRow) {
    res.status(404).json({ success: false, error: 'Session character or persona not found.' });
    return;
  }

  const engine = await resolveActiveEngine();
  if (engine.status !== 'online' || !engine.baseUrl || !engine.port) {
    res.status(503).json({
      success: false,
      error:
        engine.error ||
        'No active local inference engine found on localhost:8080 or localhost:8081.',
    });
    return;
  }

  const modelId = engine.activeModel || 'local-model';
  const currentSession = toSessionDto(sessionRow);
  const effectiveParams: InferenceParams = body.params ?? currentSession.params;

  // Persist any updated Depth-1 / suggestPrompt edits without touching rp_messages
  const updatedSessionRow = db
    .update(rpSessions)
    .set({
      sceneNote: body.sceneNote !== undefined ? body.sceneNote : sessionRow.sceneNote,
      cadenceReminder:
        body.cadenceReminder !== undefined ? body.cadenceReminder : sessionRow.cadenceReminder,
      suggestPrompt:
        body.suggestPrompt !== undefined ? body.suggestPrompt : sessionRow.suggestPrompt,
      paramsJson: JSON.stringify(effectiveParams),
    })
    .where(eq(rpSessions.id, sessionId))
    .returning()
    .get();

  const historyRows = db
    .select()
    .from(rpMessages)
    .where(eq(rpMessages.sessionId, sessionId))
    .orderBy(asc(rpMessages.id))
    .all();

  const messages = assembleSuggestPrompt({
    session: toSessionDto(updatedSessionRow),
    character: toCharacterDto(charRow),
    persona: toPersonaDto(personaRow),
    history: historyRows.map(toMessageDto),
    hint: typeof body.hint === 'string' ? body.hint : undefined,
    fallbackSuggestPrompt: DEFAULT_SUGGEST_PROMPT,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abortController = new AbortController();
  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  const baseUrl = engine.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  const standardParams = sanitizeStandardParams(effectiveParams);
  const extendedParams = sanitizeExtendedParams(effectiveParams);

  const fullPayload: Record<string, any> = {
    model: modelId,
    messages,
    stream: true,
    ...standardParams,
    ...extendedParams,
  };

  let fullContent = '';
  const splitter = new ThinkTagSplitter();

  try {
    let upstreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(fullPayload),
      signal: abortController.signal,
    });

    if (upstreamRes.status === 400 || upstreamRes.status === 422) {
      upstreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: true,
          ...standardParams,
        }),
        signal: abortController.signal,
      });
    }

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => '');
      sendSuggestSse(res, {
        type: 'error',
        error: `Upstream HTTP ${upstreamRes.status}: ${errText.slice(0, 300) || upstreamRes.statusText}`,
      });
      res.end();
      return;
    }

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta || typeof delta.content !== 'string' || delta.content.length === 0) continue;

        const split = splitter.push(delta.content);
        if (split.content) {
          fullContent += split.content;
          sendSuggestSse(res, { type: 'delta', content: split.content });
        }
      }
    }

    const tail = splitter.flush();
    if (tail.content) {
      fullContent += tail.content;
      sendSuggestSse(res, { type: 'delta', content: tail.content });
    }

    const cleaned = stripLeadingSpeakerLabel(fullContent, personaRow.name);
    sendSuggestSse(res, { type: 'done', content: cleaned });
  } catch (err: any) {
    if (!clientDisconnected && err?.name !== 'AbortError') {
      sendSuggestSse(res, {
        type: 'error',
        error: err?.message || 'Error streaming suggested reply from local inference engine.',
      });
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
});

export default router;
