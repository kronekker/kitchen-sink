There is no universal RP schema that models are trained on, so effective packaging comes down to three engineering constraints: **clear structural delimiters**, **positional attention bias**, and **KV-cache preservation**.

### 1. System Message Formatting & Model Conventions

Modern open-weight models (Qwen, DeepSeek, Llama, Mistral) are not trained on a single RP-specific format, but their post-training corpora heavily feature **XML-style semantic tags** and **Markdown headers**. Between the two, XML tags are generally the most reliable delimiter for RP engines because they explicitly mark where a multi-paragraph injected block starts and ends, preventing retrieved memories from bleeding into persona rules.

Avoid raw JSON or YAML for character sheets and lore unless you are using a model specifically fine-tuned for structured schemas. Prose or compact bullet points wrapped in XML tags yield much more natural RP output and reduce the risk of the model leaking bracketed formatting into dialogue.

A clean, cache-friendly top-to-bottom layout looks like this:

```text
[SYSTEM MESSAGE - Static Prefix (100% KV-cacheable)]
<directives>
Write in third-person limited, past tense. Stay strictly in character.
Avoid summarizing the user's actions or speaking for them.
</directives>

<character name="Vex">
Background, personality, flaws, speech patterns...
</character>

<user_persona name="Kael">
Physical appearance, relationship to Vex, key facts...
</user_persona>

<example_dialogue>
User: "You're late."
Vex: *She doesn't look up from checking the latch.* "And you're still breathing. Priorities."
</example_dialogue>

---
[CHAT HISTORY - Alternating user / assistant turns]
... older turns ...

[DYNAMIC INJECTION - Depth 1 or 2 (Near the end of the thread)]
<recalled_memories>
- [Memory] Kael lost his left-hand ring in the docks district three weeks ago.
</recalled_memories>

<scene_note>
Tone: tense, paranoid. Keep replies under 3 paragraphs.
</scene_note>

[FINAL USER MESSAGE]

```

**Why static-first matters locally:** Local inference engines rely heavily on prefix KV caching to avoid reprocessing thousands of tokens on every turn. If you inject dynamic vector/keyword memories into the *top* of your system prompt, you invalidate the KV cache on every turn where a new memory triggers. Keeping the character card, user persona, and base directives immutable at the top—and pushing dynamic RAG/lore hits near the bottom—preserves your prompt-processing speed.

---

### 2. Multiple System Messages: Allowed vs. Effective

While the ChatML format technically permits multiple `system` role messages anywhere in a thread, **avoid relying on mid-conversation `system` roles if you want your engine to be model-agnostic.**

* **Chat template breakage:** Many strict Jinja chat templates (Mistral, Gemma, and several Llama/DeepSeek variants) explicitly assume a single `system` message at index `0`. Sending a second `system` message mid-thread will often trigger a template error from the inference server, silently drop the message, or mangle the turn boundaries.
* **Training distribution mismatch:** Even when a template accepts mid-thread `system` messages, most models see almost exclusively single-leading-system threads during instruction tuning. Mid-thread `system` blocks can cause smaller or heavily quantized models to break character or treat the next turn as an assistant-mode Q&A.

**The standard workaround:** Keep a single `system` message at index `0` for static context. For dynamic mid-thread injections (retrieved lore, scene state, or style nudges), inject them either:

