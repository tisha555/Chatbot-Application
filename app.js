// Frontend State Management
let currentConversationId = null;
let activeTab = 'chat';
let isStreaming = false;
let allLogs = []; // Store loaded logs for modal lookup

// Providers and Models Dictionary
const PROVIDER_MODELS = {
  mock: [
    { value: 'mock-llm', label: 'mock-llm (Standard)' }
  ],
  gemini: [
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
    { value: 'gemini-2.0-flash-exp', label: 'gemini-2.0-flash-exp' }
  ],
  openai: [
    { value: 'gpt-4o', label: 'gpt-4o (Premium)' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' }
  ]
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  setupProviderDropdown();
  loadConversations();
  
  // Set up Theme Toggle
  const themeToggleBtn = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    themeToggleBtn.textContent = '☀️';
  } else {
    document.body.classList.remove('light-mode');
    themeToggleBtn.textContent = '🌙';
  }
  
  themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    themeToggleBtn.textContent = isLight ? '☀️' : '🌙';
  });
  
  // Set up new conversation trigger
  document.getElementById('new-chat-btn').addEventListener('click', createNewConversation);
});

// Setup Provider Dropdown behavior
function setupProviderDropdown() {
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');

  function updateModels() {
    const provider = providerSelect.value;
    const models = PROVIDER_MODELS[provider] || [];
    modelSelect.innerHTML = '';
    
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.label;
      modelSelect.appendChild(option);
    });
  }

  providerSelect.addEventListener('change', updateModels);
  updateModels(); // Initial load
}

// Switch SPA Tabs
function switchTab(tab) {
  activeTab = tab;
  
  // Update buttons
  document.getElementById('tab-chat-btn').classList.toggle('active', tab === 'chat');
  document.getElementById('tab-dashboard-btn').classList.toggle('active', tab === 'dashboard');
  
  // Update panes
  document.getElementById('chat-pane').classList.toggle('active', tab === 'chat');
  document.getElementById('dashboard-pane').classList.toggle('active', tab === 'dashboard');
  
  // If moving to dashboard, refresh stats
  if (tab === 'dashboard') {
    loadMetrics();
  }
}

