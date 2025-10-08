# MailBot - AI-Powered Gmail Assistant

MailBot is a Chrome extension that uses Gemini Nano (Chrome's built-in on-device AI) to help you draft contextual email replies in Gmail.

## Features

- 🤖 **AI-Powered Replies**: Generate contextual email replies using Gemini Nano
- 📝 **Intent-Guided**: Tell the AI what you want to say, and it crafts the perfect email
- 🎨 **Tone Selection**: Choose from Neutral, Friendly, Formal, or Concise tones
- 🖱️ **Draggable Button**: Position the MailBot button anywhere on your screen
- 🔒 **100% Private**: All AI processing happens on-device, no data leaves your computer

## Requirements

**Important**: This extension requires Chrome's built-in Gemini Nano AI model.

### Prerequisites

1. **Chrome Canary or Chrome Dev** (version 127 or higher)
   - Download: https://www.google.com/chrome/canary/
   - Or: https://www.google.com/chrome/dev/

2. **Enable AI Features**:
   
   **Step 1:** Enable the Optimization Guide
   - Go to `chrome://flags/#optimization-guide-on-device-model`
   - Set to **"Enabled BypassPerfRequirement"**
   
   **Step 2:** Enable Prompt API
   - Go to `chrome://flags/#prompt-api-for-gemini-nano`
   - Set to **"Enabled"**
   
   **Step 3:** Restart Chrome
   
   **Step 4:** Download the AI Model
   - Go to `chrome://components`
   - Find "Optimization Guide On Device Model"
   - Click **"Check for update"**
   - Wait for the model to download (may take 5-10 minutes)
   - The version should show a number (e.g., 2024.10.7.1234)

3. **Verify AI is Working**:
   - Open DevTools (F12) in any tab
   - In the Console, type: `await ai.languageModel.capabilities()`
   - You should see: `{ available: "readily" }`
   - If you see `"after-download"`, wait for the model to finish downloading

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/mail-bot.git
   cd mail-bot
   ```

2. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `mail-bot` folder

3. Navigate to Gmail and start using MailBot!

## Usage

1. **Open Gmail** and click on an email to reply
2. **Click "Reply"** to open the inline compose box
3. **Click the "MailBot" button** (black pill button above the compose area)
4. **Enter your intent** (what you want to say)
5. **Select a tone** (Neutral, Friendly, Formal, or Concise)
6. **Click "Generate Reply"** or press Ctrl/Cmd + Enter
7. **Review and send** the generated email!

### Tips

- **Drag the button**: Click and drag the MailBot button to reposition it
- **Be specific**: The more specific your intent, the better the AI response
- **Edit as needed**: The AI generates a draft - feel free to edit before sending

## Troubleshooting

### "Gemini Nano is not available"

**Check the following:**

1. Are you using Chrome Canary/Dev 127+?
2. Are both flags enabled? (see Requirements above)
3. Did you restart Chrome after enabling flags?
4. Is the model downloaded?
   - Go to `chrome://components`
   - Look for "Optimization Guide On Device Model"
   - Should show a version number and status

### "Model is downloading"

- Wait 5-10 minutes for the download to complete
- Check progress at `chrome://components`
- Try again once the download finishes

### Button not appearing

1. Refresh Gmail (Ctrl+R)
2. Reload the extension:
   - Go to `chrome://extensions`
   - Click the refresh icon on MailBot
   - Refresh Gmail again

### "Extension context is invalid"

1. Go to `chrome://extensions`
2. Click the refresh icon on MailBot
3. Refresh Gmail

## Development

### Project Structure

```
mail-bot/
├── manifest.json          # Extension manifest
├── background/
│   └── service_worker.js  # Background script with AI logic
├── content/
│   └── content.js         # Gmail integration and UI
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── assets/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### Key Functions

- `showIntentModal()` - Displays the intent input modal
- `generateWithAI()` - Calls Gemini Nano to generate replies
- `insertReplyText()` - Inserts generated text into Gmail compose field
- `attachMailBotButton()` - Injects the MailBot button with drag functionality

## Privacy & Security

- ✅ **100% On-Device**: All AI processing happens locally using Gemini Nano
- ✅ **No External Servers**: No data is sent to any external servers
- ✅ **No Data Collection**: We don't collect, store, or transmit any user data
- ✅ **Open Source**: Full source code is available for inspection

## Known Limitations

- Requires Chrome Canary/Dev with Gemini Nano enabled
- Model download is ~1-2GB
- Only works in Gmail (mail.google.com)
- Inline replies only (not pop-out compose windows yet)

## Roadmap

- [ ] Support for pop-out compose windows
- [ ] Custom templates
- [ ] Keyboard shortcuts
- [ ] Save favorite tone preferences
- [ ] Multi-language support
- [ ] Email thread summarization

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Credits

Built with ❤️ using Chrome's built-in Gemini Nano AI.

---

**Note**: This extension is experimental and requires Chrome's experimental AI features. For hackathon use only.
