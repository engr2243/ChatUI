'use strict';

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
  sessions:    {},      // { [id]: { id, title, subject, messages: [] } }
  activeId:    null,
  apiEndpoint: '',
  email:       '',
  userName:    '',
  agentUrl:    '',
  pendingFile: null,    // { name, base64 }
  pending:     {},      // { [sessionId]: true } — sessions with in-flight requests
};

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const newChatBtn        = $('new-chat-btn');
const historyList       = $('chat-history-list');
const messagesContainer = $('messages-container');
const chatTitle         = $('chat-title');
const subjectTag        = $('subject-tag');
const sessionBadge      = $('session-badge');
const messageInput      = $('message-input');
const sendBtn           = $('send-btn');
const attachBtn         = $('attach-btn');
const fileInput         = $('file-input');
const attachmentPreview = $('attachment-preview');
const attachmentName    = $('attachment-name');
const attachmentMeta    = $('attachment-meta');
const attachmentRemove  = $('attachment-remove');
const sessionIdDisplay  = $('session-id-display');
const themeToggleBtn    = $('theme-toggle-btn');
const iconSun           = $('icon-sun');
const iconMoon          = $('icon-moon');

// Settings
const settingsBtn       = $('settings-btn');
const settingsOverlay   = $('settings-overlay');
const settingsCloseBtn  = $('settings-close-btn');
const endpointInput     = $('endpoint-input');
const userNameInput     = $('user-name-input');
const emailInput        = $('email-input');
const agentUrlInput     = $('agent-url-input');
const saveSettingsBtn   = $('save-settings-btn');
const settingsStatus    = $('settings-status');

// Topic dialog
const topicOverlay      = $('topic-overlay');
const topicInput        = $('topic-input');
const topicStartBtn     = $('topic-start-btn');
const topicSkipBtn      = $('topic-skip-btn');

const toast             = $('toast');

// ─── UUID ─────────────────────────────────────────────────────────────────────
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
function saveLocal() {
  try {
    localStorage.setItem('patchbay_sessions', JSON.stringify(state.sessions));
    localStorage.setItem('patchbay_theme', document.documentElement.dataset.theme || 'light');
  } catch (_) {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem('patchbay_sessions');
    if (raw) {
      state.sessions = JSON.parse(raw);
      Object.values(state.sessions).forEach(s => { if (!s.files) s.files = {}; });
    }
  } catch (_) { state.sessions = {}; }
}

// ─── TOPIC DIALOG ─────────────────────────────────────────────────────────────
// Returns a Promise that resolves with the topic string (or '' if skipped)
function askTopic() {
  return new Promise(resolve => {
    topicInput.value = '';
    topicOverlay.classList.remove('hidden');
    topicInput.focus();

    function finish(topic) {
      topicOverlay.classList.add('hidden');
      topicStartBtn.removeEventListener('click', onStart);
      topicSkipBtn.removeEventListener('click', onSkip);
      topicInput.removeEventListener('keydown', onKey);
      resolve(topic.trim());
    }

    function onStart() { finish(topicInput.value); }
    function onSkip()  { finish(''); }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(topicInput.value); }
      if (e.key === 'Escape') finish('');
    }

    topicStartBtn.addEventListener('click', onStart);
    topicSkipBtn.addEventListener('click', onSkip);
    topicInput.addEventListener('keydown', onKey);
  });
}

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
async function createSession() {
  const subject = await askTopic();
  const id = generateId();
  const title = subject || 'New Chat';
  state.sessions[id] = { id, title, subject, messages: [], files: {} };
  state.activeId = id;
  saveLocal();
  renderSidebar();
  renderMessages();
  updateTopbar();
  messageInput.focus();
  return id;
}

function loadSession(id) {
  if (!state.sessions[id]) return;
  state.activeId = id;
  renderMessages();
  updateTopbar();
  renderSidebar();
  scrollToBottom();
  // Restore typing indicator and input state for this session
  const locked = !!state.pending[id];
  if (locked) showTyping();
  messageInput.disabled = locked;
  attachBtn.disabled = locked;
  updateSendBtn();
}

function deleteSession(id) {
  delete state.sessions[id];
  saveLocal();
  if (state.activeId === id) {
    const remaining = Object.keys(state.sessions);
    if (remaining.length > 0) loadSession(remaining[remaining.length - 1]);
    else createSession();
  } else {
    renderSidebar();
  }
}

