// ═══════════════════════════════════════
// MedAI v2 — Claude + Gemini API Support
// ═══════════════════════════════════════

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GEMINI_MODEL = 'gemini-2.0-flash';
function geminiUrl(k) { return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${k}`; }
function geminiStreamUrl(k) { return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${k}`; }

const DEFAULT_KEY = 'AIzaSyD861dpHPwJCtr8WEq1V__eD3uq_xc5wz8';

function getApiKey() {
    if (typeof MEDAI_CONFIG !== 'undefined' && MEDAI_CONFIG.key) return MEDAI_CONFIG.key;
    return localStorage.getItem('medai_api_key') || DEFAULT_KEY;
}
function setApiKey(key) { localStorage.setItem('medai_api_key', key); }
function getProvider(key) {
    if (!key) return null;
    if (key.startsWith('sk-')) return 'claude';
    if (key.startsWith('AIza')) return 'gemini';
    return 'gemini';
}

const SYSTEM_PROMPT = `You are MedAI, an expert medical AI assistant. You help patients and doctors understand medical information.

CAPABILITIES: Analyze medical images (X-rays, CT, MRI, pathology, dermatology), read lab reports, check drug interactions, perform symptom assessment with differential diagnosis, explain medical terminology, provide clinical decision support.

RULES:
1. Provide thorough, accurate medical analysis with clear markdown headings
2. Flag abnormal values with severity (Normal, Mild, Moderate, Severe, Critical)
3. Always include disclaimer that patients should consult their healthcare provider
4. For imaging, describe systematically. For labs, explain each value. For drugs, classify interaction severity (Minor/Moderate/Serious/Contraindicated). For symptoms, rank differential diagnoses.
5. Use **bold** for key items, bullet points for lists. Be empathetic but precise.
6. Never diagnose definitively — use "findings suggest" or "consistent with"
7. Flag urgent findings prominently`;

let chatHistory = [], attachedFile = null, attachedFileBase64 = null, attachedFileType = null, isProcessing = false;

// ── NAV ──
window.addEventListener('scroll', () => { document.getElementById('nav')?.classList.toggle('scrolled', window.scrollY > 20); });
function toggleMobileNav() { document.getElementById('navLinks').classList.toggle('open'); }
function toggleSidebar() {
    const sb = document.getElementById('sidebar'); sb.classList.toggle('open');
    let ov = document.getElementById('sidebarOverlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'sidebarOverlay'; ov.className = 'sidebar-overlay'; ov.onclick = () => { sb.classList.remove('open'); ov.classList.remove('active'); }; document.body.appendChild(ov); }
    ov.classList.toggle('active', sb.classList.contains('open'));
}
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + name)?.classList.add('active');
    window.scrollTo(0, 0);
    document.getElementById('navLinks')?.classList.remove('open');
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
}

setTimeout(() => {
    const el = document.getElementById('heroResult');
    if (el) el.innerHTML = `<div style="font-size:0.84rem;line-height:1.7"><strong style="color:var(--green)">✓ No acute findings</strong><br><span style="color:var(--stone-600)">Lung fields clear bilaterally. Normal cardiac silhouette. No pleural effusion.</span><br><span style="font-size:0.75rem;color:var(--stone-400);display:block;margin-top:4px">Confidence: 96.4% · 2.3s</span></div>`;
}, 3000);

// ═══════ UNIFIED API ═══════

