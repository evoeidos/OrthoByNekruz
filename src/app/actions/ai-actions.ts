'use server';

const TIMEWEB_AI_KEY  = process.env.TIMEWEB_AI_KEY;
const TIMEWEB_BASE_URL = 'https://api.timeweb.ai/v1/chat/completions';
const TIMEWEB_MODEL   = 'deepseek/deepseek-v4-flash';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `Ты — ведущий эксперт в области медицины. Твоя задача — не пересказывать текст, а проводить его критический и глубокий анализ.

АЛГОРИТМ ТВОЕГО ОТВЕТА:

1. СУТЬ: Объясни физику или механизм процесса (распределение нагрузки, физиологию, патологию), описанного в тексте.
2. КЛИНИЧЕСКИЙ СМЫСЛ: Зачем это нужно врачу на практике? Что будет, если этого не сделать?
3. ПРОСТАЯ АНАЛОГИЯ: Приведи аналогию из обычной жизни или техники.
4. СЛОЖНЫЙ ТЕРМИН ПРОСТЫМИ СЛОВАМИ: Выбери 1-2 сложных термина из текста и дай им расшифровку.

Стиль: говори логично, используй факты, а не пересказ. Отвечай ТОЛЬКО на русском. Используй Markdown для оформления.`;

async function callProvider(
  url: string,
  apiKey: string,
  model: string,
  text: string,
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Проведи анализ этой задачи и ответа:\n\n${text}` },
      ],
      temperature: 0.7,
      // DeepSeek V4 Flash — reasoning-модель: ~800 токенов на мышление + ответ
      max_tokens: url.includes('timeweb') ? 3000 : 1500,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `Ошибка API: ${response.status}`);
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('ИИ вернул пустой ответ');
  return content;
}

/**
 * Анализ клинической задачи.
 * Провайдеры: Timeweb DeepSeek (основной) → Groq Llama (резерв).
 */
export async function analyzeClinicalCase(text: string) {
  if (!text) throw new Error('Текст для анализа пуст');

  // 1. Timeweb (DeepSeek V4 Flash) — основной
  if (TIMEWEB_AI_KEY) {
    try {
      return await callProvider(TIMEWEB_BASE_URL, TIMEWEB_AI_KEY, TIMEWEB_MODEL, text);
    } catch (e) {
      console.warn('Timeweb AI failed, falling back to Groq:', e);
    }
  }

  // 2. Groq — резерв
  if (GROQ_API_KEY) {
    try {
      return await callProvider(GROQ_API_URL, GROQ_API_KEY, 'llama-3.3-70b-versatile', text);
    } catch (e) {
      console.error('Groq fallback also failed:', e);
      throw new Error((e as Error).message || 'Не удалось связаться с сервером ИИ');
    }
  }

  throw new Error('ИИ не настроен: добавь TIMEWEB_AI_KEY в переменные окружения');
}
