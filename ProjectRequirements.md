# MailBot - Project Requirements & Technical Documentation

## 📋 Executive Summary

**MailBot** is a Chrome extension that revolutionizes email composition in Gmail by leveraging Google's Gemini Nano AI model to generate contextually-aware, personalized email responses directly in the browser—fully on-device, with no data leaving the user's machine.

**Version**: 0.1.0  
**Status**: Production-Ready MVP  
**License**: MIT  
**Repository**: https://github.com/gerdguerrero/Mail-Bot

---

## 🎯 Project Purpose

### Problem Statement
Email composition is time-consuming and often requires careful consideration of tone, context, and professional etiquette. Users frequently struggle with:
- Crafting appropriate responses to complex email threads
- Maintaining consistent tone across communications
- Following up on unanswered emails without being pushy
- Personalizing emails while staying efficient
- Addressing recipients correctly in multi-party conversations

### Solution
MailBot provides an intelligent AI assistant that:
- ✅ Analyzes entire email threads for context
- ✅ Generates personalized responses based on user intent
- ✅ Maintains proper sender/recipient identity (critical for avoiding confusion)
- ✅ Adapts tone and length to user preferences
- ✅ Uses preferred greetings and closings
- ✅ Operates entirely offline with on-device AI (privacy-first)
- ✅ Provides preview-before-send workflow for user control

---

## 🏗️ Technical Architecture

### Tech Stack

#### **Frontend**
- **Languages**: JavaScript (ES6+), HTML5, CSS3
- **Framework**: Vanilla JavaScript (no external dependencies)
- **Extension Platform**: Chrome Extension Manifest V3
- **UI Design**: Dark, minimalist, pill-shaped interface