1. **Inline inside a `user` turn** using a distinct wrapper (e.g., prepending `<context>...</context>` to the latest user message before the user's actual RP text).
2. **Via raw completion mode** (bypassing the `/chat/completions` role array altogether) if you want full control over custom prompt assembly, though this shifts template maintenance onto your app.

---

### 3. Weighting Lore, Memories, and Style Directives

LLMs do not have a native "attention weight" syntax—adding metadata like `importance: 9/10` or `priority: high` inside the text is largely ignored unless you burn extra instructions explaining how to interpret it. Instead, RP engines control how heavily the model weighs information using **four structural levers**:

| Mechanism | How It Works | Best Used For |
| --- | --- | --- |
| **Positional Depth (Recency)** | Attention forms a U-shape ("lost in the middle"). The very beginning (index 0) and the last 1–3 turns carry the highest weight. | Putting an "Author's Note" (style/tone rules) or critical scene facts at **Depth 1–2** (just before the final user message) makes them far more authoritative than burying them in the main system prompt. |
| **Few-Shot Anchoring** | Concrete examples override abstract instructions. Two short sample exchanges carry more behavioral weight than a paragraph of adjectives. | Controlling prose style, formatting, reply length, and character voice. |
| **Explicit Functional Framing** | Separating *passive reference* from *active constraints* changes how aggressively the model acts on a chunk. | Wrap background worldbuilding in `<reference_lore>` ("use only if relevant") and urgent rules in `<active_directives>` ("must follow in the next reply"). |
| **Semantic Footprint (Token Budget)** | Models implicitly weight concepts by how much token real estate they occupy. | Keep low-priority lore to 1–2 terse sentences; reserve multi-sentence detail only for traits or memories you want the model to actively weave into the reply. |

In practice, **Positional Depth** is the strongest dial you have. If a vector-retrieved memory is just background flavor, inject it higher up (e.g., Depth 4–6, or in a secondary block above the recent chat window). If a keyword-triggered lore entry or style correction *must* shape the very next reply, inject it at Depth 0 or 1—right next to the latest user input.

Sliding-window truncation preserves exact character voice and keeps local inference fast, but causes sudden amnesia once key facts scroll past the context limit. Rolling summarization maintains long-term plot continuity, but introduces extra inference latency, frequent KV-cache invalidation, and a subtle degradation of writing quality called **summary bleed**.

For local RP engines, neither pure approach holds up over hundreds of turns. The practical sweet spot is a **chunked sliding window** paired with **append-only episodic summaries** (and optional vector recall for older details).

### Sliding-Window Truncation vs. Rolling Summarization

| Dimension | Sliding-Window Truncation | Rolling Summarization |
| --- | --- | --- |
| **Plot Continuity** | Hard cliff—anything outside the window ceases to exist unless rescued by RAG. | High—core plot arcs, injuries, and relationship shifts persist indefinitely. |
| **KV-Cache Efficiency** | **Poor if naive** (dropping 1 turn per message shifts every token and forces full reprocessing). **High if chunked** (evicting in batches). | **Poor if rewritten** (mutating a single running summary at the top invalidates the entire cache). **High if append-only.** |
| **Latency & Compute** | Zero extra generation overhead. | Requires an extra LLM pass whenever a summary triggers (can stall the UI unless run asynchronously). |
| **Prose Style Drift** | Low initially, but susceptible to **self-conditioning** (repeating its own recent phrasing and tics). | High—dry, condensed summary prose inside the prompt pulls the model toward clinical, "wrap-up" narration. |
| **Primary Failure Mode** | Forgetting who is in the room or what happened three scenes ago. | **Telephone-game hallucination** (summarizing a summary drops nuance and invents false continuity). |

---

### The Local KV-Cache Trap (and How to Dodge It)

On a local backend like `llama.cpp`, prompt evaluation (prefill) is what makes long RP threads feel sluggish. Both naive truncation and naive rolling summaries destroy prefix caching:

* **Don't slide 1 turn at a time.** If your context budget is 16k tokens and you trim the oldest message on every single turn, the prefix changes every turn and the engine reprocesses the entire prompt from scratch. Instead, use **high-water / low-water chunked eviction**: let the conversation grow to 16k, then drop the oldest 4k tokens in one batch down to 12k. You take one prefill hit every ~15–20 turns, and get near-instant cached turns in between.
* **Don't rewrite a monolithic summary.** Rewriting a single "Story So Far" block at the top of the prompt invalidates everything below it *and* compounds factual drift each time the LLM re-summarizes its own summary. Instead, generate **immutable episodic blocks** (e.g., one 3-bullet summary per evicted 20-turn chunk) and append them to the end of your static summary section. Only the newly evicted boundary triggers a cache shift.

---

### Why Prose Style Drift Happens—and How to Prevent It

Long RP sessions degrade in two distinct ways: **summary bleed** (where the model starts writing like a Wikipedia plot synopsis) and **autoregressive self-conditioning** (where a minor stylistic quirk in turn 12 gets echoed in turn 15, amplified in turn 25, and turns into repetitive purple prose or formulaic three-paragraph replies by turn 50).

Five architectural defenses stop this from happening:

1. **Format summaries as telemetry, not prose.**
Never let your summarizer output literary paragraphs. If the model sees narrative summary sentences ("Vex felt conflicted as they walked through the rain and decided to trust Kael"), its attention heads will mirror that detached, summarizing cadence in live dialogue. Force the summarizer into a stark, structured ledger inside a fenced or XML-delimited block:
```text
<episode_log>
[Scene 3 | Docks Warehouse]
- Facts: Kael recovered the ledger; Vex took a grazing wound to her left shoulder.
- Relationship: Vex still distrusts Kael's informant, agreed to a 24-hour truce.
- Open threads: Harbor watch is sweeping the east pier.
</episode_log>

```


The stark visual contrast between bulleted facts and narrative chat turns keeps the model from blending the two registers.
2. **Separate the summarizer pass completely.**
Run summarization as an out-of-band request with its own system prompt—never inject "Summarize the above" into the active chat history. Better yet, trigger it asynchronously in the background right after the assistant finishes streaming its reply, so the next user turn isn't blocked waiting for a summary.
3. **Anchor voice at both ends of the context.**
As chat history grows, the static system prompt at index 0 loses relative influence over sentence rhythm. Keep 2–3 short **example dialogue exchanges** permanently pinned in your static system block (they establish rhythm far better than adjectives), and place a lightweight, 1–2 line **cadence reminder** at Depth 1 (just before the latest user message). Keep it positive and concrete ("Write grounded dialogue with short action beats") rather than a long list of "Do NOT use..." bans, which often trigger the exact words you forbade.
4. **Periodically prune or edit toxic tics out of the active window.**
Because LLMs attend heavily to the last 5–10 assistant turns, a single repeated crutch phrase ("a shiver ran down her spine," "eyes widening," "he couldn't help but...") becomes self-reinforcing. Allowing your app to silently strip or let the user edit repetitive crutches in recent turns immediately breaks the feedback loop.
5. **Use repetition-aware sampling at the inference layer.**
Prompt engineering alone won't stop phrase-level drift in quantized local models. Pair your context engine with modern local samplers—specifically **Min-P** (around `0.05`–`0.1` to keep vocabulary natural without gibberish) and **DRY (Don't Repeat Yourself)** sampling, which penalizes multi-token sequence repeats across the context window without wrecking single-word grammar the way high `repeat_penalty` does.

---

### The Recommended Hybrid Pattern

If you are building this from scratch, combine the strengths of both approaches into a three-tier memory layout:

1. **Static Prefix (Cached indefinitely):** Directives, character card, user persona, and example dialogue.
2. **Append-Only Episodic Ledger (Cached across chunks):** Immutable 3–5 bullet factual logs generated only when a chunk is evicted from the active window. Once the ledger itself grows too large (e.g., 10+ episodes), retire the oldest episodes into your vector database for keyword/semantic retrieval rather than re-summarizing them.
3. **Chunked Sliding Window (Active dialogue):** Raw verbatim turns growing from a low-water mark (e.g., 8k tokens) to a high-water mark (e.g., 12k tokens), with dynamic RAG memories and a short style note injected at Depth 1–2.
