// ═══════════════════════════════════════
// MedAI v2 — Fully Functional Claude API
// ═══════════════════════════════════════

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

// Key from config.js or prompt
function getApiKey() {
    if (typeof MEDAI_CONFIG !== 'undefined' && MEDAI_CONFIG.key) return MEDAI_CONFIG.key;
    return localStorage.getItem('medai_api_key') || '';
}

function setApiKey(key) {
    localStorage.setItem('medai_api_key', key);
}

const SYSTEM_PROMPT = `You are MedAI, an expert medical AI assistant. You help patients and doctors understand medical information.

CAPABILITIES:
- Analyze medical images (X-rays, CT scans, MRI, pathology, dermatology)
- Read and explain lab reports, blood panels, pathology reports
- Check drug interactions and contraindications
- Perform symptom assessment with differential diagnosis
- Explain medical terminology in plain language
- Provide evidence-based clinical decision support

RULES:
1. Always provide thorough, accurate medical analysis
2. Use clear headings and structure with markdown
3. Flag abnormal values clearly with severity (Normal, Mild, Moderate, Severe, Critical)
4. Always include a disclaimer that this is AI-assisted analysis and patients should consult their healthcare provider
5. For imaging, describe what you observe systematically
6. For lab reports, explain each value, whether it's normal/abnormal, and clinical significance
7. For drug interactions, classify severity (Minor, Moderate, Serious, Contraindicated)
8. For symptoms, provide differential diagnosis ranked by likelihood
9. Use **bold** for important items, bullet points for lists
10. Be empathetic but clinically precise
11. Flag anything potentially urgent prominently
12. Never diagnose definitively — frame as "findings suggest" or "consistent with"`;

// ── STATE ──
let chatHistory = [];
let attachedFile = null;
let attachedFileBase64 = null;
let attachedFileType = null;
let isProcessing = false;

// ── NAV ──
window.addEventListener('scroll', () => {
    const nav = document.getElementById('nav');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
});

function toggleMobileNav() {
    document.getElementById('navLinks').classList.toggle('open');
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open');
    // overlay
    let overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebarOverlay';
        overlay.className = 'sidebar-overlay';
        overlay.onclick = () => { sb.classList.remove('open'); overlay.classList.remove('active'); };
        document.body.appendChild(overlay);
    }
    overlay.classList.toggle('active', sb.classList.contains('open'));
}

// ── PAGES ──
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + name);
    if (page) { page.classList.add('active'); window.scrollTo(0, 0); }
    document.getElementById('navLinks')?.classList.remove('open');
    // Close sidebar on mobile
    document.getElementById('sidebar')?.classList.remove('open');
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.classList.remove('active');
}

// ── HERO ANIMATION ──
setTimeout(() => {
    const el = document.getElementById('heroResult');
    if (el) {
        el.innerHTML = `<div style="font-size:0.84rem;line-height:1.7">
            <strong style="color:var(--green)">✓ No acute findings</strong><br>
            <span style="color:var(--stone-600)">Lung fields clear bilaterally. Normal cardiac silhouette. No pleural effusion. Costophrenic angles sharp.</span><br>
            <span style="font-size:0.75rem;color:var(--stone-400);margin-top:6px;display:block">Confidence: 96.4% · 2.3s</span></div>`;
    }
}, 3000);

// ═════════════════════════
// CLAUDE API
// ═════════════════════════

async function callClaude(messages) {
    const key = getApiKey();
    if (!key) {
        throw new Error('No API key configured. Click "Set API Key" in the top right.');
    }

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: messages
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        let errMsg = `API Error ${response.status}`;
        try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errMsg;
        } catch(e) {}

        if (response.status === 401) {
            errMsg = 'Invalid API key. Please check your key and try again.';
            localStorage.removeItem('medai_api_key');
            updateApiStatus(false);
        }
        throw new Error(errMsg);
    }

    const data = await response.json();
    return data.content.map(c => c.text || '').join('');
}

// Streaming version
async function callClaudeStream(messages, onChunk) {
    const key = getApiKey();
    if (!key) {
        throw new Error('No API key configured. Click "Set API Key" in the top right.');
    }

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: messages,
            stream: true
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        let errMsg = `API Error ${response.status}`;
        try { errMsg = JSON.parse(errText).error?.message || errMsg; } catch(e) {}
        if (response.status === 401) {
            localStorage.removeItem('medai_api_key');
            updateApiStatus(false);
            errMsg = 'Invalid API key. Please check your key and try again.';
        }
        throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                        fullText += parsed.delta.text;
                        onChunk(fullText);
                    }
                } catch(e) {}
            }
        }
    }
    return fullText;
}