// If no subject was set, auto-derive title from first message
function maybeSetTitle(id, firstMessage) {
  const session = state.sessions[id];
  if (!session || session.subject) return; // subject already set — keep it
  session.title = firstMessage.trim().slice(0, 48) || 'New Chat';
  saveLocal();
  renderSidebar();
  updateTopbar();
}

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
function updateTopbar() {
  const session = state.sessions[state.activeId];
  if (!session) return;
  chatTitle.textContent = session.title;
  sessionBadge.textContent = session.id.slice(0, 8) + '…';
  sessionIdDisplay.textContent = 'session: ' + session.id.slice(0, 13) + '…';

  if (session.subject) {
    subjectTag.textContent = session.subject;
    subjectTag.style.display = '';
  } else {
    subjectTag.style.display = 'none';
  }
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const ids = Object.keys(state.sessions).reverse();
  if (ids.length === 0) {
    historyList.innerHTML = `<div style="padding:10px 12px;font-size:13px;color:var(--text-3)">No conversations yet.</div>`;
    return;
  }
  historyList.innerHTML = ids.map(id => {
    const s = state.sessions[id];
    const isActive = id === state.activeId;
    const isPending = !!state.pending[id];
    const pendingDots = isPending
      ? `<span class="h-pending" title="Waiting for response"><span></span><span></span><span></span></span>`
      : '';
    return `<div class="history-item${isActive ? ' active' : ''}" data-id="${id}">
      <svg class="h-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="h-title" title="${escapeAttr(s.title)}">${escapeHtml(s.title)}</span>
      ${pendingDots}
      <button class="h-delete delete-btn" data-id="${id}" title="Delete" aria-label="Delete conversation">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`;
  }).join('');
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
function renderMessages() {
  const session = state.sessions[state.activeId];
  if (!session) return;
  messagesContainer.innerHTML = '';
  if (session.messages.length === 0) {
    messagesContainer.appendChild(makeEmptyState(session.subject));
    return;
  }
  session.messages.forEach(msg => {
    messagesContainer.appendChild(makeBubble(msg.role, msg.content, msg.attachment, msg.fileAttachment));
  });
  scrollToBottom();
}

function makeEmptyState(subject) {
  const div = document.createElement('div');
  div.id = 'empty-state';
  const subtitle = subject
    ? `Topic: <strong>${escapeHtml(subject)}</strong>`
    : 'Send a message to start the conversation.';
  div.innerHTML = `
    <div class="empty-mark">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9z" fill="var(--accent)" opacity="0.3"/>
        <path d="M8 12h8M12 8.5v7" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <h2>How can I help you today?</h2>
    <p>${subtitle}</p>`;
  return div;
}

function makeBubble(role, content, attachment, fileAttachment) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  if (role === 'user') {
    const msgContent = document.createElement('div');
    msgContent.className = 'msg-content';
    msgContent.textContent = content;
    if (attachment) {
      const tag = document.createElement('div');
      tag.className = 'att-tag';
      tag.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>${escapeHtml(attachment)}`;
      msgContent.appendChild(tag);
    }
    row.appendChild(msgContent);
  } else {
    const inner = document.createElement('div');
    inner.className = 'bot-inner';

    const avatar = document.createElement('div');
    avatar.className = 'bot-avatar';
    avatar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9z" fill="rgba(255,255,255,0.25)"/><path d="M8 12h8M12 8.5v7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

    const text = document.createElement('div');
    text.className = 'bot-text';
    text.innerHTML = content;
    text.querySelectorAll('a').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });

    if (fileAttachment) {
      const chip = document.createElement('div');
      chip.className = 'file-download-chip';
      chip.innerHTML = `
        <div class="fdl-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
          </svg>
        </div>
        <span class="fdl-name" title="${escapeAttr(fileAttachment)}">${escapeHtml(fileAttachment)}</span>
        <button class="fdl-btn" data-filename="${escapeAttr(fileAttachment)}" title="Download ${escapeAttr(fileAttachment)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v13M5 16l7 7 7-7"/><line x1="3" y1="23" x2="21" y2="23"/>
          </svg>
        </button>`;
      text.appendChild(chip);
    }

    inner.appendChild(avatar);
    inner.appendChild(text);
    row.appendChild(inner);
  }
  return row;
}

function appendBubble(role, content, attachment, fileAttachment) {
  const es = messagesContainer.querySelector('#empty-state');
  if (es) es.remove();
  const row = makeBubble(role, content, attachment, fileAttachment);
  messagesContainer.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  requestAnimationFrame(() => { messagesContainer.scrollTop = messagesContainer.scrollHeight; });
}

// ─── TYPING INDICATOR ────────────────────────────────────────────────────────
function showTyping() {
  const row = document.createElement('div');
  row.className = 'message-row bot typing';
  row.id = 'typing-row';

  const inner = document.createElement('div');
  inner.className = 'bot-inner';

  const avatar = document.createElement('div');
  avatar.className = 'bot-avatar';
  avatar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9z" fill="rgba(255,255,255,0.25)"/><path d="M8 12h8M12 8.5v7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

  const text = document.createElement('div');
  text.className = 'bot-text';
  text.innerHTML = `<div class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;

  inner.appendChild(avatar);
  inner.appendChild(text);
  row.appendChild(inner);

  const es = messagesContainer.querySelector('#empty-state');
  if (es) es.remove();
  messagesContainer.appendChild(row);
  scrollToBottom();
}

function hideTyping() {
  const row = $('typing-row');
  if (row) row.remove();
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !state.pendingFile) return;

  const session = state.sessions[state.activeId];
  if (!session) return;

  const isFirst = session.messages.length === 0;

  const payload = {
    session_id:       session.id,
    chat_input:       text,
    attachment:       state.pendingFile ? state.pendingFile.base64     : null,
    attachment_name:  state.pendingFile ? state.pendingFile.name       : null,
    attachment_type:  state.pendingFile ? state.pendingFile.mimeType   : null,
    subject:          session.subject || null,
    email_address:    state.email     || null,
    user_name:        state.userName  || null,
  };

  const attachmentLabel = state.pendingFile ? state.pendingFile.name : null;
  appendBubble('user', text, attachmentLabel);
  session.messages.push({ role: 'user', content: text, attachment: attachmentLabel });

  if (isFirst) maybeSetTitle(session.id, text);

  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendBtn();
  clearAttachment();
  saveLocal();

  const sessionId = session.id;

  showTyping();
  setInputLocked(sessionId, true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await res.json();
    const data = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});

    const isActive = state.activeId === sessionId;
    if (isActive) hideTyping();

    if (!res.ok) {
      const errMsg = data.error || `Server error ${res.status}`;
      if (isActive) appendBubble('bot', `<p style="color:#ef4444">⚠ ${escapeHtml(errMsg)}</p>`);
      showToast(errMsg, 'error');
    } else {
      const output = data.output || '';
      let fileAttachment = null;
      const base64Data = data.base64 || data.base_64;
      if (data.file_name && base64Data) {
        storeSessionFile(sessionId, data.file_name, base64Data);
        fileAttachment = data.file_name;
      }
      session.messages.push({ role: 'bot', content: output, fileAttachment });
      if (isActive) appendBubble('bot', output, null, fileAttachment);
      saveLocal();
    }
  } catch (err) {
    const isActive = state.activeId === sessionId;
    if (isActive) hideTyping();
    const msg = 'Network error — could not reach the server.';
    if (isActive) appendBubble('bot', `<p style="color:#ef4444">⚠ ${escapeHtml(msg)}</p>`);
    showToast(msg, 'error');
  } finally {
    setInputLocked(sessionId, false);
    renderSidebar();
    if (state.activeId === sessionId) messageInput.focus();
  }
}

