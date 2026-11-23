import { Character, Persona, PromptMessage, PromptPreview, RpMessage, RpSession } from '@shared/index';

export function replacePlaceholders(text: string, charName: string, userName: string): string {
  if (!text) return '';
  return text
    .replace(/\{\{\s*char\s*\}\}/gi, charName)
    .replace(/\{\{\s*user\s*\}\}/gi, userName);
}

/**
 * Builds the single static-prefix system message (index 0) using XML semantic tags
 * for maximum KV-cache prefix reuse and model-agnostic compatibility.
 */
export function buildStaticSystemPrompt(
  session: Pick<RpSession, 'directives' | 'scenarioOverride'>,
  character: Character,
  persona: Persona
): string {
  const charName = character.name.trim();
  const userName = persona.name.trim();
  const sub = (s: string) => replacePlaceholders(s.trim(), charName, userName);

  const sections: string[] = [];

  const directives = sub(session.directives);
  if (directives) {
    sections.push(`<directives>\n${directives}\n</directives>`);
  }

  const charParts: string[] = [];
  if (character.description.trim()) charParts.push(sub(character.description));
  if (character.personality.trim()) charParts.push(`Personality: ${sub(character.personality)}`);
  if (character.speechPatterns.trim()) charParts.push(`Speech & Style: ${sub(character.speechPatterns)}`);

  if (charParts.length > 0) {
    sections.push(`<character name="${charName}">\n${charParts.join('\n\n')}\n</character>`);
  } else {
    sections.push(`<character name="${charName}">\nRoleplay as ${charName}.\n</character>`);
  }

  const personaParts: string[] = [];
  if (persona.description.trim()) personaParts.push(sub(persona.description));
  if (persona.background.trim()) personaParts.push(`Background: ${sub(persona.background)}`);

  if (personaParts.length > 0) {
    sections.push(`<user_persona name="${userName}">\n${personaParts.join('\n\n')}\n</user_persona>`);
  } else {
    sections.push(`<user_persona name="${userName}">\nThe user is roleplaying as ${userName}.\n</user_persona>`);
  }

  const effectiveScenario = sub(session.scenarioOverride || character.scenario);
  if (effectiveScenario) {
    sections.push(`<scenario>\n${effectiveScenario}\n</scenario>`);
  }

  const examples = sub(character.exampleDialogue);
  if (examples) {
    sections.push(`<example_dialogue>\n${examples}\n</example_dialogue>`);
  }

  return sections.join('\n\n');
}

/**
 * Assembles the OpenAI-compatible messages[] array:
 * - Index 0: Single immutable static system prompt
 * - History: Clean alternating user/assistant turns
 * - Depth 1: Optional <scene_note> and <cadence_reminder> injected inline
 *   at the top of the final user message (never as a second system message).
 */
export function assemblePrompt(opts: {
  session: Pick<RpSession, 'directives' | 'scenarioOverride' | 'sceneNote' | 'cadenceReminder'>;
  character: Character;
  persona: Persona;
  history: Pick<RpMessage, 'role' | 'content'>[];
}): PromptPreview {
  const { session, character, persona, history } = opts;
  const charName = character.name.trim();
  const userName = persona.name.trim();
  const sub = (s: string) => replacePlaceholders(s.trim(), charName, userName);

  const systemContent = buildStaticSystemPrompt(session, character, persona);
  const messages: PromptMessage[] = [{ role: 'system', content: systemContent }];

  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Dynamic Depth-1 injection into the final user turn
  const depthBlocks: string[] = [];
  const sceneNote = sub(session.sceneNote);
  const cadenceReminder = sub(session.cadenceReminder);

  if (sceneNote) {
    depthBlocks.push(`<scene_note>\n${sceneNote}\n</scene_note>`);
  }
  if (cadenceReminder) {
    depthBlocks.push(`<cadence_reminder>\n${cadenceReminder}\n</cadence_reminder>`);
  }

  if (depthBlocks.length > 0) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 1; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx !== -1) {
      messages[lastUserIdx] = {
        role: 'user',
        content: `${depthBlocks.join('\n\n')}\n\n${messages[lastUserIdx].content}`,
      };
    }
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length + 16, 0);
  return {
    messages,
    estimatedTokens: Math.ceil(totalChars / 4),
    staticPrefixChars: systemContent.length,
  };
}

/**
 * Assembles a KV-cache-friendly prompt for auto-suggesting the user's next reply:
 * - Index 0: Identical static system prompt (100% prefix cache hit)
 * - Indices 1..N: Unmodified conversation history (100% history cache hit)
 * - Tail (Depth 0 ephemeral user turn): <impersonate_request> using the customizable
 *   suggestPrompt template (plus optional <user_hint>, <scene_note>, <cadence_reminder>).
 */
export function assembleSuggestPrompt(opts: {
  session: Pick<
    RpSession,
    'directives' | 'scenarioOverride' | 'sceneNote' | 'cadenceReminder' | 'suggestPrompt'
  >;
  character: Character;
  persona: Persona;
  history: Pick<RpMessage, 'role' | 'content'>[];
  hint?: string;
  fallbackSuggestPrompt: string;
}): PromptMessage[] {
  const { session, character, persona, history, hint, fallbackSuggestPrompt } = opts;
  const charName = character.name.trim();
  const userName = persona.name.trim();
  const sub = (s: string) => replacePlaceholders(s.trim(), charName, userName);

  const systemContent = buildStaticSystemPrompt(session, character, persona);
  const messages: PromptMessage[] = [{ role: 'system', content: systemContent }];

  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  const tailBlocks: string[] = [];
  const sceneNote = sub(session.sceneNote);
  const cadenceReminder = sub(session.cadenceReminder);

  if (sceneNote) {
    tailBlocks.push(`<scene_note>\n${sceneNote}\n</scene_note>`);
  }
  if (cadenceReminder) {
    tailBlocks.push(`<cadence_reminder>\n${cadenceReminder}\n</cadence_reminder>`);
  }

  const instruction = sub(session.suggestPrompt || fallbackSuggestPrompt);
  const trimmedHint = hint ? sub(hint) : '';

  if (trimmedHint) {
    tailBlocks.push(
      `<impersonate_request>\n${instruction}\n\n<user_hint>\nIncorporate and expand this direction from ${userName}: ${trimmedHint}\n</user_hint>\n</impersonate_request>`
    );
  } else {
    tailBlocks.push(`<impersonate_request>\n${instruction}\n</impersonate_request>`);
  }

  messages.push({
    role: 'user',
    content: tailBlocks.join('\n\n'),
  });

  return messages;
}
