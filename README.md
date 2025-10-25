# MailBot - AI-Powered Gmail Assistant

MailBot is a Chrome extension that uses Gemini Nano (Chrome's built-in on-device AI) to help you draft contextual email replies in Gmail completely safe and secure.

## Features

- 🤖 **AI-Powered Replies**: Generate contextual email replies using Gemini Nano
- 📝 **Intent-Guided**: Tell the AI what you want to say, and it crafts the perfect email
- 🎨 **Tone Selection**: Choose from Neutral, Friendly, Formal, or Concise tones
- 🖱️ **Draggable Button**: Position the MailBot button anywhere on your screen
- 🔒 **100% Private**: All AI processing happens on-device, no data leaves your computer

## Requirements

**Important**: This extension requires Chrome's built-in Gemini Nano AI model.

### Prerequisites

1. **Chrome Browser** (latest stable version)
   - Make sure Chrome is fully updated
   - Go to `chrome://settings/help` to check for updates
   - Download: https://www.google.com/chrome/

2. **Enable Developer Mode**:
   - Go to `chrome://extensions`
   - Toggle **"Developer mode"** on (top right corner)

3. **Enable Optimization Guide Flag**:
   - Go to `chrome://flags`
   - Search for "optimization guide" or "Enables optimization guide on device"
   - Set **"Enables optimization guide on device"** to `Enabled BypassPerfRequirement`

4. **Enable All Gemini Nano Flags**:
   - Still in `chrome://flags`
   - Search for "gemini" or "nano" and enable ALL the following flags:
   
   | Flag | Setting |
   |------|--------|
   | **Prompt API for Gemini Nano** | `Enabled` |
   | **Prompt API for Gemini Nano with Multimodal Input** | `Enabled` |
   | **Summarization API for Gemini Nano** | `Enabled Multilingual` |
   | **Writer API for Gemini Nano** | `Enabled Multilingual` |
   | **Rewriter API for Gemini Nano** | `Enabled Multilingual` |
   | **Proofreader API for Gemini Nano** | `Enabled` |
   
   - Click **"Relaunch"** to restart Chrome

5. **Download the AI Model**:
   - Go to `chrome://components`
   - Find **"Optimization Guide On Device Model"**
   - Click **"Check for update"**
   - Wait for the model to download (may take 5-10 minutes)
   - The version should show something like: `2025.8.8.1141`

6. **Verify Model is Ready**:
   - Go to `chrome://on-device-internals/`
   - Click **"Model Status"** tab
   - Scroll down and wait until these show **"Ready"** status:
     - `OPTIMIZATION_TARGET_LANGUAGE_DETECTION`
     - `OPTIMIZATION_TARGET_TEXT_SAFETY`
   - ⚠️ **Important**: Do not proceed until both show "Ready"

## Installation

1. **Download MailBot**:
   ```bash
   git clone https://github.com/vibecodersph/Mail-Bot
   cd Mail-Bot
   ```
   Or download and extract the ZIP from GitHub

2. **Load the Extension**:
   - Go to `chrome://extensions`
   - Make sure **"Developer mode"** is enabled (see Prerequisites above)
   - Click **"Load unpacked"**
   - Select the `Mail-Bot` folder (the one containing `manifest.json`)
   - MailBot should now appear in your extensions list

3. **Configure Settings**:
   - Click the MailBot icon in Chrome toolbar
   - Enter your **Full Name** (for email signatures)
   - Set your preferred **Tone** (Neutral, Friendly, Formal, or Concise)
   - Set your preferred **Email Length** (Short, Average, or Long)
   - (Optional) Add custom greetings and closings
   - Click **"Save Settings"**

4. **Start Using MailBot**:
   - Navigate to Gmail (mail.google.com)
   - Open any email and click "Reply"
   - You should see the black **MailBot button** appear above the compose field
   - Click it and start generating emails!

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

1. Is Chrome fully updated to the latest stable version?
2. Are the Optimization Guide flag and ALL Gemini Nano flags enabled? (see Prerequisites above)
3. Did you restart Chrome after enabling flags?
4. Is the model downloaded and ready?
   - Go to `chrome://components`
   - Look for "Optimization Guide On Device Model"
   - Should show version like `2025.8.8.1141`
5. Are the model targets ready?
   - Go to `chrome://on-device-internals/`
   - Check that `OPTIMIZATION_TARGET_LANGUAGE_DETECTION` and `OPTIMIZATION_TARGET_TEXT_SAFETY` show "Ready"

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

- Requires Chrome with Gemini Nano enabled (see Prerequisites)
- Model download is ~1-2GB and requires waiting for "Ready" status
- Only works in Gmail (mail.google.com)
- Works with compose, reply, and forward windows

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