function setInputLocked(sessionId, locked) {
  if (locked) {
    state.pending[sessionId] = true;
  } else {
    delete state.pending[sessionId];
  }
  if (state.activeId === sessionId) {
    messageInput.disabled = locked;
    attachBtn.disabled = locked;
    updateSendBtn();
  }
}

// ─── ATTACHMENT ───────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    state.pendingFile = { name: file.name, base64, mimeType: file.type, size: file.size };
    attachmentName.textContent = file.name;
    attachmentMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'unknown type'}`;
    attachmentPreview.classList.add('visible');
    updateSendBtn();
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  state.pendingFile = null;
  fileInput.value = '';
  attachmentName.textContent = '';
  attachmentMeta.textContent = '';
  attachmentPreview.classList.remove('visible');
  updateSendBtn();
}

// ─── SEND BUTTON STATE ────────────────────────────────────────────────────────
function updateSendBtn() {
  sendBtn.disabled = !!state.pending[state.activeId] || !(messageInput.value.trim().length > 0 || !!state.pendingFile);
}

// ─── THEME ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveLocal();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  iconSun.style.display  = theme === 'dark'  ? 'block' : 'none';
  iconMoon.style.display = theme === 'light' ? 'block' : 'none';
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
async function openSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    endpointInput.value  = data.endpoint      || '';
    userNameInput.value  = data.user_name     || '';
    emailInput.value     = data.email_address || '';
    agentUrlInput.value  = data.agent_url     || '';
  } catch (_) {}
  settingsStatus.textContent = '';
  settingsStatus.className = '';
  settingsOverlay.classList.remove('hidden');
  endpointInput.focus();
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

async function saveSettings() {
  const endpoint      = endpointInput.value.trim();
  const user_name     = userNameInput.value.trim();
  const email_address = emailInput.value.trim();
  const agent_url     = agentUrlInput.value.trim();
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, user_name, email_address, agent_url }),
    });
    const data = await res.json();
    if (data.ok) {
      state.apiEndpoint = endpoint;
      state.userName    = user_name;
      state.email       = email_address;
      state.agentUrl    = agent_url;
      settingsStatus.textContent = 'Saved!';
      settingsStatus.className   = 'ok';
      showToast('Settings saved', 'success');
      setTimeout(closeSettings, 900);
    }
  } catch (_) {
    settingsStatus.textContent = 'Failed to save.';
    settingsStatus.className   = 'err';
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'info') {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = type;
  toastTimer = setTimeout(() => { toast.className = 'hidden'; }, 2800);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return String(str).replace(/"/g, '&quot;'); }

function mimeFromFilename(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    csv: 'text/csv', txt: 'text/plain', json: 'application/json',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4',
  })[ext] || 'application/octet-stream';
}

// ─── FILE DOWNLOADS ───────────────────────────────────────────────────────────
function storeSessionFile(sessionId, fileName, base64) {
  const session = state.sessions[sessionId];
  if (!session) return;
  if (!session.files) session.files = {};
  session.files[fileName] = { name: fileName, base64, mimeType: mimeFromFilename(fileName) };
}

function downloadFile(fileName) {
  const session = state.sessions[state.activeId];
  const f = session && session.files && session.files[fileName];
  if (!f) { showToast('File not available', 'error'); return; }
  try {
    const byteChars = atob(f.base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: f.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (_) { showToast('Could not prepare download', 'error'); }
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────
function bindEvents() {
  newChatBtn.addEventListener('click', () => createSession());

  // Sidebar (delegated)
  historyList.addEventListener('click', e => {
    const del = e.target.closest('.delete-btn');
    if (del) {
      e.stopPropagation();
      if (confirm('Delete this conversation?')) deleteSession(del.dataset.id);
      return;
    }
    const item = e.target.closest('.history-item');
    if (item) loadSession(item.dataset.id);
  });

  // Textarea auto-grow
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 320) + 'px';
    updateSendBtn();
  });

  // Enter = send, Shift+Enter = newline
  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  messagesContainer.addEventListener('click', e => {
    const btn = e.target.closest('.fdl-btn');
    if (btn) downloadFile(btn.dataset.filename);
  });

  sendBtn.addEventListener('click', sendMessage);
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFileSelected(fileInput.files[0]));
  attachmentRemove.addEventListener('click', clearAttachment);
  themeToggleBtn.addEventListener('click', toggleTheme);

  // Settings
  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });
  saveSettingsBtn.addEventListener('click', saveSettings);
  [endpointInput, userNameInput, emailInput, agentUrlInput].forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveSettings();
      if (e.key === 'Escape') closeSettings();
    });
  });

  // Global Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSettings();
      topicOverlay.classList.add('hidden');
    }
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  applyTheme(localStorage.getItem('patchbay_theme') || 'light');
  loadLocal();

  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    state.apiEndpoint = data.endpoint      || '';
    state.userName    = data.user_name     || '';
    state.email       = data.email_address || '';
    state.agentUrl    = data.agent_url     || '';
  } catch (_) {}

  renderSidebar();

  // Always start a new session on page load — past chats remain in the sidebar
  createSession();

  bindEvents();
  messageInput.focus();

  if (!state.apiEndpoint) {
    setTimeout(() => showToast('Open Settings ⚙ to configure your API endpoint.', 'info'), 900);
  }
}

document.addEventListener('DOMContentLoaded', init);