// Fetch and Render Conversations List
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const conversations = await res.json();
    
    const container = document.getElementById('conversations-list');
    container.innerHTML = '';
    
    if (conversations.length === 0) {
      container.innerHTML = '<div class="list-empty">No conversations yet</div>';
      return;
    }
    
    conversations.forEach(conv => {
      const card = document.createElement('div');
      card.className = `conversation-item ${conv.id === currentConversationId ? 'active' : ''}`;
      card.onclick = () => selectConversation(conv.id);
      
      const formattedDate = new Date(conv.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      card.innerHTML = `
        <div class="conv-meta">
          <span class="conv-title" title="${escapeHTML(conv.title)}">${escapeHTML(conv.title)}</span>
          <button class="delete-conv-btn" onclick="deleteConversation('${conv.id}', event)" title="Delete session">&times;</button>
        </div>
        <div class="conv-footer">
          <span class="conv-date">${formattedDate}</span>
          <span class="badge ${conv.status}">${conv.status}</span>
        </div>
      `;
      
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

// Create New Conversation Session
async function createNewConversation() {
  try {
    const res = await fetch('/api/conversations');
    const existing = await res.json();
    const chatNumber = existing.length + 1;
    
    const createRes = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Conversation #${chatNumber}` })
    });
    
    const newConv = await createRes.json();
    currentConversationId = newConv.id;
    
    await loadConversations();
    selectConversation(newConv.id);
  } catch (err) {
    console.error('Error creating new conversation:', err);
  }
}

// Delete Session
async function deleteConversation(id, event) {
  event.stopPropagation(); // Avoid selecting card
  if (!confirm('Are you sure you want to delete this conversation?')) return;
  
  try {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (currentConversationId === id) {
      currentConversationId = null;
      resetChatArea();
    }
    loadConversations();
  } catch (err) {
    console.error('Error deleting conversation:', err);
  }
}

// Select/Resume Conversation
async function selectConversation(id) {
  currentConversationId = id;
  
  // Highlight active
  document.querySelectorAll('.conversation-item').forEach(card => card.classList.remove('active'));
  
  // Refresh sidebar to ensure styling syncs
  await loadConversations();
  
  // Enable input field
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  chatInput.removeAttribute('disabled');
  sendBtn.removeAttribute('disabled');
  chatInput.placeholder = "Type your message here...";
  chatInput.focus();

  // Load message history
  try {
    const res = await fetch(`/api/conversations/${id}/messages`);
    const messages = await res.json();
    
    const container = document.getElementById('chat-messages-container');
    container.innerHTML = '';
    
    // Set Header Active Title
    document.getElementById('active-chat-title').textContent = `Session: ${id.substring(0, 8)}...`;
    document.getElementById('active-chat-subtitle').textContent = "Multi-turn logging conversation session.";
    
    if (messages.length === 0) {
      container.innerHTML = `
        <div class="welcome-box">
          <h3>Conversation Resumed</h3>
          <p>This session is empty. Type a message below to generate inference metadata.</p>
        </div>
      `;
      return;
    }
    
    messages.forEach(msg => {
      appendMessageBubble(msg.role, msg.content);
    });
    
    scrollToBottom();
  } catch (err) {
    console.error('Error fetching conversation messages:', err);
  }
}

// Reset UI Chat Box State
function resetChatArea() {
  document.getElementById('active-chat-title').textContent = 'Select or Create a Conversation';
  document.getElementById('active-chat-subtitle').textContent = 'Start chatting below to test real-time inference logging.';
  
  const container = document.getElementById('chat-messages-container');
  container.innerHTML = `
    <div class="welcome-box">
      <h3>Welcome to Antigravity Logger!</h3>
      <p>This application demonstrates a lightweight, near-real-time inference SDK wrapper, ingestion pipeline, and logging queue.</p>
    </div>
  `;
  
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  chatInput.removeAttribute('disabled');
  sendBtn.removeAttribute('disabled');
  chatInput.placeholder = "Type your message to start a new chat...";
  chatInput.value = '';
}

// Send Message and handle stream
async function sendMessage(event) {
  event.preventDefault();
  
  const inputEl = document.getElementById('chat-input');
  const prompt = inputEl.value.trim();
  if (!prompt || isStreaming) return;

  // Auto-create a conversation if none is active
  if (!currentConversationId) {
    try {
      const res = await fetch('/api/conversations');
      const existing = await res.json();
      const chatNumber = existing.length + 1;
      
      const createRes = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Conversation #${chatNumber}` })
      });
      
      const newConv = await createRes.json();
      currentConversationId = newConv.id;
      
      // Update sidebar list
      await loadConversations();
      
      // Clear welcome box
      const container = document.getElementById('chat-messages-container');
      container.innerHTML = '';
      
      // Set Active Titles
      document.getElementById('active-chat-title').textContent = `Session: ${currentConversationId.substring(0, 8)}...`;
      document.getElementById('active-chat-subtitle').textContent = "Multi-turn logging conversation session.";
    } catch (err) {
      console.error('Error auto-creating conversation:', err);
      return;
    }
  }
  
  isStreaming = true;
  inputEl.value = '';
  inputEl.disabled = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('cancel-btn').classList.remove('hidden-btn');
  
  // Clear welcome boxes
  const container = document.getElementById('chat-messages-container');
  if (container.querySelector('.welcome-box')) {
    container.innerHTML = '';
  }
  
  // Append User message
  appendMessageBubble('user', prompt);
  scrollToBottom();
  
  // Append Assistant placeholder
  const bubble = appendMessageBubble('assistant', '');
  const bubbleTextEl = bubble.querySelector('.message-text');
  scrollToBottom();
  
  const provider = document.getElementById('provider-select').value;
  const model = document.getElementById('model-select').value;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: currentConversationId,
        prompt,
        provider,
        model
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let aggregatedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunkText = decoder.decode(value, { stream: true });
      aggregatedText += chunkText;
      
      // Update text bubble. Convert simple newlines to preserve indentation
      bubbleTextEl.textContent = aggregatedText;
      scrollToBottom();
      
      // Look for errors printed into chunk
      if (chunkText.includes('[ERROR:')) {
        bubbleTextEl.innerHTML = aggregatedText.replace(
          /\[ERROR: (.*?)\]/, 
          '<span style="color: var(--color-danger); font-weight:600;">[ERROR: $1]</span>'
        );
        break;
      }
    }
  } catch (err) {
    bubbleTextEl.innerHTML = `<span style="color: var(--color-danger); font-weight:600;">System connection error: ${err.message}</span>`;
  } finally {
    isStreaming = false;
    inputEl.disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('cancel-btn').classList.add('hidden-btn');
    inputEl.focus();
    
    // Refresh conversations list to update status badge
    await loadConversations();
  }
}