function toGemini(messages) {
    return messages.map(m => {
        const parts = [];
        const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
        for (const c of content) {
            if (c.type === 'text') parts.push({ text: c.text });
            else if (c.type === 'image') parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });
}

async function callAI(messages) {
    const key = getApiKey();
    if (!key) throw new Error('No API key. Click the status badge in the nav bar to set one.');
    return getProvider(key) === 'claude' ? await _claude(key, messages) : await _gemini(key, messages);
}

async function callAIStream(messages, onChunk) {
    const key = getApiKey();
    if (!key) throw new Error('No API key. Click the status badge in the nav bar to set one.');
    return getProvider(key) === 'claude' ? await _claudeStream(key, messages, onChunk) : await _geminiStream(key, messages, onChunk);
}

async function _claude(key, messages) {
    const r = await fetch(CLAUDE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4096, system: SYSTEM_PROMPT, messages }) });
    if (!r.ok) await _err(r);
    const d = await r.json(); return d.content.map(c => c.text || '').join('');
}
async function _claudeStream(key, messages, onChunk) {
    const r = await fetch(CLAUDE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4096, system: SYSTEM_PROMPT, messages, stream: true }) });
    if (!r.ok) await _err(r);
    const reader = r.body.getReader(), dec = new TextDecoder(); let full = '', buf = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const l of lines) { if (l.startsWith('data: ')) { try { const p = JSON.parse(l.slice(6).trim()); if (p.type === 'content_block_delta' && p.delta?.text) { full += p.delta.text; onChunk(full); } } catch(e) {} } } }
    return full;
}
async function _gemini(key, messages) {
    const r = await fetch(geminiUrl(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: toGemini(messages), generationConfig: { maxOutputTokens: 4096 } }) });
    if (!r.ok) await _err(r);
    const d = await r.json(); return d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || 'No response.';
}
async function _geminiStream(key, messages, onChunk) {
    const r = await fetch(geminiStreamUrl(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: toGemini(messages), generationConfig: { maxOutputTokens: 4096 } }) });
    if (!r.ok) await _err(r);
    const reader = r.body.getReader(), dec = new TextDecoder(); let full = '', buf = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const l of lines) { if (l.startsWith('data: ')) { try { const p = JSON.parse(l.slice(6).trim()); const t = p.candidates?.[0]?.content?.parts?.[0]?.text; if (t) { full += t; onChunk(full); } } catch(e) {} } } }
    return full;
}
async function _err(r) {
    const t = await r.text(); let m = `API Error ${r.status}`;
    try { const j = JSON.parse(t); m = j.error?.message || j.error?.status || m; } catch(e) {}
    if ([401,403].includes(r.status)) { m = 'Invalid API key. Please update your key.'; updateApiStatus(false); }
    throw new Error(m);
}