#### **AI Integration**
- **AI Model**: Google Gemini Nano (Chrome's Built-in AI)
- **API**: Chrome's Prompt API (`window.ai.languageModel`)
- **Processing**: Fully on-device, zero cloud dependency
- **Model Requirements**: Chrome Dev/Canary 127+, ~22GB disk space

#### **Browser APIs Used**
- `chrome.storage.local` - User preferences persistence
- `chrome.runtime` - Extension lifecycle management
- `chrome.scripting` - Dynamic content script injection
- Content Scripts - Gmail DOM manipulation
- MutationObserver - Dynamic email compose box detection

#### **Development Tools**
- Git - Version control
- GitHub - Repository hosting
- VS Code - Primary development environment

---

## 🎨 User Interface Design

### Design Philosophy
**Dark, Sleek, Minimalist** - Inspired by modern SaaS tools with emphasis on:
- High contrast (solid black backgrounds, white text)
- Rounded pill shapes (16-20px border radius)
- Subtle shadows for depth (`0 4px 12px rgba(0,0,0,0.3)`)
- Smooth fade transitions (200ms)
- 80% opacity text for elegant hierarchy

### UI Components

#### 1. **Collapsed Pill Button**
- **Appearance**: Compact black pill with "MAILBOT" text
- **Location**: Floats above Gmail compose field
- **Interaction**: Click to expand, drag to reposition
- **Styling**:
  ```
  Background: #000000 (solid black)
  Text: rgba(255,255,255,0.8) (dimmed white)
  Border Radius: 16px
  Shadow: 0 4px 12px rgba(0,0,0,0.3)
  Font Size: 16px
  ```

#### 2. **Expanded Panel**
- **Layout**: Horizontal bar with label, input, and action buttons
- **Elements**:
  - Label: "What do you want to say?" (80% opacity)
  - Input field: Dark pill-shaped text box
  - Generate button: White pill with black text
  - Insert button: White pill with black text
  - Collapse button: Circular chevron icon
- **Draggable**: Can be repositioned anywhere on screen
- **Persistent Position**: Maintains position while typing

#### 3. **Preview Container**
- **Position**: Appears 8px below expanded panel
- **Purpose**: Shows generated email for review/editing
- **Features**:
  - Editable content (contenteditable)
  - Regenerate button for new attempts
  - Follows expanded panel when dragged
- **Fade-in Animation**: 200ms opacity transition

#### 4. **Settings Popup**
- **Design**: Matches on-page UI aesthetic
- **Background**: Solid black (#111111)
- **Sections**:
  - Personal Information (Full Name)
  - Email Preferences (Tone, Length)
  - Common Phrases (Greetings, Closings)
- **Input Fields**: Rounded pills (20px radius)
- **Save Button**: High-contrast white pill

---

## ⚙️ Core Features & Functionality

### 1. **Intelligent Context Analysis**
```javascript
Features:
- Extracts entire email thread with sender/recipient metadata
- Analyzes conversation state (new message, reply, follow-up)
- Identifies last sender and determines appropriate recipient
- Detects user's email from Gmail profile (4 fallback methods)
- Extracts display names from Gmail UI (not just email addresses)
```

**Conversation States Detected**:
- Conversation Starter (new email)
- Response (replying to someone)
- Follow-up (user sent last message, no response yet)
- Waiting for Response

### 2. **AI-Powered Generation**
```javascript
Process:
1. User enters intent ("Thank them for the update...")
2. System builds comprehensive prompt with:
   - Identity declaration (YOU vs THEM)
   - Conversation history
   - User preferences (tone, length, greetings, closings)
   - Situation analysis
3. Gemini Nano generates response
4. Validation system checks for identity confusion
5. Post-processing fixes signatures if needed
6. Preview shown for user review
```

**Prompt Engineering Highlights**:
- Explicit sender/recipient identity declaration
- First-person perspective enforcement
- Signature validation (prevents signing with recipient's name)
- Contextual tone adaptation
- Length control (short/average/long)
- Custom greeting/closing integration

### 3. **Identity Confusion Prevention** ⭐
**Critical Innovation**: Prevents AI from confusing sender and recipient

```javascript
Validation Checks:
✅ Ensures AI doesn't address the user (sender) in the email
✅ Prevents third-person references to sender
✅ Validates signature uses sender's name, not recipient's
✅ Confirms first-person perspective ("I", "my", "me")
✅ Checks for placeholder text removal

Retry Logic:
- Attempt 1: Standard prompt
- Attempt 2: Enhanced prompt with explicit warnings (if validation fails)
```

### 4. **Name Normalization**
Handles concatenated multi-word names:
```javascript
Examples:
"JosephMaria" → "Joseph Maria"
"MariaJose" → "Maria Jose"
"PeterBenjaminParker" → "Peter Benjamin Parker"
```

### 5. **User Preferences System**
**Storage**: `chrome.storage.local` (persistent)

**Settings**:
- **Full Name**: Used for email signatures
- **Default Tone**: Neutral, Friendly, Formal, Concise
- **Email Length**: Short (2-3 sentences), Average (4-6), Long (7-10)
- **Preferred Greetings**: Up to 3 custom greetings (comma-separated)
- **Preferred Closings**: Up to 3 custom closings (comma-separated)

### 6. **Preview-Before-Send Workflow**
```
User Flow:
1. Click MailBot → Expand panel
2. Enter intent → Click "Generate"
3. AI generates → Preview appears below
4. User reviews/edits preview (contenteditable)
5. Click "Insert" → Email inserted into Gmail compose field
6. User reviews again in Gmail → Sends manually
```

**Safety Net**: Two review steps prevent accidental sends

### 7. **Drag & Reposition**
- Collapsed button is draggable
- Expanded panel is draggable (from label or background)
- Preview follows expanded panel during drag
- Position persists until collapse/re-expand
- `userHasManuallyPositioned` flag prevents auto-repositioning

### 8. **Smooth Animations**
- **Fade In/Out**: 200ms opacity transitions
- **Expand/Collapse**: Seamless state changes
- **Preview Appearance**: Smooth fade-in after generation
- **Hover Effects**: Scale transforms on buttons (1.02x)

---

## 🔒 Privacy & Security

### Privacy-First Design
- ✅ **100% On-Device Processing**: No data sent to external servers
- ✅ **No Network Requests**: AI runs locally via Gemini Nano
- ✅ **No Data Collection**: Extension doesn't track or store user emails
- ✅ **Minimal Permissions**: Only `activeTab`, `storage`, `scripting`
- ✅ **Gmail-Only Access**: Restricted to `mail.google.com`

### Data Handling
```javascript
What Gets Stored:
- User preferences (name, tone, greetings, closings)
- Stored in: chrome.storage.local (local to browser)

What NEVER Leaves Device:
- Email content
- Email threads
- Generated drafts
- Conversation context
```

---

## 📂 Project Structure

```
Mail-Bot/
├── manifest.json              # Extension configuration (Manifest V3)
├── README.md                  # User-facing documentation
├── LICENSE                    # MIT License
├── changes.md                 # Development changelog
├── ProjectRequirements.md     # This document
│
├── assets/                    # Extension icons
│   ├── icon16.png            # 16x16 toolbar icon
│   ├── icon48.png            # 48x48 extension page icon
│   └── icon128.png           # 128x128 Chrome Web Store icon
│
├── background/
│   └── service_worker.js     # Background service worker
│
├── content/
│   └── content.js            # Main content script (1,800+ lines)
│       ├── User detection (email, display name)
│       ├── Thread context extraction
│       ├── Conversation state analysis
│       ├── AI generation & validation
│       ├── UI injection & styling
│       ├── Drag & drop logic
│       └── Preview system
│
├── popup/                     # Settings interface
│   ├── popup.html            # Settings form structure
│   ├── popup.css             # Dark minimalist styling
│   └── popup.js              # Settings persistence logic
│
└── options/                   # Options page (legacy)
    ├── options.html
    ├── options.css
    └── options.js
```

---

## 🚀 Installation & Setup

### Prerequisites
```
Browser: Chrome Dev/Canary 127+ or Chrome 128+
Disk Space: ~22GB (for Gemini Nano model)
OS: Windows, macOS, Linux
```

### Chrome Flags Configuration
```
Required Flags (chrome://flags):
1. "Prompt API for Gemini Nano" → Enabled
2. "Enables optimization guide on device" → Enabled BypassPerfRequirement

Model Download (chrome://components):
- Find "Optimization Guide On Device Model"
- Click "Check for update"
- Wait for download (component should show version number)
```

### Extension Installation
```bash
1. Clone repository:
   git clone https://github.com/gerdguerrero/Mail-Bot.git

2. Open Chrome → chrome://extensions/

3. Enable "Developer mode" (top-right toggle)

4. Click "Load unpacked"

5. Select Mail-Bot folder

6. Extension appears with MailBot icon
```

### Initial Configuration
```
1. Click MailBot icon in toolbar
2. Enter full name (e.g., "Peter Benjamin Parker")
3. Set default tone (Neutral, Friendly, Formal, Concise)
4. Set email length (Short, Average, Long)
5. (Optional) Add custom greetings/closings
6. Click "Save Settings"
```

---

## 🎓 User Guide

### Basic Usage

#### **Composing a New Email**
```
1. Open Gmail → Click "Compose"
2. MailBot button appears above compose field
3. Click button → Panel expands
4. Enter intent: "Introduce myself and ask about internship opportunities"
5. Click "Generate" → Wait for AI
6. Review preview → Edit if needed
7. Click "Insert" → Email appears in Gmail
8. Review again → Send
```

#### **Replying to an Email**
```
1. Open email thread → Click "Reply"
2. MailBot button appears
3. Click → Expand panel
4. Enter intent: "Thank them and answer their questions about the project"
5. Generate → Review → Insert → Send
```

#### **Following Up**
```
1. Open sent email (no response yet)
2. Click "Forward" or "Reply All"
3. MailBot detects this is a follow-up
4. Enter intent: "Politely check if they had a chance to review"
5. AI generates appropriate follow-up tone
```

### Advanced Features

#### **Custom Positioning**
- Drag collapsed button to preferred location
- Position persists while typing
- Resets when collapsed/re-expanded

#### **Preview Editing**
- Click inside preview box to edit generated text
- Changes are preserved when clicking "Insert"
- Useful for quick tweaks without regenerating

#### **Regeneration**
- Click "Regenerate" button in preview header
- Generates new version with same intent
- Useful if first attempt isn't quite right

#### **Visual Feedback**
- Red border on input if empty when clicking Generate
- Red border on input if clicking Insert before generating
- Loading state during AI generation
- Fade animations for smooth transitions

---

## 🛠️ Technical Implementation Details

### Key Algorithms

#### 1. **User Email Detection**
```javascript
Priority Order:
1. Gmail profile button (gb_d element)
   - Most reliable, always current user
2. Account switcher links (gb_za)
   - Backup for multi-account users
3. Account dropdown (aria-label with "Google Account")
   - Works in most Gmail views
4. Fallback alert if none found
```

#### 2. **Display Name Extraction**
```javascript
Methods:
1. Profile button aria-label parsing
2. Gmail settings elements (gb_yb, gb_Ib)
3. Account menu data attributes
4. Compose "From" field parsing
5. Fallback: Capitalize email username

Normalization:
- Splits concatenated names (MariaJose → Maria Jose)
- Preserves single-word names
- Handles acronyms (JOHNSmith → JOHN Smith)
```

#### 3. **Recipient Detection**
```javascript
Logic:
- If last sender was user → Reply to last recipient (user.to)
- If last sender was other → Reply to that sender (other.from)
- Extracts display names from Gmail UI (not just emails)
- Normalizes recipient names same as user names
```

#### 4. **Conversation State Analysis**
```javascript
States:
- conversationStarter: Thread length = 1 AND user sent it
- isFollowUp: User sent last 2 messages consecutively
- respondingTo: Other party sent last message
- waitingForResponse: User sent last, no reply yet

Uses:
- Influences prompt construction
- Determines appropriate tone
- Affects AI's approach to generation
```

#### 5. **Validation System**
```javascript
Checks (in order):
1. AI addressing user instead of recipient
2. AI using third-person for user (should be "I")
3. First-person perspective present
4. Intent keyword matching
5. Placeholder text removal
6. Signature correctness (not recipient's name)
7. Subject line in body (shouldn't be there)

Actions:
- Warnings: Logged, user informed
- Errors: Retry with enhanced prompt OR user confirmation
```

#### 6. **Drag & Drop Logic**
```javascript
States Tracked:
- isDragging: Boolean for active drag
- customPosition: {x, y} for dragged location
- dragOffset: {x, y} for grab point
- userHasManuallyPositioned: Flag to prevent auto-reposition

Events:
- onMouseDown: Start drag, calculate offset
- onMouseMove: Update position, reposition preview
- onMouseUp: End drag, detect click vs drag (< 5px = click)

Position Retention:
- Persists during typing/scrolling
- Resets on collapse/expand cycle
```

### Performance Optimizations

```javascript
1. MutationObserver throttling:
   - Only scans for new compose boxes
   - Disconnects when not needed

2. requestAnimationFrame for positioning:
   - Smooth 60fps updates
   - Batches layout calculations

3. Debounced scroll/resize handlers:
   - Only repositions when necessary
   - Skips if custom positioned

4. Lazy AI session creation:
   - Only creates session when generating
   - Destroys after use to free memory

5. Content length limits:
   - Email thread content capped at 1000 chars per message
   - Prevents prompt overflow
```

---

## 🧪 Testing & Quality Assurance

### Test Scenarios

#### **Identity Confusion Prevention** ⭐
```
Test Cases:
✅ Replying to Kriza Patriz Mutia (ksmutia@up.edu.ph)
✅ Email should NOT say "Dear Joseph" (that's the user)
✅ Email SHOULD say "Hi Kriza" or general greeting
✅ Signature SHOULD be "Joseph Miguel Guerrero" (user)
✅ Signature SHOULD NOT be "Kriza Patriz Mutia" (recipient)

Validation:
- Multiple regenerations should maintain correct identity
- Follow-ups should preserve sender identity
- Multi-party emails should address correct recipient
```

#### **Name Normalization**
```
Test Cases:
Input: "MariaJose Rodriguez"
Expected: "Maria Jose Rodriguez"

Input: "JosephMaria"
Expected: "Joseph Maria"

Input: "PeterParker"
Expected: "Peter Parker"

Single names preserved:
Input: "Joseph"
Expected: "Joseph"
```

#### **Drag & Reposition**
```
Test Cases:
✅ Drag collapsed button → Stays in place
✅ Expand panel → Panel appears at button location
✅ Drag expanded panel → Stays while typing
✅ Type long text (wrapping) → Panel doesn't snap back
✅ Preview follows panel during drag
✅ Collapse/expand → Position resets
```

#### **Preview Workflow**
```
Test Cases:
✅ Generate → Preview appears below panel
✅ Preview is editable (contenteditable)
✅ Edits persist when clicking Insert
✅ Regenerate creates new version
✅ Insert without generate → Red border + error message
✅ Preview fades in smoothly (200ms)
```

#### **Settings Persistence**
```
Test Cases:
✅ Save settings → Reload extension → Settings retained
✅ Change name → Generate email → New name in signature
✅ Change greetings → Generate → Uses custom greetings
✅ Change closings → Generate → Uses custom closings
✅ Change tone → Generate → Tone reflects choice
✅ Change length → Generate → Length matches setting
```

### Edge Cases Handled

```javascript
1. No user email detected:
   → Alert shown, requests user login verification

2. Empty intent field:
   → Red border, placeholder changes, no generation

3. Insert before generate:
   → Red border on input, user prompted

4. Recipient email same as user email:
   → Validation catches, retries with explicit instructions

5. Very long email threads:
   → Content truncated to 1000 chars per message

6. Compose field removed (tab closed):
   → Container cleaned up, observers disconnected

7. Multiple compose boxes:
   → Each gets unique MailBot button with unique ID

8. Gmail updates (DOM changes):
   → MutationObserver detects, re-injects buttons

9. Concatenated multi-word names:
   → Normalization splits them correctly

10. No Gemini Nano model:
    → Clear error message with setup instructions
```

---

## 📊 Key Metrics & Achievements

### Code Statistics
```
Total Lines: 3,400+
Main Content Script: 1,800+ lines
Languages: JavaScript (95%), HTML (3%), CSS (2%)
Files: 14
Commits: 2+ (initial + license)
```

### Features Implemented
```
✅ On-device AI integration (Gemini Nano)
✅ Identity confusion prevention system
✅ Name normalization algorithm
✅ Drag & drop repositioning
✅ Preview-before-send workflow
✅ Settings persistence
✅ Conversation state analysis
✅ Validation & retry logic
✅ Smooth fade animations
✅ Dark minimalist UI design
✅ Custom greetings/closings support
✅ Tone adaptation (4 modes)
✅ Length control (3 levels)
```

### Innovation Highlights
```
🌟 First-in-class identity confusion prevention
🌟 Truly private (100% on-device AI)
🌟 Context-aware follow-up detection
🌟 Dynamic name normalization
🌟 Persistent drag positioning with typing lock
🌟 Two-stage review workflow
```

---

## 🎯 Use Cases

### Professional Scenarios

1. **Job Applications**
   - Generate personalized cover letter emails
   - Follow up on application status
   - Thank recruiters for interviews

2. **Client Communication**
   - Respond to client inquiries with appropriate tone
   - Send project updates professionally
   - Request additional information politely

3. **Team Collaboration**
   - Follow up on pending tasks
   - Share project updates with team
   - Request feedback on deliverables

4. **Networking**
   - Introduce yourself to industry contacts
   - Thank people for connections/introductions
   - Request informational interviews

### Academic Scenarios

1. **Professor Communication**
   - Request extensions formally
   - Ask questions about assignments
   - Schedule office hours

2. **Group Projects**
   - Coordinate with team members
   - Share progress updates
   - Resolve conflicts diplomatically

3. **Research Inquiries**
   - Contact researchers for collaboration
   - Request access to resources
   - Follow up on unanswered queries

### Personal Scenarios

1. **Event Planning**
   - Send invitations with appropriate tone
   - Follow up with attendees
   - Thank hosts/organizers

2. **Complaint Handling**
   - Write formal complaints professionally
   - Request refunds or corrections
   - Escalate issues appropriately

---

## 🔮 Future Enhancements (Roadmap)

### Short-Term (Next Release)
```
🔲 Keyboard shortcuts (Ctrl+Shift+M to open MailBot)
🔲 Multiple tone presets saved per contact
🔲 Template system for common email types
🔲 Undo/Redo for preview edits
🔲 Export/Import settings
🔲 Dark/Light theme toggle
```

### Medium-Term
```
🔲 Multi-language support (Spanish, French, etc.)
🔲 Smart suggestions based on email history
🔲 Integration with Gmail's "Smart Compose"
🔲 Scheduling/delay send integration
🔲 Email categorization (formal, casual, urgent)
🔲 Attachment reminder detection
```

### Long-Term
```
🔲 Support for other email providers (Outlook, Yahoo)
🔲 Mobile app version
🔲 Team/Organization settings sync
🔲 Analytics dashboard (emails sent, time saved)
🔲 Custom AI model fine-tuning
🔲 Voice input for intent description
```

---

## 🤝 Contributing

### Development Setup
```bash
1. Fork repository on GitHub
2. Clone your fork: git clone https://github.com/YOUR_USERNAME/Mail-Bot.git
3. Create feature branch: git checkout -b feature/your-feature-name
4. Make changes and test thoroughly
5. Commit: git commit -m "Add: Description of feature"
6. Push: git push origin feature/your-feature-name
7. Create Pull Request on GitHub
```

### Code Style Guidelines
```javascript
- Use ES6+ features (const, let, arrow functions)
- Inline styles for extension compatibility
- Comments for complex logic
- Console logs with [MailBot] prefix
- Descriptive variable/function names
- 2-space indentation
```

### Testing Checklist
```
Before submitting PR:
✅ Test on fresh Gmail account
✅ Test with multiple compose boxes
✅ Verify identity confusion prevention
✅ Test drag & drop functionality
✅ Verify settings persistence
✅ Check console for errors
✅ Test all edge cases
✅ Update documentation if needed
```

---

## 📞 Support & Contact

### Documentation
- **README**: User-facing guide
- **This Document**: Technical specification
- **changes.md**: Development changelog

### Issues & Bug Reports
GitHub Issues: https://github.com/gerdguerrero/Mail-Bot/issues

**Template**:
```
Title: [BUG] Brief description
Environment:
- Chrome Version: 
- OS:
- Extension Version:

Steps to Reproduce:
1. 
2. 
3. 

Expected Behavior:

Actual Behavior:

Screenshots (if applicable):
```

### Feature Requests
GitHub Issues with label `enhancement`

**Template**:
```
Title: [FEATURE] Brief description
Problem:
Proposed Solution:
Use Case:
Priority: Low/Medium/High
```

---

## 📜 License & Attribution

### License
MIT License - See [LICENSE](LICENSE) file

Copyright (c) 2025 Joseph Miguel Guerrero (gerdguerrero)

### Third-Party Technologies
- **Google Gemini Nano**: Google's on-device AI model
- **Chrome Extensions API**: Google Chrome browser platform
- **Gmail**: Google's email service

### Acknowledgments
```
Inspiration:
- Google's Prompt API documentation
- Modern SaaS UI/UX principles
- Privacy-first AI movement

Special Thanks:
- Chrome team for Gemini Nano integration
- Open-source community for best practices
```

---

## 🎉 Project Success Criteria

### MVP Goals (✅ Achieved)
```
✅ Fully functional AI email generation
✅ Gmail integration (compose, reply, follow-up)
✅ User preferences system
✅ Preview workflow
✅ Identity confusion prevention
✅ Dark minimalist UI
✅ On-device processing (privacy)
✅ Drag & reposition
✅ Smooth animations
✅ Name normalization
✅ Comprehensive documentation
```

### Quality Metrics (✅ Met)
```
✅ Zero external dependencies
✅ No network requests (100% offline)
✅ Minimal permissions (3 only)
✅ Clean, maintainable code
✅ Comprehensive error handling
✅ User-friendly error messages
✅ Consistent design language
✅ MIT licensed for open-source
```

### User Experience Goals (✅ Achieved)
```
✅ Intuitive interface (no learning curve)
✅ Fast generation (< 3 seconds typical)
✅ Non-intrusive UI (doesn't block Gmail)
✅ Smooth animations (< 200ms)
✅ Reliable identity handling (no confusion)
✅ Flexible positioning (drag anywhere)
✅ Preview-before-send safety
✅ Customizable preferences
```

---

## 📈 Conclusion

**MailBot** represents a significant achievement in privacy-preserving AI assistants for productivity. By leveraging Chrome's built-in Gemini Nano model, it provides powerful email generation capabilities without compromising user privacy—a critical differentiator in today's data-conscious world.

The project successfully demonstrates:
- **Technical Innovation**: Identity confusion prevention, name normalization, context-aware generation
- **User-Centric Design**: Preview workflow, drag & drop, smooth animations, dark aesthetic
- **Privacy Excellence**: 100% on-device processing, zero data collection
- **Production Quality**: Comprehensive error handling, validation, edge case management

This document serves as both a technical specification and a showcase of the project's depth, making it ideal for presentations, portfolio demonstrations, and technical discussions.

---

**Built with ❤️ by Joseph Miguel Guerrero**  
**For questions or collaboration: https://github.com/gerdguerrero/Mail-Bot**

---

*Last Updated: October 8, 2025*  
*Document Version: 1.0*  
*Project Version: 0.1.0*