// Cancel current streaming request
async function cancelStreaming() {
  if (!currentConversationId || !isStreaming) return;
  
  try {
    const res = await fetch(`/api/conversations/${currentConversationId}/cancel`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      console.log('Stream cancellation signal successfully dispatched.');
    }
  } catch (e) {
    console.error('Failed to trigger manual stream cancellation:', e);
  }
}

// Append bubble helper
function appendMessageBubble(role, content) {
  const container = document.getElementById('chat-messages-container');
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${role}`;
  
  bubble.innerHTML = `
    <div class="message-sender">${role === 'user' ? 'User' : 'Assistant'}</div>
    <div class="message-text">${escapeHTML(content)}</div>
  `;
  
  container.appendChild(bubble);
  return bubble;
}

// Fetch Metrics statistics and update Dashboard UI
async function loadMetrics() {
  try {
    const res = await fetch('/api/dashboard/metrics');
    const data = await res.json();
    
    allLogs = data.recentLogs || [];
    const sum = data.summary || {};
    
    // Update metric cards
    document.getElementById('metric-avg-latency').textContent = `${sum.avg_latency_ms || 0} ms`;
    
    // Calculate throughput: Sum of outputs / sum of latency_sec
    const totalOutputTokens = allLogs.reduce((acc, log) => acc + (log.output_tokens || 0), 0);
    const totalLatencySec = allLogs.reduce((acc, log) => acc + (log.latency_ms || 0), 0) / 1000;
    const avgTps = totalLatencySec > 0 ? (totalOutputTokens / totalLatencySec) : 0;
    document.getElementById('metric-tps').textContent = `${avgTps.toFixed(1)} t/s`;
    
    document.getElementById('metric-cost').textContent = `$${Number(sum.total_cost_usd || 0).toFixed(4)}`;
    document.getElementById('metric-requests').textContent = sum.total_requests || 0;
    document.getElementById('metric-redactions').textContent = sum.total_pii_redactions || 0;
    
    const errRate = sum.error_rate || 0;
    document.getElementById('metric-error-rate').textContent = `${errRate}%`;
    
    // Highlight error card if errors present
    const errorCard = document.getElementById('error-card');
    if (errRate > 0) {
      errorCard.classList.add('has-errors');
    } else {
      errorCard.classList.remove('has-errors');
    }

    // Render Model breakdown chart
    renderModelChart(data.modelBreakdown || {});

    // Render Recent logs table
    renderRecentLogsTable(allLogs);

  } catch (err) {
    console.error('Error fetching metrics:', err);
  }
}

// Render dynamic CSS bars for model distribution
function renderModelChart(breakdown) {
  const container = document.getElementById('model-chart-container');
  container.innerHTML = '';
  
  const entries = Object.entries(breakdown);
  if (entries.length === 0) {
    container.innerHTML = '<p class="no-data">No metrics available yet.</p>';
    return;
  }

  // Find max value to determine percentage
  const maxRequests = Math.max(...entries.map(([_, count]) => count));

  entries.forEach(([model, count]) => {
    const pct = maxRequests > 0 ? (count / maxRequests) * 100 : 0;
    
    const row = document.createElement('div');
    row.className = 'chart-bar-row';
    row.innerHTML = `
      <div class="chart-bar-info">
        <span class="chart-bar-name">${escapeHTML(model)}</span>
        <span class="chart-bar-value">${count} requests</span>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width: ${pct}%"></div>
      </div>
    `;
    container.appendChild(row);
  });
}

// Render logs table
function renderRecentLogsTable(logs) {
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';
  
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="no-data">No logs recorded yet. Submit messages to generate logs.</td></tr>';
    return;
  }
  
  logs.forEach(log => {
    const tr = document.createElement('tr');
    
    const isError = log.status_code >= 400;
    const badgeClass = isError ? 'status-error' : 'status-200';
    
    const costFormatted = log.cost_usd ? `$${Number(log.cost_usd).toFixed(5)}` : '$0.00000';
    const timeFormatted = new Date(log.request_timestamp).toLocaleTimeString();
    
    tr.innerHTML = `
      <td><span class="status-badge ${badgeClass}">${log.status_code}</span></td>
      <td><strong>${escapeHTML(log.model)}</strong></td>
      <td><span style="text-transform: capitalize;">${escapeHTML(log.provider)}</span></td>
      <td>${log.latency_ms} ms</td>
      <td>${log.input_tokens || 0} / ${log.output_tokens || 0}</td>
      <td>${costFormatted}</td>
      <td style="text-align:center;">${log.pii_redacted_count || 0}</td>
      <td>${timeFormatted}</td>
      <td><button class="view-log-btn" onclick="openLogModal('${log.id}')">Inspect</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// View Log Modal Details
function openLogModal(logId) {
  const log = allLogs.find(l => l.id === logId);
  if (!log) return;
  
  document.getElementById('modal-log-id').textContent = log.id;
  document.getElementById('modal-timestamp').textContent = new Date(log.request_timestamp).toLocaleString();
  document.getElementById('modal-model').textContent = log.model;
  document.getElementById('modal-provider').textContent = log.provider;
  document.getElementById('modal-latency').textContent = `${log.latency_ms} ms`;
  document.getElementById('modal-tokens').textContent = `${log.input_tokens || 0} input / ${log.output_tokens || 0} output`;
  document.getElementById('modal-throughput').textContent = `${Number(log.throughput_tps || 0).toFixed(1)} tokens/sec`;
  document.getElementById('modal-cost').textContent = log.cost_usd ? `$${Number(log.cost_usd).toFixed(6)}` : '$0.000000';
  document.getElementById('modal-status').textContent = log.status_code;
  document.getElementById('modal-redacted').textContent = log.pii_redacted_count || 0;
  
  // Show message previews
  document.getElementById('modal-input-preview').textContent = log.input_preview || '[No Input Saved]';
  document.getElementById('modal-output-preview').textContent = log.output_preview || log.error_message || '[No Output Saved]';
  
  // Attempt to print raw JSON nicely
  let parsedRaw = {};
  try {
    parsedRaw = typeof log.raw_payload === 'string' ? JSON.parse(log.raw_payload) : log.raw_payload;
  } catch (e) {
    parsedRaw = log.raw_payload;
  }
  document.getElementById('modal-raw-json').textContent = JSON.stringify(parsedRaw, null, 2);
  
  document.getElementById('log-detail-modal').classList.add('active');
}

function closeLogModal() {
  document.getElementById('log-detail-modal').classList.remove('active');
}

// Helper Utilities
function scrollToBottom() {
  const container = document.getElementById('chat-messages-container');
  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