// ── MARKDOWN ──
function renderMarkdown(text) {
    let h = text.replace(/^#### (.+)$/gm,'<h4 style="margin-top:14px">$1</h4>').replace(/^### (.+)$/gm,'<h4>$1</h4>').replace(/^## (.+)$/gm,'<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g,'<em style="font-family:var(--font-body);color:inherit">$1</em>')
        .replace(/`(.+?)`/g,'<code>$1</code>').replace(/^[-•\*] (.+)$/gm,'{{LI}}$1{{/LI}}').replace(/^\d+\.\s+(.+)$/gm,'{{LI}}$1{{/LI}}')
        .replace(/\n\n/g,'{{PP}}').replace(/\n/g,'<br>');
    h = h.replace(/((?:{{LI}}.*?{{\/LI}}(?:<br>)?)+)/g,'<ul>$1</ul>').replace(/{{LI}}/g,'<li>').replace(/{{\/LI}}/g,'</li>').replace(/{{PP}}/g,'</p><p>');
    h = '<p>'+h+'</p>'; h = h.replace(/<p><\/p>/g,'').replace(/<p>(<[hul])/g,'$1').replace(/(<\/[hul][^>]*>)<\/p>/g,'$1');
    h = h.replace(/\b(Normal|Within Normal Limits|No abnormalities)\b/gi,'<span class="badge badge-green">$1</span>');
    h = h.replace(/\b(Mild|Slightly Elevated|Minor|Low Risk)\b/gi,'<span class="badge badge-yellow">$1</span>');
    h = h.replace(/\b(Moderate|Elevated)\b/gi,'<span class="badge badge-yellow">$1</span>');
    h = h.replace(/\b(Severe|Critical|High Risk|Contraindicated|URGENT|EMERGENCY|Serious)\b/gi,'<span class="badge badge-red">$1</span>');
    return `<div class="ai-rendered">${h}</div>`;
}
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ═══════ CHAT ═══════
function addChatMsg(c, role, html=false) { const el = document.getElementById('chatMessages'); document.getElementById('chatEmpty')?.remove(); const m = document.createElement('div'); m.className=`msg ${role}`; m.innerHTML=`<div class="msg-avatar">${role==='ai'?'AI':'You'}</div><div class="msg-bubble">${html?c:escapeHtml(c)}</div>`; el.appendChild(m); el.scrollTop=el.scrollHeight; return m; }
function addThinking() { const c=document.getElementById('chatMessages'); document.getElementById('chatEmpty')?.remove(); const m=document.createElement('div'); m.className='msg ai'; m.id='thinking-msg'; m.innerHTML=`<div class="msg-avatar">AI</div><div class="msg-bubble"><div class="thinking-dots"><span></span><span></span><span></span></div></div>`; c.appendChild(m); c.scrollTop=c.scrollHeight; }
function removeThinking() { document.getElementById('thinking-msg')?.remove(); }
function clearChat() { chatHistory=[]; document.getElementById('chatMessages').innerHTML=`<div class="chat-empty" id="chatEmpty"><div class="empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" stroke="var(--terra)" stroke-width="2" opacity="0.3"/><path d="M32 18v10M32 36v10M18 32h10M36 32h10" stroke="var(--terra)" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="32" r="10" stroke="var(--terra)" stroke-width="2"/></svg></div><h2>Medical AI Assistant</h2><p>Ask any medical question, describe symptoms, or upload documents.</p><div class="empty-chips"><button onclick="quickPrompt('I have sharp chest pain when breathing deeply.')">Check symptoms</button><button onclick="quickPrompt('Explain what a CBC blood test measures.')">Lab work</button><button onclick="showPage('medications')">Drug interactions</button></div></div>`; }

async function sendChat() {
    if (isProcessing) return;
    const input = document.getElementById('chatInput'), text = input.value.trim();
    if (!text && !attachedFile) return;
    isProcessing = true; document.getElementById('sendBtn').disabled = true;
    let dh = '';
    if (attachedFile && attachedFileType?.startsWith('image/')) dh += `<img class="img-preview" src="${attachedFileBase64}" alt="Uploaded"><br>`;
    else if (attachedFile) dh += `<strong>📎 ${attachedFile.name}</strong><br>`;
    dh += escapeHtml(text || 'Please analyze this file.');
    addChatMsg(dh, 'user', true); input.value = ''; input.style.height = 'auto';
    const uc = [];
    if (attachedFile && attachedFileType?.startsWith('image/')) { const b = attachedFileBase64.includes(',') ? attachedFileBase64.split(',')[1] : attachedFileBase64; uc.push({ type:'image', source:{ type:'base64', media_type:attachedFileType, data:b } }); }
    uc.push({ type:'text', text: text || (attachedFile ? `Analyze this medical file: ${attachedFile.name}` : '') });
    removeAttachment(); chatHistory.push({ role:'user', content:uc }); addThinking();
    try {
        let se=null, sb=null, started=false;
        const full = await callAIStream(chatHistory, (p) => {
            if (!started) { removeThinking(); se=document.createElement('div'); se.className='msg ai'; se.innerHTML=`<div class="msg-avatar">AI</div><div class="msg-bubble" id="stream-bubble"></div>`; document.getElementById('chatMessages').appendChild(se); sb=document.getElementById('stream-bubble'); started=true; }
            if (sb) { sb.innerHTML = renderMarkdown(p)+'<div class="disclaimer">⚕️ AI-assisted. Always consult your healthcare provider.</div>'; document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight; }
        });
        if (!started) { removeThinking(); addChatMsg(renderMarkdown(full)+'<div class="disclaimer">⚕️ AI-assisted. Always consult your healthcare provider.</div>', 'ai', true); }
        chatHistory.push({ role:'assistant', content:full }); updateApiStatus(true);
    } catch (e) { removeThinking(); addChatMsg(`<strong>⚠️ Error:</strong> ${escapeHtml(e.message)}`, 'ai', true); }
    isProcessing = false; document.getElementById('sendBtn').disabled = false;
}

function handleChatKey(e) { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendChat(); } }
function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,140)+'px'; }
function quickPrompt(t) { showPage('assistant'); setTimeout(()=>{ document.getElementById('chatInput').value=t; sendChat(); },150); }

