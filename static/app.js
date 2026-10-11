(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const DEMO_MODE = document.body.dataset.mode === 'demo';
  const PALETTE = ['lavender', 'mint', 'peach'];
  const SEED_USERS = [
    { id: 'alice', name: 'Alice Morgan', email: 'alice@example.com', initials: 'AM', color: 'lavender' },
    { id: 'bob', name: 'Jordan Lee', email: 'jordan@example.com', initials: 'JL', color: 'mint' },
    { id: 'charlie', name: 'Sam Rivera', email: 'sam@example.com', initials: 'SR', color: 'peach' },
  ];
  let me = null;
  let users = [];
  let activeDocument = null;
  let activeScope = 'owned';
  let currentDocuments = [];
  let ownedDocuments = [];
  let sharedDocuments = [];
  let saveTimer = null;
  let titleTimer = null;
  let loadingDocument = false;
  let pendingDeleteId = null;

  const seedStore = () => {
    const timestamp = new Date().toISOString();
    return {
      me: 'alice',
      users: SEED_USERS,
      docs: [
        { id: 'briefing', title: 'Product sync — weekly briefing', content: '<h1>Product sync</h1><p>A shared place to turn conversations into momentum.</p><h2>This week</h2><ul><li>Finalize the onboarding flow</li><li>Review feedback from five pilot users</li><li>Agree on the next release milestone</li></ul><h2>Open questions</h2><p>What is the smallest improvement that makes the biggest difference?</p>', owner_id: 'alice', created_at: timestamp, updated_at: timestamp },
        { id: 'research', title: 'Customer interview notes', content: '<h1>Customer interview notes</h1><p><strong>Goal:</strong> understand where handoffs slow teams down.</p><ol><li>Ask how work is currently documented.</li><li>Find where context gets lost.</li><li>Validate the ideal sharing workflow.</li></ol><p><em>Next:</em> consolidate the recurring themes.</p>', owner_id: 'alice', created_at: timestamp, updated_at: timestamp },
        { id: 'roadmap', title: 'Q4 launch checklist', content: '<h1>Q4 launch checklist</h1><p>A focused launch plan for the next product milestone.</p><ul><li>Confirm scope and owners</li><li>Run accessibility checks</li><li>Prepare release notes</li></ul>', owner_id: 'bob', created_at: timestamp, updated_at: timestamp },
      ],
      shares: [
        { document_id: 'briefing', user_id: 'bob', role: 'editor', created_at: timestamp },
        { document_id: 'research', user_id: 'charlie', role: 'viewer', created_at: timestamp },
      ],
    };
  };

  function readStore() {
    try {
      const raw = localStorage.getItem('commonpaper_demo_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.docs) && Array.isArray(parsed.users) && Array.isArray(parsed.shares)) return parsed;
      }
    } catch (_) { /* Reset malformed browser demo data. */ }
    const fresh = seedStore();
    writeStore(fresh);
    return fresh;
  }
  function writeStore(store) {
    try { localStorage.setItem('commonpaper_demo_v1', JSON.stringify(store)); } catch (_) { /* Preview may restrict storage. */ }
  }
  function makeDocPayload(store, doc, role) {
    const owner = store.users.find(u => u.id === doc.owner_id) || store.users[0];
    return { ...doc, owner_name: owner.name, owner_email: owner.email, owner_initials: owner.initials, owner_color: owner.color, role };
  }
  function plainFromHtml(value) {
    const node = document.createElement('div');
    node.innerHTML = value || '';
    return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function markdownToSafeHtml(text, extension) {
    const esc = (s) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    if (extension === '.md') {
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      const chunks = [];
      let listType = '';
      let listItems = [];
      const flush = () => { if (listType && listItems.length) chunks.push(`<${listType}>${listItems.map(item => `<li>${esc(item)}</li>`).join('')}</${listType}>`); listType = ''; listItems = []; };
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) { flush(); continue; }
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        const bullet = /^[-*+]\s+(.+)$/.exec(line);
        const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
        if (heading) { flush(); const n = heading[1].length; chunks.push(`<h${n}>${esc(heading[2])}</h${n}>`); }
        else if (bullet || numbered) { const wanted = bullet ? 'ul' : 'ol'; if (listType !== wanted) { flush(); listType = wanted; } listItems.push((bullet || numbered)[1]); }
        else { flush(); chunks.push(`<p>${esc(line)}</p>`); }
      }
      flush(); return chunks.join('') || '<p></p>';
    }
    return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(line => `<p>${esc(line).replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>';
  }

  async function demoApi(path, options = {}) {
    const store = readStore();
    const method = (options.method || 'GET').toUpperCase();
    const url = new URL(path, window.location.href);
    const route = url.pathname;
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
    const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
    const current = () => store.users.find(u => u.id === store.me) || store.users[0];
    const access = (id) => {
      const doc = store.docs.find(d => d.id === id);
      if (!doc) return null;
      if (doc.owner_id === current().id) return { doc, role: 'owner' };
      const share = store.shares.find(s => s.document_id === id && s.user_id === current().id);
      return share ? { doc, role: share.role } : null;
    };
    const persist = () => writeStore(store);

    if (route === '/api/session' && method === 'GET') return { user: current(), users: store.users, demo_auth: true };
    if (route === '/api/session' && method === 'POST') {
      const recipient = store.users.find(u => u.id === body?.user_id);
      if (!recipient) fail('Choose one of the seeded demo users.');
      store.me = recipient.id; persist(); return { user: recipient };
    }
    if (route === '/api/documents' && method === 'GET') {
      const scope = url.searchParams.get('scope') || 'owned';
      if (scope === 'shared') {
        const docs = store.shares.filter(s => s.user_id === current().id).map(s => store.docs.find(d => d.id === s.document_id)).filter(Boolean).sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(d => makeDocPayload(store, d, store.shares.find(s => s.document_id === d.id && s.user_id === current().id).role));
        return { documents: docs };
      }
      if (scope !== 'owned') fail("Scope must be 'owned' or 'shared'.");
      return { documents: store.docs.filter(d => d.owner_id === current().id).sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(d => makeDocPayload(store, d, 'owner')) };
    }
    if (route === '/api/documents' && method === 'POST') {
      const title = String(body?.title || 'Untitled document').trim().slice(0, 160);
      if (!title) fail('Give your document a title.');
      const now = new Date().toISOString();
      const doc = { id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title, content: String(body?.content || '<p></p>'), owner_id: current().id, created_at: now, updated_at: now };
      store.docs.unshift(doc); persist(); return { document: makeDocPayload(store, doc, 'owner') };
    }
    if (route === '/api/import' && method === 'POST') {
      const file = body instanceof FormData ? body.get('file') : null;
      if (!file || !file.name) fail('Choose a .txt or .md file first.');
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.md', '.txt'].includes(extension)) fail('Unsupported file type. Upload a .txt or .md file.');
      if (file.size > 1_000_000) fail('File is too large. Maximum upload size is 1 MB.', 413);
      const text = await file.text();
      const now = new Date().toISOString();
      const doc = { id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title: file.name.slice(0, -extension.length).replace(/[_-]+/g, ' ').slice(0, 160) || 'Imported document', content: markdownToSafeHtml(text, extension), owner_id: current().id, created_at: now, updated_at: now };
      store.docs.unshift(doc); persist(); return { document: makeDocPayload(store, doc, 'owner'), imported_filename: file.name };
    }
    const match = /^\/api\/documents\/([^/]+)(?:\/shares(?:\/([^/]+))?)?$/.exec(route);
    if (!match) fail('Route not found.', 404);
    const docId = decodeURIComponent(match[1]);
    const hasShares = route.includes('/shares');
    const recipientId = match[2];
    const accessInfo = access(docId);
    if (method === 'GET' && !hasShares) {
      if (!accessInfo) fail('Document not found or you do not have access.', 404);
      return { document: makeDocPayload(store, accessInfo.doc, accessInfo.role) };
    }
    if (method === 'PATCH' && !hasShares) {
      if (!accessInfo) fail('Document not found or you do not have access.', 404);
      if ('title' in body && accessInfo.role !== 'owner') fail('Only the owner can rename a document.', 403);
      if ('content' in body && !['owner', 'editor'].includes(accessInfo.role)) fail('You have view-only access to this document.', 403);
      if ('title' in body) { const title = String(body.title).trim().slice(0,160); if (!title) fail('Document title cannot be empty.'); accessInfo.doc.title = title; }
      if ('content' in body) accessInfo.doc.content = String(body.content);
      accessInfo.doc.updated_at = new Date().toISOString(); persist();
      return { document: makeDocPayload(store, accessInfo.doc, accessInfo.role) };
    }
    if (method === 'DELETE' && !hasShares) {
      if (!accessInfo) fail('Document not found or you do not have access.', 404);
      if (accessInfo.role !== 'owner') fail('Only the owner can delete a document.', 403);
      store.docs = store.docs.filter(d => d.id !== docId); store.shares = store.shares.filter(s => s.document_id !== docId); persist(); return { ok: true };
    }
    if (hasShares && method === 'GET' && !recipientId) {
      if (!accessInfo) fail('Document not found or you do not have access.', 404);
      const shares = store.shares.filter(s => s.document_id === docId).map(s => ({ user: store.users.find(u => u.id === s.user_id), role: s.role, created_at: s.created_at }));
      return { shares, can_manage: accessInfo.role === 'owner' };
    }
    if (hasShares && method === 'POST' && !recipientId) {
      if (!accessInfo) fail('Document not found or you do not have access.', 404);
      if (accessInfo.role !== 'owner') fail('Only the owner can manage sharing.', 403);
      const recipient = store.users.find(u => u.email.toLowerCase() === String(body?.email || '').toLowerCase());
      const role = body?.role;
      if (!['viewer','editor'].includes(role)) fail('Choose viewer or editor access.');
      if (!recipient) fail('That email is not a seeded demo user. Try jordan@example.com or sam@example.com.', 404);
      if (recipient.id === accessInfo.doc.owner_id) fail('The owner already has full access.');
      const existing = store.shares.find(s => s.document_id === docId && s.user_id === recipient.id);
      if (existing) { existing.role = role; existing.created_at = new Date().toISOString(); }
      else store.shares.push({ document_id: docId, user_id: recipient.id, role, created_at: new Date().toISOString() });
      persist(); return { ok: true, user: recipient, role };
    }
    if (hasShares && method === 'DELETE' && recipientId) {
      if (!accessInfo) fail('Document not found or you do not have access.', 404);
      if (accessInfo.role !== 'owner') fail('Only the owner can manage sharing.', 403);
      store.shares = store.shares.filter(s => !(s.document_id === docId && s.user_id === decodeURIComponent(recipientId))); persist(); return { ok: true };
    }
    fail('Method not allowed.', 405);
  }

  async function api(path, options = {}) {
    if (DEMO_MODE) return demoApi(path, options);
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    const init = { method, credentials: 'same-origin', headers };
    if (options.body instanceof FormData) init.body = options.body;
    else if (options.body !== undefined) { headers.set('Content-Type', 'application/json'); init.body = JSON.stringify(options.body); }
    let response;
    try { response = await fetch(path, init); }
    catch (_) { const e = new Error('Could not reach the app server. Check your connection and try again.'); e.status = 0; throw e; }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(payload.error || `Request failed (${response.status}).`); e.status = response.status; throw e; }
    return payload;
  }

  function avatarClass(color) { return `avatar avatar-${PALETTE.includes(color) ? color : 'lavender'}`; }
  function renderAvatar(user, extra = '') { return `<span class="${avatarClass(user?.color)} ${extra}" title="${escapeAttr(user?.name || '')}">${escapeText(user?.initials || '??')}</span>`; }
  function escapeText(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function escapeAttr(value) { return escapeText(value); }
  function iconDoc() { return '<svg viewBox="0 0 24 24"><path d="M5 4.75h9l5 5V20H5z"/><path d="M14 4.75V10h5M8.5 13.5h7M8.5 16.5h7"/></svg>'; }
  function shortDate(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
    if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function setConnectionState(state, text) {
    const status = $('#connectionStatus');
    status.classList.toggle('saving', state === 'saving');
    status.classList.toggle('error', state === 'error');
    status.innerHTML = `<span></span> ${escapeText(text)}`;
    $('#toolbarSaveLabel').textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Save issue' : 'Auto-saved';
    $('#lastSavedFooter').textContent = state === 'saving' ? 'Saving your changes…' : state === 'error' ? 'Please retry your save' : `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`;
    const icon = type === 'error' ? '<path d="M12 8v4m0 4h.01M5 3h14l2 18H3z"/>' : type === 'info' ? '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>' : '<path d="m5 12 4 4L19 6"/>';
    el.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg><span>${escapeText(message)}</span>`;
    $('#toastRegion').appendChild(el);
    window.setTimeout(() => el.remove(), 3600);
  }
  function setHomeMode(scope) {
    activeScope = scope;
    $('#ownedNav').classList.toggle('active', scope === 'owned');
    $('#sharedNav').classList.toggle('active', scope === 'shared');
    $('#crumbCurrent').textContent = scope === 'owned' ? 'My documents' : 'Shared with me';
    $('#welcomeStrip').hidden = false;
    $('#homeContent').hidden = false;
    $('#editorView').hidden = true;
    $('#listHeading').textContent = scope === 'owned' ? 'RECENT DOCUMENTS' : 'SHARED DOCUMENTS';
    $('#gridTitle').textContent = scope === 'owned' ? 'Pick up where you left off' : 'Documents from your team';
    if (scope === 'shared') {
      $('#welcomeTitle').innerHTML = 'Better, together<span class="title-period">.</span>';
    } else {
      $('#welcomeTitle').innerHTML = `Good morning, ${escapeText(me?.name?.split(' ')[0] || 'there')}<span class="title-period">.</span>`;
    }
    renderDocumentLists();
  }
  function renderDocumentLists() {
    currentDocuments = activeScope === 'owned' ? ownedDocuments : sharedDocuments;
    $('#ownedCount').textContent = String(ownedDocuments.length);
    $('#sharedCount').textContent = String(sharedDocuments.length);
    const sidebar = $('#documentList');
    sidebar.innerHTML = '';
    currentDocuments.slice(0, 9).forEach(doc => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sidebar-doc ${activeDocument?.id === doc.id ? 'active' : ''}`;
      button.innerHTML = `${iconDoc()}<span>${escapeText(doc.title)}</span>`;
      button.title = doc.title;
      button.addEventListener('click', () => openDocument(doc.id));
      sidebar.appendChild(button);
    });
    if (!currentDocuments.length) sidebar.innerHTML = '<div class="sidebar-empty">Your next good idea can start here.</div>';
    const grid = $('#documentGrid');
    grid.innerHTML = '';
    if (!currentDocuments.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-graphic">${iconDoc()}</div><h3>${activeScope === 'owned' ? 'A blank page can go a long way.' : 'Nothing shared with you yet.'}</h3><p>${activeScope === 'owned' ? 'Create a document or import a file to get your thoughts moving.' : 'When a teammate shares a document, it will show up here.'}</p>${activeScope === 'owned' ? '<button type="button" class="button button-primary" id="emptyCreateButton">Create a document</button>' : ''}</div>`;
      $('#emptyCreateButton')?.addEventListener('click', createDocument);
      return;
    }
    const docsToShow = currentDocuments.slice(0, 6);
    docsToShow.forEach((doc, index) => grid.appendChild(makeDocumentCard(doc, index)));
  }
  function makeDocumentCard(doc, index) {
    const card = document.createElement('article');
    card.className = 'document-card'; card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Open ${doc.title}`);
    const colorClass = ['','mint','peach'][index % 3];
    const plain = plainFromHtml(doc.content || '');
    const summary = plain || 'An empty page, ready for a new idea.';
    const owner = users.find(u => u.id === doc.owner_id) || { name: doc.owner_name, initials: doc.owner_initials, color: doc.owner_color };
    card.innerHTML = `<div class="card-preview"><span class="card-type-icon ${colorClass}">${iconDoc()}</span><div class="preview-sheet"><h3>${escapeText(doc.title)}</h3><p></p><p class="mid"></p><p class="short"></p><p class="preview-subhead"></p><div class="preview-bullet"><span></span></div><div class="preview-bullet"><span></span></div><div class="preview-bullet"><span></span></div></div></div><div class="card-body"><h3 class="card-title">${escapeText(doc.title)}</h3><p class="card-summary">${escapeText(summary.slice(0, 102))}${summary.length > 102 ? '…' : ''}</p><div class="card-footer">${renderAvatar(owner)}<span class="card-owner">${escapeText(doc.role === 'owner' ? 'You' : owner.name || doc.owner_name || 'Teammate')}</span>${doc.role !== 'owner' ? `<span class="shared-badge"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M16 5.5a3 3 0 0 1 0 5.8M17 13.2a4 4 0 0 1 3.5 4V19"/></svg>${doc.role === 'viewer' ? 'Can view' : 'Shared'}</span>` : `<span class="card-time">${shortDate(doc.updated_at)}</span>`}</div></div>`;
    card.addEventListener('click', () => openDocument(doc.id));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDocument(doc.id); } });
    return card;
  }
  async function refreshLists() {
    try {
      const [owned, shared] = await Promise.all([api('/api/documents?scope=owned'), api('/api/documents?scope=shared')]);
      ownedDocuments = owned.documents || []; sharedDocuments = shared.documents || [];
      if (activeScope === 'shared' && !activeDocument) setHomeMode('shared'); else if (!activeDocument) setHomeMode('owned'); else renderDocumentLists();
    } catch (error) { toast(error.message, 'error'); }
  }
  function updateSidebarUser() {
    $('#sidebarAvatar').className = avatarClass(me?.color);
    $('#sidebarAvatar').textContent = me?.initials || '??';
    $('#sidebarUserName').textContent = me?.name || 'Demo user';
    $('#sidebarUserEmail').textContent = me?.email || '';
  }
  async function loadSession() {
    const payload = await api('/api/session');
    me = payload.user; users = payload.users || SEED_USERS; updateSidebarUser();
    $('#shareEmail').innerHTML = '<option value="">Choose a demo user…</option>';
    users.filter(user => user.id !== me.id).forEach(user => {
      const option = document.createElement('option'); option.value = user.email; option.textContent = `${user.name} · ${user.email}`; $('#shareEmail').appendChild(option);
    });
    renderUserChoices();
  }
  async function createDocument() {
    try {
      const payload = await api('/api/documents', { method: 'POST', body: { title: 'Untitled document', content: '<h1>Untitled document</h1><p>Start writing something worth sharing…</p>' } });
      await refreshLists(); await openDocument(payload.document.id); $('#documentTitle').focus(); $('#documentTitle').select();
      toast('A new document is ready.');
    } catch (error) { toast(error.message, 'error'); }
  }
  async function openDocument(id) {
    if (loadingDocument) return;
    loadingDocument = true;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await saveCurrentContent(); }
    try {
      const payload = await api(`/api/documents/${encodeURIComponent(id)}`);
      activeDocument = payload.document;
      $('#welcomeStrip').hidden = true; $('#homeContent').hidden = true; $('#editorView').hidden = false;
      $('#crumbCurrent').textContent = activeDocument.title;
      $('#documentTitle').value = activeDocument.title;
      $('#documentTitle').readOnly = activeDocument.role !== 'owner';
      $('#documentEditor').innerHTML = activeDocument.content || '<p></p>';
      $('#documentEditor').contentEditable = ['owner', 'editor'].includes(activeDocument.role) ? 'true' : 'false';
      $('#documentEditor').setAttribute('aria-readonly', String(activeDocument.role === 'viewer'));
      $('#shareButton').hidden = activeDocument.role !== 'owner';
      $('#moreButton').hidden = activeDocument.role !== 'owner';
      $('#permissionPill').textContent = activeDocument.role === 'owner' ? 'Owner' : activeDocument.role === 'editor' ? 'Can edit' : 'View only';
      $('#documentOwnerLabel').textContent = activeDocument.role === 'owner' ? 'Owned by you' : `Owned by ${activeDocument.owner_name}`;
      $('#documentUpdatedLabel').textContent = `Edited ${shortDate(activeDocument.updated_at)}`;
      $('#paperDate').textContent = new Date(activeDocument.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
      $$('#formatToolbar button, #formatToolbar select').forEach(control => { control.disabled = activeDocument.role === 'viewer'; control.style.opacity = control.disabled ? '.4' : ''; });
      setConnectionState('saved', 'All changes saved'); updateWordCount(); await renderSidebarAvatars(); renderDocumentLists();
    } catch (error) {
      toast(error.message, 'error');
      if (error.status === 404) { activeDocument = null; await refreshLists(); }
    } finally { loadingDocument = false; }
  }
  async function saveCurrentContent() {
    if (!activeDocument || activeDocument.role === 'viewer' || $('#editorView').hidden) return;
    const id = activeDocument.id;
    const content = $('#documentEditor').innerHTML;
    setConnectionState('saving', 'Saving changes…');
    try {
      const result = await api(`/api/documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: { content } });
      if (activeDocument?.id === id) {
        activeDocument.updated_at = result.document.updated_at;
        activeDocument.content = content;
        $('#documentUpdatedLabel').textContent = `Edited ${shortDate(result.document.updated_at)}`;
        setConnectionState('saved', 'All changes saved'); updateWordCount();
      }
      await refreshLists();
    } catch (error) { setConnectionState('error', 'Save failed'); toast(error.message, 'error'); }
  }
  function scheduleSave() {
    setConnectionState('saving', 'Unsaved changes');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveCurrentContent(); }, 700);
  }
  async function renameDocument() {
    if (!activeDocument || activeDocument.role !== 'owner') return;
    const title = $('#documentTitle').value.trim();
    if (!title) { $('#documentTitle').value = activeDocument.title; toast('Document title cannot be empty.', 'error'); return; }
    try {
      const result = await api(`/api/documents/${encodeURIComponent(activeDocument.id)}`, { method: 'PATCH', body: { title } });
      activeDocument = result.document;
      $('#crumbCurrent').textContent = title;
      $('#documentTitle').value = title;
      await refreshLists();
    } catch (error) { $('#documentTitle').value = activeDocument.title; toast(error.message, 'error'); }
  }
  function updateWordCount() {
    const text = plainFromHtml($('#documentEditor').innerHTML);
    const count = text ? text.split(/\s+/).filter(Boolean).length : 0;
    $('#wordCount').textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
  }
  async function renderSidebarAvatars() {
    const stack = $('#avatarStack'); stack.innerHTML = '';
    if (!activeDocument) return;
    const owner = users.find(u => u.id === activeDocument.owner_id) || activeDocument;
    stack.insertAdjacentHTML('beforeend', renderAvatar({ name: activeDocument.owner_name || owner.name, initials: activeDocument.owner_initials || owner.initials, color: activeDocument.owner_color || owner.color }));
    try {
      const result = await api(`/api/documents/${encodeURIComponent(activeDocument.id)}/shares`);
      (result.shares || []).slice(0, 3).forEach(s => stack.insertAdjacentHTML('beforeend', renderAvatar(s.user)));
    } catch (_) { /* Avatar stack is a convenience, not a critical path. */ }
  }
  async function openShareModal() {
    if (!activeDocument || activeDocument.role !== 'owner') return;
    $('#shareModal').hidden = false;
    $('#shareEmail').value = '';
    $('#shareRole').value = 'editor';
    await refreshShareList();
    $('#shareEmail').focus();
  }
  async function refreshShareList() {
    if (!activeDocument) return;
    try {
      const result = await api(`/api/documents/${encodeURIComponent(activeDocument.id)}/shares`);
      const list = $('#sharedPeopleList'); list.innerHTML = '';
      const owner = { id: activeDocument.owner_id, name: activeDocument.owner_name || me.name, email: activeDocument.owner_email || me.email, initials: activeDocument.owner_initials || me.initials, color: activeDocument.owner_color || me.color };
      const people = [{ user: owner, role: 'owner' }, ...(result.shares || [])];
      $('#sharePeopleCount').textContent = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;
      people.forEach(person => {
        const row = document.createElement('div'); row.className = 'share-person';
        row.innerHTML = `${renderAvatar(person.user)}<div class="share-person-copy"><strong>${escapeText(person.user.name)}${person.role === 'owner' ? ' (you)' : ''}</strong><span>${escapeText(person.user.email)}</span></div>${person.role === 'owner' ? '<span class="share-person-role">Owner</span>' : result.can_manage ? `<select class="share-person-role role-select" aria-label="Access for ${escapeAttr(person.user.name)}" data-user-id="${escapeAttr(person.user.id)}"><option value="editor" ${person.role === 'editor' ? 'selected' : ''}>Can edit</option><option value="viewer" ${person.role === 'viewer' ? 'selected' : ''}>Can view</option></select><button class="icon-button remove-share" aria-label="Remove ${escapeAttr(person.user.name)}" title="Remove access" data-remove-user="${escapeAttr(person.user.id)}"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>` : `<span class="share-person-role">${person.role === 'editor' ? 'Can edit' : 'Can view'}</span>`}`;
        list.appendChild(row);
      });
      $$('.role-select').forEach(select => select.addEventListener('change', async () => {
        const person = users.find(u => u.id === select.dataset.userId);
        try { await api(`/api/documents/${encodeURIComponent(activeDocument.id)}/shares`, { method: 'POST', body: { email: person.email, role: select.value } }); toast(`Access updated for ${person.name}.`); await refreshShareList(); await renderSidebarAvatars(); }
        catch (error) { toast(error.message, 'error'); }
      }));
      $$('[data-remove-user]').forEach(button => button.addEventListener('click', async () => {
        try { await api(`/api/documents/${encodeURIComponent(activeDocument.id)}/shares/${encodeURIComponent(button.dataset.removeUser)}`, { method: 'DELETE' }); toast('Access removed.'); await refreshShareList(); await renderSidebarAvatars(); }
        catch (error) { toast(error.message, 'error'); }
      }));
    } catch (error) { toast(error.message, 'error'); }
  }
  async function invitePerson(event) {
    event.preventDefault();
    if (!activeDocument) return;
    const email = $('#shareEmail').value;
    if (!email) { toast('Choose someone to share with.', 'error'); return; }
    const button = $('#grantAccessButton'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const result = await api(`/api/documents/${encodeURIComponent(activeDocument.id)}/shares`, { method: 'POST', body: { email, role: $('#shareRole').value } });
      toast(`${result.user.name} can now ${result.role === 'editor' ? 'edit' : 'view'} this document.`);
      $('#shareEmail').value = ''; await refreshShareList(); await renderSidebarAvatars(); await refreshLists();
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Invite'; }
  }
  function renderUserChoices() {
    const list = $('#userChoiceList'); list.innerHTML = '';
    users.forEach(user => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `user-choice ${user.id === me?.id ? 'current' : ''}`;
      button.innerHTML = `${renderAvatar(user)}<span><strong>${escapeText(user.name)}</strong><small>${escapeText(user.email)}</small></span><svg class="checkmark" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>`;
      button.addEventListener('click', async () => {
        if (user.id === me.id) { $('#userModal').hidden = true; return; }
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await saveCurrentContent(); }
        try {
          await api('/api/session', { method: 'POST', body: { user_id: user.id } });
          me = user; activeDocument = null; activeScope = 'owned'; updateSidebarUser(); $('#userModal').hidden = true;
          await refreshLists(); setHomeMode('owned'); toast(`Switched to ${user.name}'s workspace.`, 'info');
        } catch (error) { toast(error.message, 'error'); }
      });
      list.appendChild(button);
    });
  }
  async function importSelectedFile(file) {
    if (!file) return;
    const formData = new FormData(); formData.append('file', file);
    try {
      const result = await api('/api/import', { method: 'POST', body: formData });
      await refreshLists(); await openDocument(result.document.id); toast(`Imported ${result.imported_filename || file.name}.`);
    } catch (error) { toast(error.message, 'error'); }
    finally { $('#fileInput').value = ''; }
  }
  function runFormat(command, value) {
    if (!activeDocument || activeDocument.role === 'viewer') return;
    $('#documentEditor').focus();
    if (command === 'formatBlock') document.execCommand('formatBlock', false, value);
    else document.execCommand(command, false, null);
    updateWordCount(); scheduleSave();
  }
  function showDeleteModal() { if (!activeDocument || activeDocument.role !== 'owner') return; pendingDeleteId = activeDocument.id; $('#deleteModal').hidden = false; }
  async function deleteDocument() {
    if (!pendingDeleteId) return;
    try {
      await api(`/api/documents/${encodeURIComponent(pendingDeleteId)}`, { method: 'DELETE' });
      pendingDeleteId = null; activeDocument = null; $('#deleteModal').hidden = true; await refreshLists(); setHomeMode('owned'); toast('Document deleted.');
    } catch (error) { toast(error.message, 'error'); }
  }

  // Navigation
  $('#ownedNav').addEventListener('click', () => { activeDocument = null; setHomeMode('owned'); });
  $('#sharedNav').addEventListener('click', () => { activeDocument = null; setHomeMode('shared'); });
  $('#newDocumentButton').addEventListener('click', createDocument);
  $('#viewAllButton').addEventListener('click', () => { const grid = $('#documentGrid'); grid.innerHTML = ''; currentDocuments.forEach((doc, index) => grid.appendChild(makeDocumentCard(doc, index))); });
  $('#refreshDocs').addEventListener('click', refreshLists);
  $('#workspaceSwitch').addEventListener('click', () => { renderUserChoices(); $('#userModal').hidden = false; });
  $('#userMenuButton').addEventListener('click', () => { renderUserChoices(); $('#userModal').hidden = false; });
  $('#closeUserModal').addEventListener('click', () => $('#userModal').hidden = true);
  $('#openSidebar').addEventListener('click', () => $('#sidebar').classList.add('open'));
  $('#closeSidebar').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  $('#sidebar').addEventListener('click', event => { if (event.target.closest('.sidebar-doc')) $('#sidebar').classList.remove('open'); });
  $('#importButton').addEventListener('click', () => $('#fileInput').click());
  $('#importHintButton').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', event => importSelectedFile(event.target.files?.[0]));
  $('#documentEditor').addEventListener('input', () => { updateWordCount(); scheduleSave(); });
  $('#documentTitle').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('#documentTitle').blur(); } if (event.key === 'Escape' && activeDocument) { $('#documentTitle').value = activeDocument.title; $('#documentTitle').blur(); } });
  $('#documentTitle').addEventListener('blur', renameDocument);
  $$('#formatToolbar [data-command]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => runFormat(button.dataset.command, button.dataset.value));
  });
  $('#blockFormat').addEventListener('change', event => runFormat('formatBlock', event.target.value));
  $('#shareButton').addEventListener('click', openShareModal);
  $('#closeShareModal').addEventListener('click', () => $('#shareModal').hidden = true);
  $('#shareModal').addEventListener('click', event => { if (event.target === $('#shareModal')) $('#shareModal').hidden = true; });
  $('#userModal').addEventListener('click', event => { if (event.target === $('#userModal')) $('#userModal').hidden = true; });
  $('#shareForm').addEventListener('submit', invitePerson);
  $('#moreButton').addEventListener('click', showDeleteModal);
  $('#closeDeleteModal').addEventListener('click', () => { pendingDeleteId = null; $('#deleteModal').hidden = true; });
  $('#cancelDelete').addEventListener('click', () => { pendingDeleteId = null; $('#deleteModal').hidden = true; });
  $('#confirmDelete').addEventListener('click', deleteDocument);
  $('#deleteModal').addEventListener('click', event => { if (event.target === $('#deleteModal')) $('#deleteModal').hidden = true; });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); if (saveTimer) clearTimeout(saveTimer); saveTimer = null; saveCurrentContent();
    }
    if (event.key === 'Escape') {
      ['shareModal', 'userModal', 'deleteModal'].forEach(id => { const modal = $(`#${id}`); if (!modal.hidden) modal.hidden = true; });
      $('#sidebar').classList.remove('open');
    }
  });
  window.addEventListener('beforeunload', event => { if (saveTimer) { event.preventDefault(); event.returnValue = ''; } });

  (async function start() {
    try { await loadSession(); await refreshLists(); setHomeMode('owned'); }
    catch (error) { toast(error.message || 'Could not start the app.', 'error'); }
  })();
})();
