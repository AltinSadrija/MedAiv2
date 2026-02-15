# MedAI v2 — Intelligent Medical AI Assistant

Fully functional AI-powered medical assistant using Claude API.

## Features

- **AI Chat** — Natural conversation with streaming, image upload, conversation history
- **Image Analysis** — X-rays, CT, MRI, pathology with drag-and-drop
- **Report Reader** — Lab results, blood panels with plain-language explanations
- **Drug Checker** — Medication interactions, allergies, conditions cross-reference
- **Responsive** — Works on desktop, tablet, and mobile

## Setup

1. Clone the repo
2. Create `config.js` in root:
```js
const MEDAI_CONFIG = {
    key: 'your-anthropic-api-key-here'
};
```
3. Open `index.html` in a browser

Or just open the site and click "Set API Key" to enter your key at runtime.

## Tech

Pure HTML/CSS/JS — no build step. Claude API with streaming. Warm clinical design.

© 2026 MedAI