// ── FILES ──
function handleGlobalFile(e) { const f=e.target.files[0]; if(!f) return; attachedFile=f; attachedFileType=f.type; document.getElementById('filePreviewBar').style.display='block'; document.getElementById('fileChipName').textContent=f.name; const r=new FileReader(); r.onload=(ev)=>{ attachedFileBase64=ev.target.result; if(f.type.startsWith('image/')) { const th=document.getElementById('imagePreviewThumb'); th.style.display='block'; th.innerHTML=`<img src="${ev.target.result}" alt="preview">`; } }; r.readAsDataURL(f); e.target.value=''; }
function removeAttachment() { attachedFile=null; attachedFileBase64=null; attachedFileType=null; document.getElementById('filePreviewBar').style.display='none'; const th=document.getElementById('imagePreviewThumb'); if(th){th.style.display='none';th.innerHTML='';} }

// ── IMAGE PAGE ──
function handleImageUpload(e) { const f=e.target.files[0]; if(f) processImage(f); e.target.value=''; }
function handleImageDrop(e) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); const f=e.dataTransfer.files[0]; if(f?.type.startsWith('image/')) processImage(f); }
async function processImage(file) {
    const ra=document.getElementById('imageAnalysisResult'), ip=document.getElementById('resultImagePreview'), co=document.getElementById('imageResultContent');
    ra.style.display='block'; co.innerHTML='<div class="result-loading"><div class="loader"></div><span>AI is analyzing your image...</span></div>';
    const reader=new FileReader(); reader.onload=async(e)=>{ ip.innerHTML=`<img src="${e.target.result}" alt="Medical image">`; const b=e.target.result.split(',')[1];
        try { const res=await callAI([{ role:'user', content:[{ type:'image', source:{ type:'base64', media_type:file.type, data:b } },{ type:'text', text:'Analyze this medical image thoroughly:\n1. **Image Type**\n2. **Systematic Findings** per anatomical region\n3. **Abnormalities** with severity\n4. **Impression**\n5. **Recommendations**\n\nBe thorough and systematic.' }] }]);
            co.innerHTML=renderMarkdown(res)+'<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--sand-dark);font-size:0.76rem;color:var(--stone-400)">⚕️ AI-assisted. Final interpretation by a qualified specialist.</div>'; updateApiStatus(true);
        } catch(err) { co.innerHTML=`<p style="color:var(--red)"><strong>⚠️ Error:</strong> ${escapeHtml(err.message)}</p>`; } }; reader.readAsDataURL(file);
}