// ── MARKDOWN ──
function renderMarkdown(text) {
    let html = text
        .replace(/^#### (.+)$/gm, '<h4 style="margin-top:14px">$1</h4>')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em style="font-family:var(--font-body);color:inherit">$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^[-•\*] (.+)$/gm, '{{LI}}$1{{/LI}}')
        .replace(/^\d+\.\s+(.+)$/gm, '{{LI}}$1{{/LI}}')
        .replace(/\n\n/g, '{{PP}}')
        .replace(/\n/g, '<br>');

    // Wrap lists
    html = html.replace(/((?:{{LI}}.*?{{\/LI}}(?:<br>)?)+)/g, '<ul>$1</ul>');
    html = html.replace(/{{LI}}/g, '<li>').replace(/{{\/LI}}/g, '</li>');
    html = html.replace(/{{PP}}/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<[hul])/g, '$1');
    html = html.replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');

    // Badges
    html = html.replace(/\b(Normal|Within Normal Limits|No abnormalities)\b/gi, '<span class="badge badge-green">$1</span>');
    html = html.replace(/\b(Mild|Slightly Elevated|Minor|Low Risk)\b/gi, '<span class="badge badge-yellow">$1</span>');
    html = html.replace(/\b(Moderate|Elevated)\b/gi, '<span class="badge badge-yellow">$1</span>');
    html = html.replace(/\b(Severe|Critical|High Risk|Contraindicated|URGENT|EMERGENCY|Serious)\b/gi, '<span class="badge badge-red">$1</span>');

    return `<div class="ai-rendered">${html}</div>`;
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ═════════════════════════
// CHAT
// ═════════════════════════

function addChatMsg(content, role, isHtml = false) {
    const c = document.getElementById('chatMessages');
    const empty = document.getElementById('chatEmpty');
    if (empty) empty.remove();
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;
    msg.innerHTML = `<div class="msg-avatar">${role === 'ai' ? 'AI' : 'You'}</div><div class="msg-bubble">${isHtml ? content : escapeHtml(content)}</div>`;
    c.appendChild(msg);
    c.scrollTop = c.scrollHeight;
    return msg;
}

function addThinking() {
    const c = document.getElementById('chatMessages');
    const empty = document.getElementById('chatEmpty');
    if (empty) empty.remove();
    const msg = document.createElement('div');
    msg.className = 'msg ai'; msg.id = 'thinking-msg';
    msg.innerHTML = `<div class="msg-avatar">AI</div><div class="msg-bubble"><div class="thinking-dots"><span></span><span></span><span></span></div></div>`;
    c.appendChild(msg);
    c.scrollTop = c.scrollHeight;
}

function removeThinking() { const el = document.getElementById('thinking-msg'); if (el) el.remove(); }

function clearChat() {
    chatHistory = [];
    document.getElementById('chatMessages').innerHTML = `
        <div class="chat-empty" id="chatEmpty">
            <div class="empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" stroke="var(--terra)" stroke-width="2" opacity="0.3"/><path d="M32 18v10M32 36v10M18 32h10M36 32h10" stroke="var(--terra)" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="32" r="10" stroke="var(--terra)" stroke-width="2"/></svg></div>
            <h2>Medical AI Assistant</h2>
            <p>Ask any medical question, describe symptoms, or upload medical documents for AI-powered analysis.</p>
            <div class="empty-chips">
                <button onclick="quickPrompt('I have sharp chest pain when breathing deeply. Should I be worried?')">Check symptoms</button>
                <button onclick="quickPrompt('Explain what a CBC blood test measures.')">Lab work</button>
                <button onclick="showPage('medications')">Drug interactions</button>
            </div>
        </div>`;
}

async function sendChat() {
    if (isProcessing) return;
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text && !attachedFile) return;

    isProcessing = true;
    document.getElementById('sendBtn').disabled = true;

    // Display user message
    let displayHtml = '';
    if (attachedFile && attachedFileType?.startsWith('image/')) {
        displayHtml += `<img class="img-preview" src="${attachedFileBase64}" alt="Uploaded"><br>`;
    } else if (attachedFile) {
        displayHtml += `<strong>📎 ${attachedFile.name}</strong><br>`;
    }
    displayHtml += escapeHtml(text || 'Please analyze this file.');
    addChatMsg(displayHtml, 'user', true);
    input.value = ''; input.style.height = 'auto';

    // Build API message
    const userContent = [];
    if (attachedFile && attachedFileType?.startsWith('image/')) {
        const b64 = attachedFileBase64.includes(',') ? attachedFileBase64.split(',')[1] : attachedFileBase64;
        userContent.push({ type: 'image', source: { type: 'base64', media_type: attachedFileType, data: b64 } });
    }
    userContent.push({ type: 'text', text: text || (attachedFile ? `Analyze this uploaded medical file: ${attachedFile.name}` : '') });
    removeAttachment();
    chatHistory.push({ role: 'user', content: userContent });

    addThinking();

    try {
        let streamEl = null;
        let streamBubble = null;
        let started = false;

        const fullText = await callClaudeStream(chatHistory, (partial) => {
            if (!started) {
                removeThinking();
                streamEl = document.createElement('div');
                streamEl.className = 'msg ai';
                streamEl.innerHTML = `<div class="msg-avatar">AI</div><div class="msg-bubble" id="stream-bubble"></div>`;
                document.getElementById('chatMessages').appendChild(streamEl);
                streamBubble = document.getElementById('stream-bubble');
                started = true;
            }
            if (streamBubble) {
                streamBubble.innerHTML = renderMarkdown(partial) + '<div class="disclaimer">⚕️ AI-assisted analysis. Always consult your healthcare provider.</div>';
                document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
            }
        });

        if (!started) {
            removeThinking();
            addChatMsg(renderMarkdown(fullText) + '<div class="disclaimer">⚕️ AI-assisted analysis. Always consult your healthcare provider.</div>', 'ai', true);
        }

        chatHistory.push({ role: 'assistant', content: fullText });
        updateApiStatus(true);

    } catch (error) {
        removeThinking();
        addChatMsg(`<strong>⚠️ Error:</strong> ${escapeHtml(error.message)}`, 'ai', true);
        if (error.message.includes('API key')) updateApiStatus(false);
    }

    isProcessing = false;
    document.getElementById('sendBtn').disabled = false;
}

function handleChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }

function quickPrompt(text) {
    showPage('assistant');
    setTimeout(() => { document.getElementById('chatInput').value = text; sendChat(); }, 150);
}

// ── FILES ──
function handleGlobalFile(event) {
    const file = event.target.files[0]; if (!file) return;
    attachedFile = file; attachedFileType = file.type;
    document.getElementById('filePreviewBar').style.display = 'block';
    document.getElementById('fileChipName').textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        attachedFileBase64 = e.target.result;
        if (file.type.startsWith('image/')) {
            const thumb = document.getElementById('imagePreviewThumb');
            thumb.style.display = 'block';
            thumb.innerHTML = `<img src="${e.target.result}" alt="preview">`;
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function removeAttachment() {
    attachedFile = null; attachedFileBase64 = null; attachedFileType = null;
    document.getElementById('filePreviewBar').style.display = 'none';
    const thumb = document.getElementById('imagePreviewThumb');
    if (thumb) { thumb.style.display = 'none'; thumb.innerHTML = ''; }
}

// ── IMAGE ANALYSIS PAGE ──
function handleImageUpload(e) { const f = e.target.files[0]; if (f) processImage(f); e.target.value = ''; }
function handleImageDrop(e) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) processImage(f); }

async function processImage(file) {
    const resultArea = document.getElementById('imageAnalysisResult');
    const imgPreview = document.getElementById('resultImagePreview');
    const content = document.getElementById('imageResultContent');

    resultArea.style.display = 'block';
    content.innerHTML = '<div class="result-loading"><div class="loader"></div><span>AI is analyzing your image...</span></div>';

    const reader = new FileReader();
    reader.onload = async (e) => {
        imgPreview.innerHTML = `<img src="${e.target.result}" alt="Medical image">`;
        const b64 = e.target.result.split(',')[1];
        try {
            const result = await callClaude([{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
                    { type: 'text', text: `Analyze this medical image thoroughly:\n1. **Image Type**: What type of medical image\n2. **Systematic Findings**: Each anatomical structure/region\n3. **Abnormalities**: Any abnormal findings with severity\n4. **Impression**: Overall summary\n5. **Recommendations**: Suggested follow-up\n\nBe thorough and systematic.` }
                ]
            }]);
            content.innerHTML = renderMarkdown(result) + '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--sand-dark);font-size:0.76rem;color:var(--stone-400)">⚕️ AI-assisted analysis. Final interpretation by a qualified specialist.</div>';
            updateApiStatus(true);
        } catch (error) {
            content.innerHTML = `<p style="color:var(--red)"><strong>⚠️ Error:</strong> ${escapeHtml(error.message)}</p>`;
        }
    };
    reader.readAsDataURL(file);
}

