import { Router, Request, Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { chatMessages, chatSessions, endpoints } from '../db/schema';
import { ChatMetrics, ChatStreamEvent, ChatStreamRequest, InferenceParams } from '@shared/index';
import { toMessageDto } from './chats';

const router = Router();

function sendSse(res: Response, event: ChatStreamEvent): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function sanitizeParams(params?: InferenceParams): Record<string, number> {
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

/**
 * Splits inline <think>...</think> tags from streamed text so thinking models
 * that embed tags inside `delta.content` render cleanly alongside models that
 * emit `delta.reasoning_content`.
 */
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
        // Hold back a potential partial '<think>' prefix at the tail
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
  const body: ChatStreamRequest = req.body ?? {};
  const sessionId = Number(body.sessionId);
  const endpointId = Number(body.endpointId);
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
  const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';

  if (!Number.isInteger(sessionId) || !Number.isInteger(endpointId) || !modelId || !userMessage) {
    res.status(400).json({
      success: false,
      error: 'sessionId, endpointId, modelId, and userMessage are required.',
    });
    return;
  }

  const session = db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get();
  if (!session) {
    res.status(404).json({ success: false, error: 'Chat session not found.' });
    return;
  }

  const endpoint = db.select().from(endpoints).where(eq(endpoints.id, endpointId)).get();
  if (!endpoint) {
    res.status(404).json({ success: false, error: 'Endpoint not found.' });
    return;
  }

  const now = new Date().toISOString();
  const effectiveSystemPrompt =
    body.systemPrompt !== undefined ? body.systemPrompt : session.systemPrompt;
  const effectiveParams = body.params ?? {};

  // Persist user message immediately
  const savedUserMsg = db
    .insert(chatMessages)
    .values({
      sessionId,
      role: 'user',
      content: userMessage,
      reasoningContent: null,
      modelId,
      endpointName: endpoint.name,
      metricsJson: null,
      createdAt: now,
    })
    .returning()
    .get();

  // Auto-title "New Chat" on first user message & save latest session config
  const nextTitle =
    session.title === 'New Chat'
      ? userMessage.replace(/\s+/g, ' ').slice(0, 56) + (userMessage.length > 56 ? '…' : '')
      : session.title;

  db.update(chatSessions)
    .set({
      title: nextTitle,
      endpointId,
      modelId,
      systemPrompt: effectiveSystemPrompt,
      paramsJson: JSON.stringify(effectiveParams),
      updatedAt: now,
    })
    .where(eq(chatSessions.id, sessionId))
    .run();

  // Build OpenAI messages array from persisted history
  const historyRows = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.id))
    .all();

  const openAiMessages: Array<{ role: string; content: string }> = [];
  if (effectiveSystemPrompt.trim().length > 0) {
    openAiMessages.push({ role: 'system', content: effectiveSystemPrompt.trim() });
  }
  for (const row of historyRows) {
    if (row.role === 'user' || row.role === 'assistant') {
      openAiMessages.push({ role: row.role, content: row.content });
    }
  }

  // Switch response to SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sendSse(res, {
    type: 'start',
    userMessageId: savedUserMsg.id,
    modelId,
    endpointName: endpoint.name,
  });

  const abortController = new AbortController();
  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (endpoint.apiKey) {
    headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
  }

  const basePayload: Record<string, any> = {
    model: modelId,
    messages: openAiMessages,
    stream: true,
    ...sanitizeParams(effectiveParams),
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
      body: JSON.stringify({ ...basePayload, stream_options: { include_usage: true } }),
      signal: abortController.signal,
    });

    // Fallback for servers that reject `stream_options`
    if (upstreamRes.status === 400 || upstreamRes.status === 422) {
      upstreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(basePayload),
        signal: abortController.signal,
      });
    }

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => '');
      sendSse(res, {
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

        // Capture usage / llama-server timings if present
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

          // Emit live metrics roughly every 150ms
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

    // Flush any remaining buffered text in splitter
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
        error: err?.message || 'Error streaming from upstream LLM server.',
      });
    }
  }

  // Persist assistant message if we received any output
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
      .insert(chatMessages)
      .values({
        sessionId,
        role: 'assistant',
        content: fullContent,
        reasoningContent: fullReasoning.length > 0 ? fullReasoning : null,
        modelId,
        endpointName: endpoint.name,
        metricsJson: JSON.stringify(finalMetrics),
        createdAt: completedAt,
      })
      .returning()
      .get();

    db.update(chatSessions)
      .set({ updatedAt: completedAt })
      .where(eq(chatSessions.id, sessionId))
      .run();

    sendSse(res, { type: 'metrics', metrics: finalMetrics });
    sendSse(res, { type: 'done', assistantMessage: toMessageDto(savedAssistant) });
  }

  if (!res.writableEnded) {
    res.end();
  }
});

export default router;
