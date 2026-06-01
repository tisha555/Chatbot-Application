/**
 * Mock LLM API simulating OpenAI, Gemini, and Anthropic response streaming and unary calls.
 */

const MOCK_RESPONSES = [
  "That is an interesting question! Let's think about this step by step. First, we need to define the parameters. Second, we evaluate the dependencies.",
  "Here is some information about your request. Modern systems leverage message queues like Redis to process high-throughput logs asynchronously.",
  "As an AI, I suggest designing your system with horizontal scalability in mind. Consider using Kubernetes to deploy self-healing service pods.",
  "I have analyzed your input. The PII redaction wrapper works by parsing regular expressions in real-time, matching standard structures for emails, phones, and credit card numbers.",
  "To optimize performance, you should cache frequent queries, batch write database entries, and stream responses to reduce time-to-first-token (TTFT).",
  "Hello! I am ready to assist you. Please let me know what we are building today."
];

// Helper to simulate sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MockLLM {
  /**
   * Generates a non-streaming response.
   */
  async generateText(prompt, model, provider, triggerError = false) {
    await sleep(400 + Math.random() * 800); // Simulate processing latency

    if (triggerError || prompt.toLowerCase().includes('trigger error')) {
      const err = new Error('Simulated LLM Provider Rate Limit Exceeded');
      err.statusCode = 429;
      throw err;
    }

    const responseText = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
    const wordCount = responseText.split(' ').length;

    return {
      text: responseText,
      usage: {
        prompt_tokens: Math.ceil(prompt.split(' ').length * 1.3),
        completion_tokens: Math.ceil(wordCount * 1.3),
        total_tokens: Math.ceil((prompt.split(' ').length + wordCount) * 1.3)
      }
    };
  }

  /**
   * Generates a streaming response (returns an AsyncGenerator yielding string chunks).
   */
  async generateStream(messages, model, provider, cancellationToken = { cancelled: false }) {
    await sleep(200); // Initial time-to-first-token latency

    // If messages is passed as string fallback
    const prompt = typeof messages === 'string' ? messages : (messages[messages.length - 1]?.content || '');

    if (prompt.toLowerCase().includes('trigger error')) {
      await sleep(100);
      throw new Error('Mock API Connection Interrupted (Status 502)');
    }

    // Context-aware real chatbot logic
    let responseText = '';
    const cleanPrompt = prompt.toLowerCase().trim();

    if (cleanPrompt === 'hello' || cleanPrompt === 'hi' || cleanPrompt === 'hey') {
      responseText = "Hello! I am the Antigravity assistant. How can I help you build your system today? Feel free to ask about our database, testing PII redaction, or trigger an error.";
    } else if (cleanPrompt.includes('your name') || cleanPrompt.includes('who are you')) {
      responseText = "I am the Antigravity mock chatbot model, designed to help you verify streaming latencies and metadata logging without needing internet access.";
    } else if (cleanPrompt.includes('my name') || cleanPrompt.includes('who am i')) {
      // Look back in history to find if user mentioned their name
      let userName = '';
      if (Array.isArray(messages)) {
        for (let i = 0; i < messages.length - 1; i++) {
          const content = messages[i].content;
          const match = content.match(/my name is\s+([a-zA-Z0-9_-]+)/i) || content.match(/i am\s+([a-zA-Z0-9_-]+)/i);
          if (match) {
            userName = match[1];
          }
        }
      }
      if (userName) {
        responseText = `According to our chat context, your name is ${userName}! Isn't it neat that I remember your multi-turn inputs?`;
      } else {
        responseText = "I don't think you have introduced yourself yet. What is your name? (e.g. try typing 'My name is Alice')";
      }
    } else if (cleanPrompt.includes('last message') || cleanPrompt.includes('what did i say before')) {
      // Find previous user message
      let lastUserMsg = '';
      if (Array.isArray(messages)) {
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length > 1) {
          // Second to last is the one before the current prompt
          lastUserMsg = userMessages[userMessages.length - 2].content;
        }
      }
      if (lastUserMsg) {
        responseText = `Just before this, you said: "${lastUserMsg}". I keep a rolling short context of the last 10 messages.`;
      } else {
        responseText = "This is your first message in this conversation, so I don't have any prior message to look back to!";
      }
    } else if (cleanPrompt.includes('database') || cleanPrompt.includes('schema') || cleanPrompt.includes('postgres')) {
      responseText = "We store conversation sessions, chat messages, and performance analytics logs in a PostgreSQL database using a 4-table schema. If run locally, it falls back to an in-memory DB.";
    } else if (cleanPrompt.includes('pii') || cleanPrompt.includes('redact') || cleanPrompt.includes('mask')) {
      responseText = "Our SDK runs regex sanitizers on inputs and outputs before enqueuing logs. You can verify this by typing an email like test@test.com or credit card. It will show up masked in the dashboard logs!";
    } else if (cleanPrompt.includes('joke')) {
      responseText = "Why did the developer go broke? Because he used up all his tokens! 🤖 (Just a little LLM humor for you).";
    } else {
      // Default contextual response
      const defaultOptions = [
        "That's an interesting question regarding our architecture. Let's think step by step. Downstream processors consume log events from Redis concurrently to insert them into the DB.",
        "To optimize LLM applications, keeping conversational context short is important to save token costs. That's why we sliced our context buffer to the last 10 messages.",
        "I'm keeping track of this conversation. If you head over to the Dashboard, you'll see this request logged under the corresponding conversation UUID."
      ];
      const contextPrefix = (Array.isArray(messages) && messages.length > 2) 
        ? "Continuing our discussion on this topic: " 
        : "";
      responseText = contextPrefix + defaultOptions[Math.floor(Math.random() * defaultOptions.length)];
    }

    const fullResponse = responseText + " (Simulated stream from " + provider + " using " + model + ")";
    const words = fullResponse.split(' ');
    
    // Return async generator
    return (async function* () {
      for (const word of words) {
        if (cancellationToken.cancelled) {
          console.log(`Stream generation cancelled for model ${model}`);
          break;
        }
        yield word + ' ';
        await sleep(40 + Math.random() * 60); 
      }
    })();
  }
}

module.exports = new MockLLM();