// ── REPORT ANALYSIS ──
async function analyzeReport() {
    const text = document.getElementById('reportText').value.trim();
    if (!text) return;
    const btn = document.getElementById('analyzeReportBtn');
    const panel = document.getElementById('reportResultPanel');
    btn.disabled = true;
    btn.innerHTML = '<div class="loader" style="width:16px;height:16px;border-width:2px"></div> Analyzing...';
    panel.innerHTML = '<div class="result-loading"><div class="loader"></div><span>AI is reading your report...</span></div>';

    try {
        const result = await callClaude([{ role: 'user', content: `Analyze this medical report in detail. For each value:\n1. State if **Normal**, **Abnormal (Low)**, or **Abnormal (High)**\n2. Plain language meaning\n3. Clinical significance\n4. Flag concerning values\n\nEnd with:\n- **Overall Summary**\n- **Values of Concern**\n- **Recommended Follow-up**\n\nReport:\n\n${text}` }]);
        panel.innerHTML = renderMarkdown(result) + '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--sand-dark);font-size:0.76rem;color:var(--stone-400)">⚕️ AI-assisted. Your provider interprets in context of your full history.</div>';
        updateApiStatus(true);
    } catch (error) {
        panel.innerHTML = `<p style="color:var(--red)"><strong>⚠️ Error:</strong> ${escapeHtml(error.message)}</p>`;
    }
    btn.disabled = false;
    btn.innerHTML = 'Analyze Report <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ── DRUG INTERACTIONS ──
async function checkMedications() {
    const meds = document.getElementById('medInput').value.trim();
    if (!meds) return;
    const allergies = document.getElementById('allergyInput').value.trim();
    const conditions = document.getElementById('conditionInput').value.trim();
    const btn = document.getElementById('checkMedBtn');
    const panel = document.getElementById('medResultPanel');
    btn.disabled = true;
    btn.innerHTML = '<div class="loader" style="width:16px;height:16px;border-width:2px"></div> Checking...';
    panel.innerHTML = '<div class="result-loading"><div class="loader"></div><span>Checking interactions...</span></div>';

    let prompt = `Comprehensive drug interaction check:\n\n**Medications:**\n${meds}`;
    if (allergies) prompt += `\n\n**Allergies:** ${allergies}`;
    if (conditions) prompt += `\n\n**Conditions:** ${conditions}`;
    prompt += `\n\nCheck:\n1. **Drug-Drug Interactions** — every pair, with severity (Minor/Moderate/Serious/Contraindicated)\n2. **Drug-Allergy Conflicts** — including cross-reactivity\n3. **Drug-Condition Concerns**\n4. **Duplicate Therapy**\n5. **Overall Safety Assessment**`;

    try {
        const result = await callClaude([{ role: 'user', content: prompt }]);
        panel.innerHTML = renderMarkdown(result) + '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--sand-dark);font-size:0.76rem;color:var(--stone-400)">⚕️ Verify with your pharmacist before medication changes.</div>';
        updateApiStatus(true);
    } catch (error) {
        panel.innerHTML = `<p style="color:var(--red)"><strong>⚠️ Error:</strong> ${escapeHtml(error.message)}</p>`;
    }
    btn.disabled = false;
    btn.innerHTML = 'Check Interactions <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ── API STATUS ──
function updateApiStatus(online) {
    const el = document.getElementById('apiStatus');
    if (!el) return;
    if (online) {
        el.className = 'api-status';
        el.innerHTML = '<span class="status-dot"></span><span>AI Online</span>';
    } else {
        el.className = 'api-status error';
        el.innerHTML = `<span class="status-dot"></span><span style="cursor:pointer" onclick="promptApiKey()">Set API Key</span>`;
    }
}

function promptApiKey() {
    const key = prompt('Enter your Anthropic API key (starts with sk-ant-):');
    if (key && key.startsWith('sk-')) {
        setApiKey(key);
        updateApiStatus(true);
        checkApiHealth();
    }
}

async function checkApiHealth() {
    const key = getApiKey();
    if (!key) { updateApiStatus(false); return; }
    try {
        const r = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({ model: MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'ping' }] })
        });
        updateApiStatus(r.ok);
        if (!r.ok && r.status === 401) { localStorage.removeItem('medai_api_key'); }
    } catch { updateApiStatus(false); }
}

// Init
setTimeout(checkApiHealth, 800);

// ── SCROLL ANIMATIONS ──
const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.style.opacity = '1'; e.target.style.transform = 'translateY(0)'; } });
}, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

document.querySelectorAll('.cap-card, .sec-card, .flow-step').forEach(el => {
    el.style.opacity = '0'; el.style.transform = 'translateY(14px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
});
