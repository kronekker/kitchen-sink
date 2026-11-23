import { Character, Persona, RpMessage, RpSession } from '@shared/index';
import { resolveActiveEngine } from './inference-router';

function shortenAnchors(text: string, maxLen = 140): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'distinctive appearance from reference image';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() + '...' : cleaned;
}

function buildFallbackSceneSummary(
  session: RpSession | null,
  character: Character | null,
  messages: RpMessage[],
  extraNotes?: string
): string {
  const parts: string[] = [];
  const scenario = session?.scenarioOverride || character?.scenario || '';
  if (scenario.trim()) parts.push(scenario.trim());
  if (session?.sceneNote?.trim()) parts.push(`Mood/note: ${session.sceneNote.trim()}`);

  const recent = messages.slice(-4);
  if (recent.length > 0) {
    const snippet = recent
      .map((m) => `${m.role === 'assistant' ? character?.name || 'Character' : 'User'}: ${m.content.replace(/\s+/g, ' ').slice(0, 220)}`)
      .join(' | ');
    parts.push(`Recent moment: ${snippet}`);
  }

  if (extraNotes?.trim()) {
    parts.push(extraNotes.trim());
  }

  return parts.join('\n') || 'An atmospheric moment in the current roleplay scene.';
}

export function renderImageTemplate(opts: {
  template: string;
  character?: Character | null;
  persona?: Persona | null;
  session?: RpSession | null;
  messages?: RpMessage[];
  extraNotes?: string;
}): string {
  const charName = opts.character?.name || 'Character';
  const userName = opts.persona?.name || 'User';
  const sceneContext = buildFallbackSceneSummary(
    opts.session ?? null,
    opts.character ?? null,
    opts.messages ?? [],
    opts.extraNotes
  );

  const replacements: Record<string, string> = {
    char: charName,
    char_description: opts.character?.description?.trim() || charName,
    char_personality: opts.character?.personality?.trim() || 'composed and expressive',
    char_anchors: shortenAnchors(opts.character?.description || ''),
    user: userName,
    user_description: opts.persona?.description?.trim() || userName,
    user_background: opts.persona?.background?.trim() || 'grounded presence',
    user_anchors: shortenAnchors(opts.persona?.description || ''),
    scene_context: sceneContext,
    extra_notes: opts.extraNotes?.trim() || '',
  };

  let out = opts.template;
  for (const [key, val] of Object.entries(replacements)) {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    out = out.replace(re, val);
  }
  return out.trim();
}

/**
 * Optionally uses the active local LLM (8080/8081) to distill the recent RP transcript
 * into a crisp, concrete visual image prompt following the template's structure.
 * Falls back cleanly to template rendering if no local LLM is online.
 */
export async function draftImagePrompt(opts: {
  template: string;
  character?: Character | null;
  persona?: Persona | null;
  session?: RpSession | null;
  messages?: RpMessage[];
  extraNotes?: string;
  useLlm?: boolean;
}): Promise<{ prompt: string; usedLlm: boolean }> {
  const basePrompt = renderImageTemplate(opts);
  if (!opts.useLlm) {
    return { prompt: basePrompt, usedLlm: false };
  }

  const engine = await resolveActiveEngine();
  if (engine.status !== 'online' || !engine.baseUrl) {
    return { prompt: basePrompt, usedLlm: false };
  }

  const modelId = engine.activeModel || 'local-model';
  const baseUrl = engine.baseUrl.replace(/\/+$/, '');

  const recentTranscript = (opts.messages ?? [])
    .slice(-6)
    .map(
      (m) =>
        `${m.role === 'assistant' ? opts.character?.name || 'Character' : opts.persona?.name || 'User'}: ${m.content}`
    )
    .join('\n\n');

  const systemInstruction =
    'You are an expert visual prompt writer for an image-to-image model (Seedream 5.5). ' +
    'Rewrite the provided draft prompt into a clean, vivid, concrete visual image prompt based on the recent roleplay scene. ' +
    'Preserve any [SECTION] headers and Image 1 / Image 2 identity anchors exactly so there is no identity bleeding. ' +
    'Describe visible clothing, poses, spatial layout, props, lighting, and expressions — never include dialogue quotes, meta commentary, or thinking tags. ' +
    'Output ONLY the final image prompt.';

  const userContent = [
    'Draft template to refine:',
    basePrompt,
    recentTranscript ? `\nRecent RP transcript for visual context:\n${recentTranscript}` : '',
    opts.extraNotes?.trim() ? `\nExtra user direction:\n${opts.extraNotes.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContent },
        ],
        temperature: 0.65,
        max_tokens: 450,
        stream: false,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      return { prompt: basePrompt, usedLlm: false };
    }

    const json: any = await res.json().catch(() => null);
    let content: string = json?.choices?.[0]?.message?.content || '';
    // Strip any <think>...</think> blocks if the local model emitted them
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!content) {
      return { prompt: basePrompt, usedLlm: false };
    }

    return { prompt: content, usedLlm: true };
  } catch {
    return { prompt: basePrompt, usedLlm: false };
  }
}
