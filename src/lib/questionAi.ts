const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash-8b',
] as const;

const GROQ_MODEL = 'llama-3.3-70b-versatile';
// Timeweb Cloud AI Gateway — DeepSeek V4 Flash (OpenAI-совместимый)
const TIMEWEB_BASE_URL = 'https://api.timeweb.ai/v1';
const TIMEWEB_MODEL = 'deepseek/deepseek-v4-flash';
const MAX_CONTEXT_CHARS = 12_000;

/**
 * Таймауты. Без них зависший провайдер держал бы serverless-функцию до
 * платформенного лимита, а цепочка из 5 вызовов подряд — тем более.
 * TOTAL_BUDGET_MS ограничивает всю цепочку целиком.
 */
const TIMEWEB_TIMEOUT_MS = 25_000; // reasoning-модель, отвечает дольше
const PROVIDER_TIMEOUT_MS = 15_000;
const TOTAL_BUDGET_MS = 50_000;

/** fetch с жёстким таймаутом — иначе запрос может висеть бесконечно. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

export function buildQuestionAiPrompts(
  mode: string,
  question: string,
  answer: string,
  userQuestion?: string,
) {
  const systemInstruction = `Ты — старший друг-студент медицинского университета, который уже сдал этот экзамен на отлично.
Объясняешь так, как объяснил бы другу перед сессией — живым языком, по-человечески, без канцелярщины.

ПРАВИЛА:
- Отвечай ТОЛЬКО на русском языке
- Пиши связным текстом, как будто говоришь вслух — не сухими списками
- Веди мысль последовательно: сначала суть простыми словами, потом почему это важно
- Одна яркая аналогия из обычной жизни (бытовая, понятная первокурснику)
- Выдели 1-2 ключевых слова **жирным**
- Не повторяй вопрос, не пиши «итак» и «таким образом»
- Максимум 200 слов`;

  const q = question.replace(/\*\*/g, '').trim().slice(0, MAX_CONTEXT_CHARS);
  const a = answer.replace(/\*\*/g, '').trim().slice(0, MAX_CONTEXT_CHARS);

  const userPrompt = mode === 'explain'
    ? `Тема: ${q}

Что написано в учебнике:
${a}

Объясни это простыми словами — последовательно, как будто рассказываешь другу. Начни сразу с сути, без вступлений. Используй одну понятную аналогию из жизни. Объясни, зачем это вообще нужно знать врачу.`
    : `Тема: ${q}

Материал:
${a}

Вопрос студента: ${String(userQuestion || '').trim()}

Ответь чётко, своими словами, как другу. Без лишних слов.`;

  return { systemInstruction, userPrompt };
}

export function friendlyAiError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429')) {
    return 'Лимит ИИ временно исчерпан. Подожди 1–2 минуты и попробуй снова.';
  }
  if (lower.includes('api key') || lower.includes('не настроен')) {
    return 'ИИ сейчас недоступен. Напиши @evoeidos — разберёмся.';
  }
  if (lower.includes('пустой ответ')) {
    return 'ИИ не смог сформировать ответ. Попробуй переформулировать вопрос.';
  }
  return 'Не удалось получить ответ. Попробуй ещё раз чуть позже.';
}

function isQuotaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('quota') || lower.includes('rate limit') || lower.includes('429');
}

async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<{ text?: string; error?: string }> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 600,
          topP: 0.9,
        },
      }),
      cache: 'no-store',
    }, timeoutMs);
  } catch (e) {
    return { error: isAbortError(e) ? `${model}: таймаут` : `${model}: сеть недоступна` };
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message
      || `Gemini ${response.status}`;
    return { error: msg };
  }

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) return { error: 'Gemini вернул пустой ответ' };
  return { text };
}

/** Единая функция для OpenAI-совместимых провайдеров (Timeweb, Groq и др.) */
async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
  providerName: string,
  timeoutMs: number,
): Promise<{ text?: string; error?: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        // Reasoning-модели (DeepSeek V4 Flash) тратят ~800 токенов на цепочку мыслей
        // перед ответом — поэтому лимит выше, чем кажется нужным.
        max_tokens: providerName === 'Timeweb' ? 2000 : 600,
      }),
      cache: 'no-store',
    }, timeoutMs);
  } catch (e) {
    return {
      error: isAbortError(e)
        ? `${providerName}: таймаут`
        : `${providerName}: сеть недоступна`,
    };
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message
      || `${providerName} ${response.status}`;
    return { error: msg };
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content || '';
  if (!text) return { error: `${providerName} вернул пустой ответ` };
  return { text };
}

/**
 * Цепочка провайдеров:
 *   1. Timeweb (DeepSeek V4 Flash) — основной, лучший русский язык
 *   2. Groq (Llama 3.3 70B)        — бесплатный резерв
 *   3. Gemini flash                 — крайний резерв
 */
export async function generateQuestionAiAnswer(
  systemInstruction: string,
  userPrompt: string,
): Promise<{ result?: string; error?: string }> {
  const timewebKey = process.env.TIMEWEB_AI_KEY?.trim();
  const groqKey    = process.env.GROQ_API_KEY?.trim();
  const geminiKey  = process.env.GEMINI_API_KEY?.trim();
  const errors: string[] = [];

  // Общий бюджет на всю цепочку: каждый следующий провайдер получает
  // не больше, чем осталось от TOTAL_BUDGET_MS.
  const startedAt = Date.now();
  const budgetLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  const slice = (want: number) => Math.min(want, budgetLeft());

  if (timewebKey && budgetLeft() > 1_000) {
    const tw = await callOpenAICompat(
      TIMEWEB_BASE_URL, timewebKey, TIMEWEB_MODEL,
      systemInstruction, userPrompt, 'Timeweb', slice(TIMEWEB_TIMEOUT_MS),
    );
    if (tw.text) return { result: tw.text };
    if (tw.error) errors.push(tw.error);
  }

  if (groqKey && budgetLeft() > 1_000) {
    const groq = await callOpenAICompat(
      'https://api.groq.com/openai/v1', groqKey, GROQ_MODEL,
      systemInstruction, userPrompt, 'Groq', slice(PROVIDER_TIMEOUT_MS),
    );
    if (groq.text) return { result: groq.text };
    if (groq.error) errors.push(groq.error);
  }

  if (geminiKey) {
    for (const model of GEMINI_MODELS) {
      if (budgetLeft() <= 1_000) {
        errors.push('Исчерпан общий лимит времени на ответ ИИ');
        break;
      }
      const gemini = await callGemini(
        geminiKey, model, systemInstruction, userPrompt, slice(PROVIDER_TIMEOUT_MS),
      );
      if (gemini.text) return { result: gemini.text };
      if (gemini.error) {
        errors.push(`${model}: ${gemini.error}`);
        if (!isQuotaError(gemini.error)) break;
      }
    }
  }

  if (!timewebKey && !groqKey && !geminiKey) {
    return { error: 'ИИ не настроен: добавь TIMEWEB_AI_KEY в переменные окружения' };
  }

  const last = errors[errors.length - 1] || 'Все провайдеры недоступны';
  return { error: friendlyAiError(last) };
}
