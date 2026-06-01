/**
 * Multi-provider LLM Client Adapter.
 * Integrates Gemini, OpenAI, and Mock LLM.
 */
const mockLLM = require('./mockLLM');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

/**
 * Normalizes inputs and dispatches calls to the chosen LLM provider.
 */
class LLMClient {
  /**
   * Unary generation (returns text + usage metadata)
   */
  async generateText(prompt, model, provider) {
    if (provider === 'gemini' && GEMINI_API_KEY) {
      return this.callGeminiUnary(prompt, model);
    } else if (provider === 'openai' && OPENAI_API_KEY) {
      return this.callOpenAIUnary(prompt, model);
    } else {
      // Fallback to Mock LLM
      return mockLLM.generateText(prompt, model, provider);
    }
  }

  /**
   * Streaming generation (returns async text stream generator)
   */
  async generateStream(messages, model, provider, cancellationToken = { cancelled: false }) {
    if (provider === 'gemini' && GEMINI_API_KEY) {
      return this.callGeminiStream(messages, model, cancellationToken);
    } else if (provider === 'openai' && OPENAI_API_KEY) {
      return this.callOpenAIStream(messages, model, cancellationToken);
    } else {
      // Fallback to Mock LLM
      return mockLLM.generateStream(messages, model, provider, cancellationToken);
    }
  }

  // --- Real Provider Implementations using standard fetch ---

  async callGeminiUnary(prompt, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(`Gemini API Error: ${response.status} - ${errorText}`);
      err.statusCode = response.status;
      throw err;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Estimate token counts
    return {
      text,
      usage: {
        prompt_tokens: Math.ceil(prompt.split(' ').length * 1.3),
        completion_tokens: Math.ceil(text.split(' ').length * 1.3)
      }
    };
  }

  async callOpenAIUnary(prompt, model) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
      err.statusCode = response.status;
      throw err;
    }

    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0
      }
    };
  }

  async callGeminiStream(messages, model, cancellationToken) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${GEMINI_API_KEY}`;
    
    // Map messages array to Gemini contents role formatting
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Streaming API Error: ${response.status} - ${errorText}`);
    }

    // Handle chunk parsing via reader
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    return (async function* () {
      let buffer = '';
      try {
        while (true) {
          if (cancellationToken.cancelled) {
            reader.cancel();
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Gemini streams write a JSON array structure, so we parse chunks
          // For simplicity, we search for candidates text directly using regex or standard extraction in chunks
          // Simple JSON chunk processor:
          const textMatches = [...buffer.matchAll(/"text":\s*"((?:[^"\\]|\\.)*)"/g)];
          if (textMatches.length > 0) {
            // Flush parsed text chunks and keep track of processed buffer
            for (const match of textMatches) {
              // Unescape JSON string
              const unescapedText = JSON.parse(`"${match[1]}"`);
              yield unescapedText;
            }
            // Clear buffer matches to prevent repeating
            buffer = ''; 
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }

  async callOpenAIStream(messages, model, cancellationToken) {
    const url = 'https://api.openai.com/v1/chat/completions';
    
    const openAIMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        messages: openAIMessages,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Streaming API Error: ${response.status} - ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    return (async function* () {
      let buffer = '';
      try {
        while (true) {
          if (cancellationToken.cancelled) {
            reader.cancel();
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Save the last partial line back to buffer
          buffer = lines.pop(); 

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine.startsWith('data: ')) continue;
            const dataStr = cleanLine.slice(6);
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              const textChunk = parsed.choices?.[0]?.delta?.content || '';
              if (textChunk) {
                yield textChunk;
              }
            } catch (e) {
              // Ignore partial JSON parsing errors
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }
}

module.exports = new LLMClient();