// ── REPORT ──
async function analyzeReport() {
    const text=document.getElementById('reportText').value.trim(); if(!text) return;
    const btn=document.getElementById('analyzeReportBtn'), panel=document.getElementById('reportResultPanel');
    btn.disabled=true; btn.innerHTML='<div class="loader" style="width:16px;height:16px;border-width:2px"></div> Analyzing...';
    panel.innerHTML='<div class="result-loading"><div class="loader"></div><span>AI is reading your report...</span></div>';
    try { const res=await callAI([{ role:'user', content:`Analyze this medical report in detail. For each value state if Normal/Abnormal, explain in plain language, clinical significance, flag concerns.\n\nEnd with: Overall Summary, Values of Concern, Recommended Follow-up.\n\nReport:\n\n${text}` }]);
        panel.innerHTML=renderMarkdown(res)+'<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--sand-dark);font-size:0.76rem;color:var(--stone-400)">⚕️ AI-assisted. Provider interprets in context of your full history.</div>'; updateApiStatus(true);
    } catch(e) { panel.innerHTML=`<p style="color:var(--red)"><strong>⚠️ Error:</strong> ${escapeHtml(e.message)}</p>`; }
    btn.disabled=false; btn.innerHTML='Analyze Report <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ── MEDICATIONS ──
async function checkMedications() {
    const meds=document.getElementById('medInput').value.trim(); if(!meds) return;
    const al=document.getElementById('allergyInput').value.trim(), co=document.getElementById('conditionInput').value.trim();
    const btn=document.getElementById('checkMedBtn'), panel=document.getElementById('medResultPanel');
    btn.disabled=true; btn.innerHTML='<div class="loader" style="width:16px;height:16px;border-width:2px"></div> Checking...';
    panel.innerHTML='<div class="result-loading"><div class="loader"></div><span>Checking interactions...</span></div>';
    let p=`Comprehensive drug interaction check:\n\n**Medications:**\n${meds}`; if(al) p+=`\n\n**Allergies:** ${al}`; if(co) p+=`\n\n**Conditions:** ${co}`;
    p+=`\n\nCheck all:\n1. Drug-Drug Interactions (severity: Minor/Moderate/Serious/Contraindicated)\n2. Drug-Allergy Conflicts\n3. Drug-Condition Concerns\n4. Duplicate Therapy\n5. Overall Safety Assessment`;
    try { const res=await callAI([{ role:'user', content:p }]);
        panel.innerHTML=renderMarkdown(res)+'<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--sand-dark);font-size:0.76rem;color:var(--stone-400)">⚕️ Verify with pharmacist before changes.</div>'; updateApiStatus(true);
    } catch(e) { panel.innerHTML=`<p style="color:var(--red)"><strong>⚠️ Error:</strong> ${escapeHtml(e.message)}</p>`; }
    btn.disabled=false; btn.innerHTML='Check Interactions <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ═══════ API STATUS & KEY MODAL ═══════
function updateApiStatus(online) {
    const el=document.getElementById('apiStatus'); if(!el) return;
    const key=getApiKey(), prov=getProvider(key), label=prov==='claude'?'Claude':prov==='gemini'?'Gemini':'AI';
    if (online) { el.className='api-status'; el.innerHTML=`<span class="status-dot"></span><span>${label} Online</span>`; }
    else { el.className='api-status error'; el.innerHTML='<span class="status-dot"></span><span>Set API Key</span>'; }
}
function promptApiKey() { document.getElementById('keyModal').classList.add('active'); setTimeout(()=>document.getElementById('keyInput').focus(),100); }
function saveKeyFromModal() {
    const key=document.getElementById('keyInput').value.trim(), err=document.getElementById('keyError');
    if (!key) { err.style.display='block'; err.textContent='Please enter an API key'; return; }
    err.style.display='none'; setApiKey(key); document.getElementById('keyModal').classList.remove('active'); document.getElementById('keyInput').value='';
    updateApiStatus(true); checkApiHealth();
}
document.addEventListener('DOMContentLoaded', ()=>{ document.getElementById('keyInput')?.addEventListener('keydown',(e)=>{ if(e.key==='Enter') saveKeyFromModal(); }); });

async function checkApiHealth() {
    const key=getApiKey();
    if (!key) { updateApiStatus(false); document.getElementById('keyModal')?.classList.add('active'); return; }
    const prov=getProvider(key);
    try {
        let r;
        if (prov==='claude') { r=await fetch(CLAUDE_URL,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:CLAUDE_MODEL,max_tokens:10,messages:[{role:'user',content:'ping'}]})}); }
        else { r=await fetch(geminiUrl(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'ping'}]}],generationConfig:{maxOutputTokens:10}})}); }
        updateApiStatus(r.ok);
    } catch { updateApiStatus(false); }
}
setTimeout(checkApiHealth, 500);

// ── SCROLL ANIMATIONS ──
const observer=new IntersectionObserver((entries)=>{ entries.forEach(e=>{ if(e.isIntersecting){e.target.style.opacity='1';e.target.style.transform='translateY(0)';} }); },{threshold:0.1,rootMargin:'0px 0px -30px 0px'});
document.querySelectorAll('.cap-card,.sec-card,.flow-step').forEach(el=>{ el.style.opacity='0'; el.style.transform='translateY(14px)'; el.style.transition='opacity 0.5s ease, transform 0.5s ease'; observer.observe(el); });
