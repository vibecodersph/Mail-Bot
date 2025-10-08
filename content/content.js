// content/content.js
// Detects Gmail compose/reply boxes and injects the MailBot button
// Handles button click and AI generation directly in content script

// Check if extension context is valid
if (!chrome || !chrome.runtime) {
  console.error('[MailBot] Extension context is invalid. Content script may have been orphaned.');
}

console.log('[MailBot] Content script loaded');

/**
 * Detect current Gmail user's email address
 * Tries multiple methods to extract the logged-in user's email
 * @returns {string|null} User's email address or null if not found
 */
function getCurrentUserEmail() {
  console.log('[MailBot] 🔍 Starting user email detection...');
  
  // Method 1: From Gmail header profile button (most reliable - the logged-in user's profile)
  const gbProfileEmail = document.querySelector('a[aria-label*="Google Account"][aria-label*="@"]');
  if (gbProfileEmail) {
    const ariaLabel = gbProfileEmail.getAttribute('aria-label');
    const match = ariaLabel?.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (match) {
      console.log('[MailBot] ✓ User email found via profile button (MOST RELIABLE):', match[0]);
      return match[0];
    }
  }
  
  // Method 2: From the user profile image/button in top right (gb_* classes)
  const gbElements = document.querySelectorAll('.gb_d, .gb_Xa, .gb_b');
  for (const el of gbElements) {
    const email = el.getAttribute('aria-label')?.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0];
    if (email) {
      console.log('[MailBot] ✓ User email found via Gmail header:', email);
      return email;
    }
  }
  
  // Method 3: From account switcher dropdown (more reliable than thread emails)
  const accountInfo = document.querySelector('div[aria-label*="Google Account"]');
  if (accountInfo) {
    const emailText = accountInfo.textContent.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailText) {
      console.log('[MailBot] ✓ User email found via account info:', emailText[0]);
      return emailText[0];
    }
  }
  
  // Method 4: AVOID [email] attribute as it can be from email threads (UNRELIABLE)
  // Skip this method as it picks up recipient emails from the thread
  
  console.warn('[MailBot] ⚠️ Could not detect user email address reliably');
  
  // Last resort: Ask user to check they're logged into Gmail
  alert('⚠️ MailBot could not detect your Gmail email address.\n\nPlease ensure you are logged into Gmail and try again.');
  return null;
}

/**
 * Get current user's display name for signatures
 * @returns {string} User's display name or email username
 */
function getUserDisplayName(userEmail) {
  console.log('[MailBot] 🔍 Detecting user display name...');
  
  // Method 1: From Gmail profile button aria-label (e.g., "Google Account: John Doe (john@gmail.com)")
  const profileButton = document.querySelector('a[aria-label*="Google Account"][aria-label*="@"]');
  if (profileButton) {
    const ariaLabel = profileButton.getAttribute('aria-label');
    // Extract name from "Google Account: John Doe (email@gmail.com)"
    const nameMatch = ariaLabel?.match(/Google Account:\s*([^(]+)/);
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      if (name && !name.includes('@') && name.length > 0 && name.length < 50) {
        console.log('[MailBot] ✓ Display name from profile button:', name);
        return name;
      }
    }
  }
  
  // Method 2: From Gmail settings/profile elements
  const nameElements = document.querySelectorAll('.gb_yb, .gb_Ib, .gb_lb');
  for (const el of nameElements) {
    const name = el.textContent?.trim();
    if (name && !name.includes('@') && name.length > 0 && name.length < 50 && !name.includes('Gmail')) {
      console.log('[MailBot] ✓ Display name from Gmail UI:', name);
      return name;
    }
  }
  
  // Method 3: From account menu when clicked (check title/data attributes)
  const accountTitle = document.querySelector('[data-name], .gb_Fb, [title*="@"]');
  if (accountTitle) {
    const name = accountTitle.getAttribute('data-name') || accountTitle.getAttribute('title');
    if (name && !name.includes('@') && name.length > 0 && name.length < 50) {
      console.log('[MailBot] ✓ Display name from account element:', name);
      return name;
    }
  }
  
  // Method 4: Try to get from compose "From" field which sometimes shows "Name <email>"
  const fromField = document.querySelector('input[name="from"], select[name="from"]');
  if (fromField) {
    const fromValue = fromField.value || fromField.textContent;
    const nameEmailMatch = fromValue?.match(/^([^<]+)<.*@/);
    if (nameEmailMatch && nameEmailMatch[1]) {
      const name = nameEmailMatch[1].trim();
      if (name.length > 0 && name.length < 50) {
        console.log('[MailBot] ✓ Display name from compose field:', name);
        return name;
      }
    }
  }
  
  // Method 5: Fallback - capitalize email username to make it look more like a name
  const username = userEmail ? userEmail.split('@')[0] : 'User';
  // Convert "gerdguerrero" to "Gerd Guerrero" if it looks like firstname+lastname
  const capitalized = username
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase
    .replace(/([a-z]{3,})([a-z]{3,})/i, '$1 $2') // Try to split concatenated names
    .split(/[._-]/) // Split by separators
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  console.log('[MailBot] ⚠️ Using formatted username as display name:', capitalized);
  return capitalized;
}

/**
 * Analyze conversation state to understand who's waiting for whom
 * @param {Array} emailThread - Array of email objects with from/to/content
 * @param {string} currentUserEmail - The logged-in user's email
 * @returns {Object} Conversation state analysis
 */
function analyzeConversationState(emailThread, currentUserEmail) {
  if (!emailThread || emailThread.length === 0) {
    return {
      lastSenderWasUser: false,
      isFollowUp: false,
      waitingForResponse: false,
      respondingTo: null,
      conversationStarter: true,
      recipientEmail: null,
      recipientName: null,
      threadLength: 0
    };
  }
  
  const lastEmail = emailThread[emailThread.length - 1];
  const secondLastEmail = emailThread.length > 1 ? emailThread[emailThread.length - 2] : null;
  
  const lastSenderWasUser = lastEmail.isFromUser;
  const isFollowUp = lastSenderWasUser && secondLastEmail?.isFromUser;
  
  // Determine who should receive the reply and their display name
  let recipientEmail, recipientName;
  if (lastSenderWasUser) {
    // If user sent the last email, we're following up with the same recipient
    recipientEmail = lastEmail.to;
    recipientName = lastEmail.toName;
  } else {
    // If someone else sent the last email, reply to them
    recipientEmail = lastEmail.from;
    recipientName = lastEmail.fromName;
  }
  
  return {
    lastSenderWasUser,
    isFollowUp, // User is following up on their own email
    waitingForResponse: lastSenderWasUser, // If user sent last, they're waiting
    respondingTo: lastSenderWasUser ? null : lastEmail.from, // Who we're responding to
    conversationStarter: emailThread.length === 1 && lastSenderWasUser,
    recipientEmail,
    recipientName,
    threadLength: emailThread.length
  };
}

/**
 * Extract email thread context from the current page with enhanced metadata
 * @returns {Object} Thread context including subject, messages with sender/recipient info
 */
function extractThreadContext() {
  const currentUserEmail = getCurrentUserEmail();
  const subject = document.querySelector('h2.hP')?.innerText || 'No subject';
  
  // Extract email messages with sender and recipient information
  const messageElements = Array.from(document.querySelectorAll('.adn.ads'));
  const emails = messageElements.map(msgEl => {
    // Try to extract sender email and name from the message header
    const senderEl = msgEl.querySelector('.gD, .go, [email]');
    const senderEmail = senderEl?.getAttribute('email') || 
                       senderEl?.getAttribute('data-email') ||
                       senderEl?.textContent?.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] ||
                       'unknown@sender.com';
    
    // Extract sender display name (the text shown before the email)
    const senderNameEl = msgEl.querySelector('.gD');
    const senderName = senderNameEl?.getAttribute('name') || 
                      senderNameEl?.textContent?.trim() ||
                      senderEmail.split('@')[0];
    
    // Try to extract recipient email and name (usually in To: field)
    const recipientEl = msgEl.querySelector('[data-hovercard-id*="@"]');
    const recipientEmail = recipientEl?.getAttribute('data-hovercard-id') ||
                          'unknown@recipient.com';
    
    // Extract recipient display name
    const recipientName = recipientEl?.textContent?.trim() ||
                         recipientEl?.getAttribute('name') ||
                         recipientEmail.split('@')[0];
    
    const content = msgEl.innerText?.substring(0, 1000) || ''; // Limit to 1000 chars
    
    // Determine if this email is from or to the current user
    const isFromUser = currentUserEmail ? senderEmail === currentUserEmail : false;
    const isToUser = currentUserEmail ? recipientEmail === currentUserEmail : false;
    
    return {
      from: senderEmail,
      fromName: senderName,
      to: recipientEmail,
      toName: recipientName,
      content,
      isFromUser,
      isToUser
    };
  });
  
  // Analyze conversation state
  const conversationState = analyzeConversationState(emails, currentUserEmail);
  
  // Build full thread text with context markers
  const fullThread = emails.map((email, idx) => {
    const role = email.isFromUser ? '[YOU]' : '[THEM]';
    return `${role} From: ${email.from}\nTo: ${email.to}\n${email.content}`;
  }).join('\n\n---\n\n');
  
  console.log('[MailBot] Thread context extracted:', {
    subject,
    currentUserEmail,
    messageCount: emails.length,
    conversationState
  });
  
  return {
    subject,
    currentUserEmail,
    messageCount: emails.length,
    recentMessages: emails.slice(-3),
    fullThread,
    emails,
    conversationState
  };
}

/**
 * Validate generated email to ensure it's correct
 * @param {string} generatedEmail - The AI-generated email text
 * @param {string} currentUserEmail - Current user's email address
 * @param {string} recipientEmail - Recipient's email address
 * @param {string} userIntent - What the user wanted to say
 * @returns {Object} Validation result with isValid flag and issues array
 */
function validateGeneratedEmail(generatedEmail, currentUserEmail, recipientEmail, userIntent) {
  const issues = [];
  const userName = currentUserEmail?.split('@')[0]?.toLowerCase() || '';
  const recipientName = recipientEmail?.split('@')[0]?.toLowerCase() || '';
  const emailLower = generatedEmail.toLowerCase();
  
  // Check if AI is addressing the user instead of recipient
  if (userName && (
    emailLower.includes(`dear ${userName}`) ||
    emailLower.includes(`hi ${userName}`) ||
    emailLower.includes(`hello ${userName}`)
  )) {
    issues.push('ERROR: AI is addressing you instead of the recipient');
  }
  
  // Check if AI is writing about the user in third person (wrong perspective)
  if (userName && emailLower.includes(`${userName} will`) || emailLower.includes(`${userName} can`)) {
    issues.push('ERROR: AI is writing about you in third person - should use "I" not your name');
  }
  
  // Check if email contains first-person perspective (good sign)
  const hasFirstPerson = /\b(i|i'm|i'll|my|me)\b/i.test(generatedEmail);
  if (!hasFirstPerson && generatedEmail.length > 50) {
    issues.push('WARNING: Email may not be written from your perspective (missing "I", "my", etc.)');
  }
  
  // Check if intent matches content (basic keyword matching)
  const intent = userIntent.toLowerCase();
  
  if (intent.includes('follow up') || intent.includes('following up') || intent.includes('checking in')) {
    const hasFollowUpLanguage = 
      emailLower.includes('follow') || 
      emailLower.includes('checking in') ||
      emailLower.includes('wanted to circle back') ||
      emailLower.includes('touching base');
    
    if (!hasFollowUpLanguage) {
      issues.push('WARNING: Email may not clearly express follow-up intent');
    }
  }
  
  if (intent.includes('thank') || intent.includes('appreciate')) {
    const hasThanksLanguage = emailLower.includes('thank') || emailLower.includes('appreciate');
    if (!hasThanksLanguage) {
      issues.push('WARNING: Email may not express gratitude as intended');
    }
  }
  
  if (intent.includes('apolog') || intent.includes('sorry')) {
    const hasApologyLanguage = emailLower.includes('apolog') || emailLower.includes('sorry');
    if (!hasApologyLanguage) {
      issues.push('WARNING: Email may not express apology as intended');
    }
  }
  
  // Check for placeholder text that shouldn't be there
  if (emailLower.includes('[insert') || emailLower.includes('[your ') || emailLower.includes('[add ')) {
    issues.push('ERROR: Email contains placeholder text like [insert X]');
  }
  
  // Check if AI is signing with recipient's name instead of sender's name
  const emailLines = generatedEmail.trim().split('\n');
  const lastFewLines = emailLines.slice(-4).join('\n').toLowerCase();
  
  // Check for recipient name in signature area (last few lines)
  if (recipientName && lastFewLines.includes(recipientName.toLowerCase())) {
    // Common signature patterns
    const signaturePatterns = [
      `sincerely,\n${recipientName}`,
      `best,\n${recipientName}`,
      `regards,\n${recipientName}`,
      `sincerely, ${recipientName}`,
      `best, ${recipientName}`,
      `regards, ${recipientName}`,
      `thanks,\n${recipientName}`,
      `thank you,\n${recipientName}`,
      `\n${recipientName}`,
      ` ${recipientName}`
    ];
    
    const hasWrongSignature = signaturePatterns.some(pattern => 
      lastFewLines.includes(pattern.toLowerCase())
    );
    
    if (hasWrongSignature && !lastFewLines.includes(userName.toLowerCase())) {
      issues.push(`ERROR: Email is signed with recipient's name (${recipientName}) instead of yours (${userName})`);
    }
  }
  
  // Check if AI included subject line in email body
  if (emailLower.includes('subject:') || emailLower.includes('re:')) {
    issues.push('ERROR: Email contains subject line in body - subject lines should only be in the subject field');
  }
  
  const hasErrors = issues.some(i => i.startsWith('ERROR'));
  
  console.log('[MailBot] Validation result:', {
    isValid: !hasErrors,
    issueCount: issues.length,
    issues
  });
  
  return {
    isValid: !hasErrors,
    issues: issues
  };
}

/**
 * Build enhanced conversation history for AI prompt
 * @param {Array} emails - Array of email objects with metadata
 * @returns {string} Formatted conversation history
 */
function buildConversationHistory(emails) {
  if (!emails || emails.length === 0) {
    return 'No previous conversation available.';
  }
  
  return emails.map((email, index) => {
    const role = email.isFromUser ? 'YOU' : 'THEM';
    const timestamp = `Email ${index + 1}`;
    
    return `${timestamp}:
FROM: ${email.from}${email.isFromUser ? ' (YOU)' : ''}
TO: ${email.to}${email.isToUser ? ' (YOU)' : ''}
CONTENT:
${email.content}`;
  }).join('\n\n---\n\n');
}

/**
 * Normalize display name to handle concatenated multi-word names
 * E.g., "JosephMaria Guerrero" → "Joseph Maria Guerrero"
 * E.g., "MariaJose Rodriguez" → "Maria Jose Rodriguez"
 * @param {string} name - The name to normalize
 * @returns {string} Normalized name with proper spacing
 */
function normalizeDisplayName(name) {
  if (!name) return name;
  
  // If name already has proper spacing, return as-is
  if (name.includes(' ') && name.split(' ').every(part => part.length > 0)) {
    return name;
  }
  
  // Split concatenated names by detecting capital letters
  // "JosephMaria" → "Joseph Maria"
  // But preserve single-word names like "Joseph"
  const normalized = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Insert space before capitals
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // Handle acronyms like "JOHNSmith" → "JOHN Smith"
    .trim();
  
  console.log('[MailBot] Name normalized:', name, '→', normalized);
  return normalized;
}

/**
 * Fix incorrect signature in generated email (fallback post-processing)
 * @param {string} generatedEmail - The generated email text
 * @param {string} userDisplayName - User's correct display name
 * @param {string} recipientEmail - Recipient's email
 * @returns {string} Email with corrected signature
 */
function fixSignature(generatedEmail, userDisplayName, recipientEmail) {
  const recipientName = recipientEmail.split('@')[0];
  const lines = generatedEmail.split('\n');
  
  // Normalize the user's display name to handle concatenated names
  const normalizedName = normalizeDisplayName(userDisplayName);
  
  // Check last 4 lines for incorrect signature
  let fixedLines = false;
  for (let i = Math.max(0, lines.length - 4); i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    const recipientNameLower = recipientName.toLowerCase();
    
    // If line contains recipient name but not as part of a longer word
    if (lineLower.includes(recipientNameLower)) {
      const wordBoundaryRegex = new RegExp(`\\b${recipientName}\\b`, 'gi');
      if (wordBoundaryRegex.test(lines[i])) {
        console.warn('[MailBot] ⚠️ Fixing incorrect signature:', lines[i]);
        lines[i] = lines[i].replace(wordBoundaryRegex, normalizedName);
        fixedLines = true;
      }
    }
    
    // Also check if the line contains the user's name without proper spacing
    // E.g., "JosephMaria" should be replaced with "Joseph Maria"
    if (!fixedLines && userDisplayName !== normalizedName) {
      // Check if this line might be a signature with concatenated name
      const trimmedLine = lines[i].trim();
      if (trimmedLine === userDisplayName || trimmedLine.includes(userDisplayName)) {
        console.warn('[MailBot] ⚠️ Fixing concatenated name in signature:', lines[i]);
        lines[i] = lines[i].replace(userDisplayName, normalizedName);
        fixedLines = true;
      }
    }
  }
  
  if (fixedLines) {
    console.log('[MailBot] ✓ Signature corrected to:', normalizedName);
  }
  
  return lines.join('\n');
}

/**
 * Generate reply using Gemini Nano with enhanced context and validation
 * @param {Object} threadContext - Enhanced thread context with conversation state
 * @param {string} userIntent - What the user wants to say
 * @param {string} tone - Desired tone (neutral, friendly, formal, concise)
 * @param {number} attemptNumber - Retry attempt number (for regeneration)
 * @returns {Promise<Object>} Result with generated text and validation info
 */
async function generateWithAI(threadContext, userIntent, tone, attemptNumber = 1) {
  console.log('[MailBot] Checking AI availability in content script...');
  console.log('[MailBot] Attempt:', attemptNumber);
  
  // Check if AI API is available
  if (!('LanguageModel' in self)) {
    throw new Error('Gemini Nano API is not available. Please ensure:\n\n1. Chrome Canary/Dev 127+\n2. Flags are enabled\n3. Model is downloaded from chrome://components\n\nCurrent status: LanguageModel API not found');
  }
  
  console.log('[MailBot] Creating AI session...');
  
  const { conversationState } = threadContext;
  const userEmail = threadContext.currentUserEmail || 'you';
  const recipientEmail = conversationState.recipientEmail || 'the recipient';
  const userName = userEmail.split('@')[0];
  
  // Get recipient's display name from conversation state (from Gmail UI)
  let recipientName = conversationState.recipientName || recipientEmail.split('@')[0];
  
  // Normalize recipient name to handle concatenated multi-word names (e.g., "MariaJose" -> "Maria Jose")
  recipientName = normalizeDisplayName(recipientName);
  
  // Load user settings from storage
  const settings = await chrome.storage.local.get([
    'fullName',
    'preferredGreetings',
    'preferredClosings',
    'emailLength'
  ]);
  
  // Use full name from settings, or fall back to detection
  let userDisplayName = settings.fullName || getUserDisplayName(userEmail);
  
  // Normalize the display name to handle concatenated multi-word names
  userDisplayName = normalizeDisplayName(userDisplayName);
  
  // Parse preferred greetings and closings
  const greetings = settings.preferredGreetings 
    ? settings.preferredGreetings.split(',').map(g => g.trim()).filter(g => g)
    : ['Hi', 'Hello', 'Good day'];
  
  const closings = settings.preferredClosings
    ? settings.preferredClosings.split(',').map(c => c.trim()).filter(c => c)
    : ['Sincerely', 'Best regards', 'Kind regards'];
  
  const emailLength = settings.emailLength || 'average';
  
  // More explicit system prompt for retries
  const systemPrompt = attemptNumber === 1 
    ? `You are MailBot, an AI email writing assistant. You help users compose professional emails.

CRITICAL: You write emails ON BEHALF OF the user. The user is the SENDER, not the RECIPIENT.`
    : `You are MailBot, an AI email writing assistant.

CRITICAL IDENTITY RULES - READ CAREFULLY:
1. You are writing AS ${userEmail} (the sender)
2. You are writing TO ${recipientEmail} (the recipient)
3. NEVER address ${userName} in the email - that's the sender (you)
4. Address ${recipientName} or use general greetings
5. Use first-person perspective: "I", "my", "me" when referring to ${userEmail}
6. NEVER use third-person when referring to ${userEmail}

This is attempt ${attemptNumber} - previous attempt had identity confusion. Be extra careful.`;
  
  const session = await LanguageModel.create({ systemPrompt });
  console.log('[MailBot] AI session created successfully');
  
  // Build tone instructions
  const toneInstructions = {
    neutral: 'professional and balanced',
    friendly: 'warm, conversational, and approachable',
    formal: 'polished, respectful, and business-appropriate',
    concise: 'brief and to-the-point'
  };
  
  // Build length instructions
  const lengthInstructions = {
    short: '2-3 sentences maximum - brief and concise',
    average: '4-6 sentences - balanced detail',
    long: '7-10 sentences - detailed and thorough'
  };
  
  // Build situation analysis
  let situationAnalysis = '';
  if (conversationState.conversationStarter) {
    situationAnalysis = `This is the START of a new conversation. You are initiating contact with ${recipientEmail}.`;
  } else if (conversationState.isFollowUp) {
    situationAnalysis = `This is a FOLLOW-UP email. You (${userEmail}) sent the last message and haven't received a response yet. You are following up with ${recipientEmail}.`;
  } else if (conversationState.respondingTo) {
    situationAnalysis = `You are RESPONDING to an email from ${conversationState.respondingTo}. They sent you a message and are waiting for your reply.`;
  } else if (conversationState.waitingForResponse) {
    situationAnalysis = `You sent the last email to ${recipientEmail} and are still waiting for their response.`;
  }
  
  // Build conversation history
  const conversationHistory = buildConversationHistory(threadContext.emails);
  
  // Build comprehensive prompt
  const prompt = `You are writing an email on behalf of ${userEmail}.
Your name is: ${userDisplayName}
You are ${userDisplayName} writing to ${recipientName}.

═══════════════════════════════════════
IDENTITY DECLARATION
═══════════════════════════════════════
YOUR IDENTITY: ${userEmail}
- Your name: ${userDisplayName}
- This is YOUR email address
- You are the SENDER of this email
- Write from first-person perspective (I, me, my)

RECIPIENT IDENTITY: ${recipientEmail}
- Their name: ${recipientName}
- This is who you are writing TO
- Address them in the email (or use "Hi", "Hello")
- DO NOT address yourself (${userDisplayName})

═══════════════════════════════════════
USER PREFERENCES
═══════════════════════════════════════
GREETING OPTIONS: ${greetings.join(', ')}
- Choose one of these greetings to start the email
- Or use a contextually appropriate greeting

CLOSING OPTIONS: ${closings.join(', ')}
- Choose one of these closings to end the email
- Sign with: ${userDisplayName}

EMAIL LENGTH: ${lengthInstructions[emailLength]}

═══════════════════════════════════════
CONVERSATION HISTORY
═══════════════════════════════════════
SUBJECT: ${threadContext.subject}

${conversationHistory}

═══════════════════════════════════════
CURRENT SITUATION
═══════════════════════════════════════
${situationAnalysis}

- Thread length: ${conversationState.threadLength} message(s)
- Last sender: ${conversationState.lastSenderWasUser ? `YOU (${userEmail})` : conversationState.respondingTo || 'Other party'}
- Message type: ${conversationState.isFollowUp ? 'Follow-up' : conversationState.respondingTo ? 'Response' : 'New message'}

═══════════════════════════════════════
USER'S INTENT
═══════════════════════════════════════
${userIntent}

═══════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════
Write a ${toneInstructions[tone] || 'professional'} email that:

1. ✓ Starts with one of: ${greetings.join(', ')}
2. ✓ Is from ${userEmail}'s perspective (use "I", "my", "me")
3. ✓ Addresses ${recipientEmail} (not yourself)
4. ✓ Accomplishes this intent: "${userIntent}"
5. ✓ Maintains appropriate context from the conversation
6. ✓ Uses a ${tone} tone
7. ✓ Length: ${lengthInstructions[emailLength]}
8. ✓ Is ready to send (no placeholders like [insert X])
9. ✓ Does NOT include "Subject:" or "Re:" lines (Gmail handles that)
10. ✓ Ends with one of: ${closings.join(', ')}
11. ✓ Signs as "${userDisplayName}" NOT "${recipientName}"
${conversationState.isFollowUp ? '12. ✓ Clearly indicates this is a follow-up' : ''}
${conversationState.respondingTo ? '12. ✓ Directly responds to their message' : ''}

CRITICAL REMINDERS:
❌ DO NOT write "Dear ${userDisplayName}" or "Hi ${userDisplayName}" - that's you!
❌ DO NOT write about ${userDisplayName} in third person - use "I"
❌ DO NOT include "Subject: Re: ..." in the email body
❌ DO NOT sign with "${recipientName}" - that's the RECIPIENT, not you!
❌ DO NOT sign with "${recipientEmail}" - that's who you're writing TO!
✓ DO write from ${userDisplayName}'s perspective using first-person
✓ DO address ${recipientName} or use general greetings
✓ DO use one of these greetings: ${greetings.join(', ')}
✓ DO use one of these closings: ${closings.join(', ')}
✓ DO sign with "${userDisplayName}" or just your first name
✓ YOU ARE ${userDisplayName}, NOT ${recipientName}

═══════════════════════════════════════
YOUR EMAIL REPLY (from ${userEmail} to ${recipientEmail}):
═══════════════════════════════════════`;
  
  console.log('[MailBot] Sending prompt to AI...');
  console.log('[MailBot] Context:', {
    userEmail,
    recipientEmail,
    situationType: conversationState.isFollowUp ? 'follow-up' : conversationState.respondingTo ? 'response' : 'new',
    attemptNumber
  });
  
  // Generate response
  let result = await session.prompt(prompt);
  
  console.log('[MailBot] AI response received, length:', result.length);
  
  // Clean up session
  session.destroy();
  
  // Apply signature fix (fallback post-processing)
  result = fixSignature(result, userDisplayName, recipientEmail);
  
  // Validate the generated email
  const validation = validateGeneratedEmail(
    result,
    userEmail,
    recipientEmail,
    userIntent
  );
  
  return {
    text: result,
    validation,
    attemptNumber
  };
}

/**
 * Show intent input modal
 * @param {HTMLElement} editableField - The compose text field
 * @param {string} boxType - Type of compose box
 */
function showIntentModal(editableField, boxType) {
  // Prevent duplicate modals
  if (document.querySelector('.mailbot-intent-modal')) return;
  
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'mailbot-intent-modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
  overlay.style.zIndex = '10000000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.backdropFilter = 'blur(2px)';
  
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'mailbot-intent-modal';
  modal.style.position = 'relative';
  modal.style.backgroundColor = '#ffffff';
  modal.style.borderRadius = '12px';
  modal.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
  modal.style.padding = '24px';
  modal.style.maxWidth = '500px';
  modal.style.width = '90%';
  modal.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  
  // Modal content
  modal.innerHTML = `
    <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #000;">
      What would you like to say?
    </h3>
    <textarea 
      class="mailbot-intent-input" 
      placeholder="E.g., Thank them for the update and ask about next steps..."
      style="width: 100%; min-height: 80px; padding: 12px; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; font-family: inherit; resize: vertical; outline: none; box-sizing: border-box;"
    ></textarea>
    <div style="margin: 16px 0;">
      <label style="display: block; margin-bottom: 8px; font-size: 13px; font-weight: 500; color: #333;">
        Tone:
      </label>
      <select 
        class="mailbot-tone-select"
        style="width: 100%; padding: 10px 12px; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; font-family: inherit; background: white; cursor: pointer; outline: none;"
      >
        <option value="neutral">Neutral</option>
        <option value="friendly">Friendly</option>
        <option value="formal">Formal</option>
        <option value="concise">Concise</option>
      </select>
    </div>
    <div style="display: flex; gap: 12px; margin-top: 20px;">
      <button 
        class="mailbot-generate-btn"
        style="flex: 1; padding: 12px 20px; background: #000000; color: #ffffff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;"
      >
        Generate Reply
      </button>
      <button 
        class="mailbot-cancel-btn"
        style="padding: 12px 20px; background: #f5f5f5; color: #000; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s ease;"
      >
        Cancel
      </button>
    </div>
    <div class="mailbot-loading" style="display: none; text-align: center; margin-top: 16px; color: #666; font-size: 13px;">
      <div style="display: inline-block; width: 20px; height: 20px; border: 2px solid #e0e0e0; border-top-color: #000; border-radius: 50%; animation: mailbot-spin 0.8s linear infinite;"></div>
      <p style="margin: 8px 0 0 0;">Generating your reply...</p>
    </div>
  `;
  
  // Add spin animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes mailbot-spin {
      to { transform: rotate(360deg); }
    }
    .mailbot-intent-input:focus {
      border-color: #000 !important;
    }
    .mailbot-tone-select:focus {
      border-color: #000 !important;
    }
    .mailbot-generate-btn:hover {
      background: #1a1a1a !important;
      transform: translateY(-1px);
    }
    .mailbot-cancel-btn:hover {
      background: #e8e8e8 !important;
    }
  `;
  document.head.appendChild(style);
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Get modal elements
  const intentInput = modal.querySelector('.mailbot-intent-input');
  const toneSelect = modal.querySelector('.mailbot-tone-select');
  const generateBtn = modal.querySelector('.mailbot-generate-btn');
  const cancelBtn = modal.querySelector('.mailbot-cancel-btn');
  const loadingDiv = modal.querySelector('.mailbot-loading');
  
  // Focus on input
  setTimeout(() => intentInput.focus(), 100);
  
  // Close modal function
  function closeModal() {
    overlay.remove();
    style.remove();
  }
  
  // Cancel button
  cancelBtn.addEventListener('click', closeModal);
  
  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  
  // Generate button
  generateBtn.addEventListener('click', async () => {
    const userIntent = intentInput.value.trim();
    const tone = toneSelect.value;
    
    if (!userIntent) {
      intentInput.style.borderColor = '#ff4444';
      intentInput.placeholder = 'Please enter what you\'d like to say...';
      setTimeout(() => {
        intentInput.style.borderColor = '#e0e0e0';
      }, 2000);
      return;
    }
    
    // Show loading state
    generateBtn.disabled = true;
    cancelBtn.disabled = true;
    intentInput.disabled = true;
    toneSelect.disabled = true;
    loadingDiv.style.display = 'block';
    
    // Extract email context
    const threadContext = extractThreadContext();
    
    // Send message to background for AI generation
    try {
      // Check if chrome.runtime is available
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Extension context is invalid. Please reload the extension.');
      }
      
      const response = await chrome.runtime.sendMessage({
        action: 'generateReply',
        emailText: threadContext.fullThread,
        subject: threadContext.subject,
        userIntent: userIntent,
        tone: tone
      });
      
      if (response && response.success && response.generatedText) {
        // Insert generated text into compose field
        insertReplyText(editableField, response.generatedText);
        closeModal();
        console.log('[MailBot] Reply generated and inserted successfully');
      } else {
        const errorMsg = response?.error || 'Unknown error occurred';
        alert('Failed to generate reply:\n\n' + errorMsg);
        loadingDiv.style.display = 'none';
        generateBtn.disabled = false;
        cancelBtn.disabled = false;
        intentInput.disabled = false;
        toneSelect.disabled = false;
      }
    } catch (error) {
      console.error('[MailBot] Error generating reply:', error);
      alert('Error:\n\n' + error.message + '\n\nPlease try reloading the extension.');
      loadingDiv.style.display = 'none';
      generateBtn.disabled = false;
      cancelBtn.disabled = false;
      intentInput.disabled = false;
      toneSelect.disabled = false;
    }
  });
  
  // Enter key to generate
  intentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      generateBtn.click();
    }
  });
}

/**
 * Insert generated reply text into Gmail compose field
 * @param {HTMLElement} editableField - The contenteditable compose field
 * @param {string} text - The generated text to insert
 */
function insertReplyText(editableField, text) {
  if (!editableField) return;
  
  // Clear existing content
  editableField.innerHTML = '';
  
  // Insert new text
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const textNode = document.createTextNode(line);
    editableField.appendChild(textNode);
    if (index < lines.length - 1) {
      editableField.appendChild(document.createElement('br'));
    }
  });
  
  // Trigger input event to notify Gmail
  editableField.dispatchEvent(new Event('input', { bubbles: true }));
  editableField.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Focus the field
  editableField.focus();
  
  console.log('[MailBot] Text inserted into compose field');
}

/**
 * Attach MailBot button to a compose/reply container
 * @param {HTMLElement} editableField - The contenteditable text field element
 * @param {string} type - Type of compose box: 'dialog', 'inline', or 'compose'
 */
function attachMailBotButton(editableField, type = 'dialog') {
  // Check if button already exists for this field
  if (document.querySelector(`.mailbot-container[data-field-id="${editableField._mailbotId}"]`)) return;
  
  // Assign unique ID to the field
  if (!editableField._mailbotId) {
    editableField._mailbotId = `mailbot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Create container that will hold both collapsed and expanded states
  const container = document.createElement('div');
  container.className = 'mailbot-container';
  container.setAttribute('data-mailbot-type', type);
  container.setAttribute('data-field-id', editableField._mailbotId);
  container.setAttribute('data-state', 'collapsed'); // Track UI state
  
  // Create collapsed button (original MailBot button)
  const collapsedBtn = document.createElement('button');
  collapsedBtn.textContent = 'MailBot';
  collapsedBtn.className = 'mailbot-btn mailbot-collapsed';
  collapsedBtn.setAttribute('data-mailbot-type', type);
  collapsedBtn.setAttribute('data-field-id', editableField._mailbotId);
  
  // Create expanded panel
  const expandedPanel = document.createElement('div');
  expandedPanel.className = 'mailbot-expanded';
  expandedPanel.style.display = 'none'; // Hidden initially
  
  // Build expanded panel structure
  expandedPanel.innerHTML = `
    <label class="mailbot-label">What do you want to say?</label>
    <input type="text" class="mailbot-input" placeholder="Your thoughts..." />
    <div class="mailbot-controls">
      <button class="mailbot-generate-btn">Generate</button>
      <button class="mailbot-insert-btn">Insert</button>
      <button class="mailbot-collapse-btn" title="Collapse">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10 2L4 8L10 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `;
  
  // Create separate preview box that appears BELOW the expanded panel
  const previewContainer = document.createElement('div');
  previewContainer.className = 'mailbot-preview-container';
  previewContainer.style.display = 'none'; // Hidden initially
  previewContainer.innerHTML = `
    <div class="mailbot-preview-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-size: 13px; font-weight: 500; color: #ffffff; opacity: 0.8;">Preview (click to edit):</span>
      <button class="mailbot-regenerate-btn" style="padding: 4px 12px; background: #333; color: #fff; border: 1px solid #555; border-radius: 12px; font-size: 12px; cursor: pointer;">Regenerate</button>
    </div>
    <div class="mailbot-preview-content" contenteditable="true"></div>
  `;
  
  // Add both to container
  container.appendChild(collapsedBtn);
  container.appendChild(expandedPanel);
  container.appendChild(previewContainer); // Add preview container BELOW expanded panel
  
  // Reference for easier access
  const btn = collapsedBtn;
  
  // Different styling based on type
  if (type === 'inline') {
    // CONTAINER STYLING (for inline replies - fixed positioning to float above)
    container.style.position = 'fixed';
    container.style.zIndex = '9999999';
    container.style.pointerEvents = 'auto';
    container.style.userSelect = 'none';
    
    // COLLAPSED BUTTON STYLING - Compact rounded rectangular shape
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.padding = '10px 20px';  // Slightly less padding for compact look
    btn.style.background = '#000000';
    btn.style.color = 'rgba(255, 255, 255, 0.8)';  // Slightly dimmed white text (80% opacity)
    btn.style.border = '1.5px solid #000000';
    btn.style.borderRadius = '16px';  // More rectangular, less rounded than full pill
    btn.style.cursor = 'grab';
    btn.style.fontSize = '16px';
    btn.style.fontWeight = '500';
    btn.style.letterSpacing = '0.3px';
    btn.style.transition = 'all 0.2s ease';
    btn.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    btn.style.whiteSpace = 'nowrap';
    btn.style.height = '60px';  // Compact height
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';  // Subtle shadow for depth
    btn.style.opacity = '1';  // Initial opacity for fade transitions
    
    // EXPANDED PANEL STYLING - Black theme to match MailBot button
    expandedPanel.style.display = 'none';
    expandedPanel.style.background = '#000000';  // Black background
    expandedPanel.style.border = '1.5px solid #000000';
    expandedPanel.style.borderRadius = '16px';  // Match button's rounded rectangular shape
    expandedPanel.style.padding = '10px 20px';  // Match button padding
    expandedPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    expandedPanel.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    expandedPanel.style.minWidth = '500px';
    expandedPanel.style.display = 'flex';
    expandedPanel.style.alignItems = 'center';
    expandedPanel.style.gap = '12px';
    expandedPanel.style.cursor = 'grab';  // Show grab cursor for dragging
    expandedPanel.style.display = 'none'; // Hidden initially
    expandedPanel.style.opacity = '1';  // Initial opacity for fade transitions
    
    // Style label - White text on black (also draggable)
    const label = expandedPanel.querySelector('.mailbot-label');
    label.style.color = '#ffffff';  // White text
    label.style.fontSize = '13px';
    label.style.fontWeight = '400';
    label.style.whiteSpace = 'nowrap';
    label.style.marginRight = '8px';
    label.style.cursor = 'grab';  // Label is draggable
    label.style.opacity = '0.8';  // Slightly dimmed
    
    // Style input - Dark with white text
    const input = expandedPanel.querySelector('.mailbot-input');
    input.style.flex = '1';
    input.style.padding = '10px 16px';
    input.style.background = '#1a1a1a';  // Dark gray background
    input.style.color = '#ffffff';  // White text
    input.style.border = '1.5px solid #333333';
    input.style.borderRadius = '20px';  // Rounded rectangular
    input.style.fontSize = '14px';
    input.style.fontFamily = 'inherit';
    input.style.outline = 'none';
    input.style.transition = 'all 0.2s ease';
    
    // Placeholder styling
    input.style.setProperty('::placeholder', 'color: rgba(255,255,255,0.5)');
    
    input.addEventListener('focus', () => {
      input.style.background = '#2a2a2a';
      input.style.borderColor = '#555555';
    });
    
    input.addEventListener('blur', () => {
      input.style.background = '#1a1a1a';
      input.style.borderColor = '#333333';
    });
    
    // Style controls container
    const controls = expandedPanel.querySelector('.mailbot-controls');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';
    
    // Style Generate button - White with black text for contrast
    const generateBtn = expandedPanel.querySelector('.mailbot-generate-btn');
    generateBtn.style.padding = '10px 20px';
    generateBtn.style.background = '#ffffff';
    generateBtn.style.color = '#000000';
    generateBtn.style.border = '1.5px solid #ffffff';
    generateBtn.style.borderRadius = '20px';  // Rounded rectangular
    generateBtn.style.fontSize = '14px';
    generateBtn.style.fontWeight = '500';
    generateBtn.style.cursor = 'pointer';
    generateBtn.style.transition = 'all 0.2s ease';
    generateBtn.style.whiteSpace = 'nowrap';
    generateBtn.style.letterSpacing = '0.3px';
    
    generateBtn.addEventListener('mouseenter', () => {
      generateBtn.style.background = '#e8e8e8';
      generateBtn.style.transform = 'scale(1.02)';
    });
    
    generateBtn.addEventListener('mouseleave', () => {
      generateBtn.style.background = '#ffffff';
      generateBtn.style.transform = 'scale(1)';
    });
    
    // Style Insert button - White with black text (consistent)
    const insertBtn = expandedPanel.querySelector('.mailbot-insert-btn');
    insertBtn.style.padding = '10px 24px';
    insertBtn.style.background = '#ffffff';
    insertBtn.style.color = '#000000';
    insertBtn.style.border = '1.5px solid #ffffff';
    insertBtn.style.borderRadius = '20px';  // Rounded rectangular
    insertBtn.style.fontSize = '14px';
    insertBtn.style.fontWeight = '500';
    insertBtn.style.cursor = 'pointer';
    insertBtn.style.transition = 'all 0.2s ease';
    insertBtn.style.whiteSpace = 'nowrap';
    insertBtn.style.letterSpacing = '0.3px';
    
    insertBtn.addEventListener('mouseenter', () => {
      insertBtn.style.background = '#e8e8e8';
      insertBtn.style.transform = 'scale(1.02)';
    });
    
    insertBtn.addEventListener('mouseleave', () => {
      insertBtn.style.background = '#ffffff';
      insertBtn.style.transform = 'scale(1)';
    });
    
    // Style collapse button (chevron) - White button with black icon
    const collapseBtn = expandedPanel.querySelector('.mailbot-collapse-btn');
    collapseBtn.style.padding = '8px';
    collapseBtn.style.background = '#ffffff';  // White background
    collapseBtn.style.color = '#000000';  // Black icon
    collapseBtn.style.border = '1.5px solid #ffffff';
    collapseBtn.style.borderRadius = '50%';  // Circular
    collapseBtn.style.width = '36px';
    collapseBtn.style.height = '36px';
    collapseBtn.style.display = 'flex';
    collapseBtn.style.alignItems = 'center';
    collapseBtn.style.justifyContent = 'center';
    collapseBtn.style.cursor = 'pointer';
    collapseBtn.style.transition = 'all 0.2s ease';
    
    collapseBtn.addEventListener('mouseenter', () => {
      collapseBtn.style.background = '#e8e8e8';  // Slightly dimmed white
      collapseBtn.style.transform = 'scale(1.05)';
    });
    
    collapseBtn.addEventListener('mouseleave', () => {
      collapseBtn.style.background = '#ffffff';  // Back to white
      collapseBtn.style.transform = 'scale(1)';
    });
    
    // Style preview container - Separate box below expanded panel
    previewContainer.style.position = 'fixed';
    previewContainer.style.zIndex = '9999999';
    previewContainer.style.background = '#000000';
    previewContainer.style.border = '1.5px solid #000000';
    previewContainer.style.borderRadius = '16px';
    previewContainer.style.padding = '16px 20px';
    previewContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    previewContainer.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    previewContainer.style.minWidth = '500px';
    previewContainer.style.maxWidth = '700px';
    previewContainer.style.marginTop = '8px';
    previewContainer.style.opacity = '1';  // Initial opacity for fade transitions
    
    // Style preview content
    const previewContent = previewContainer.querySelector('.mailbot-preview-content');
    previewContent.style.padding = '12px';
    previewContent.style.background = '#1a1a1a';
    previewContent.style.border = '1.5px solid #333333';
    previewContent.style.borderRadius = '12px';
    previewContent.style.color = '#ffffff';
    previewContent.style.fontSize = '14px';
    previewContent.style.lineHeight = '1.6';
    previewContent.style.whiteSpace = 'pre-wrap';
    previewContent.style.wordWrap = 'break-word';
    previewContent.style.maxHeight = '300px';
    previewContent.style.overflowY = 'auto';
    previewContent.style.outline = 'none';
    previewContent.style.minHeight = '100px';
    
    // Variable to store generated text
    let generatedText = null;
    
    // STATE TOGGLE FUNCTIONS
    function expandPanel() {
      container.setAttribute('data-state', 'expanded');
      
      // Fade out collapsed button
      btn.style.transition = 'opacity 0.2s ease';
      btn.style.opacity = '0';
      
      // After fade out, hide button and show expanded panel
      setTimeout(() => {
        btn.style.display = 'none';
        expandedPanel.style.display = 'flex';
        expandedPanel.style.opacity = '0';
        
        // Trigger reflow to ensure transition works
        expandedPanel.offsetHeight;
        
        // Fade in expanded panel
        expandedPanel.style.transition = 'opacity 0.2s ease';
        expandedPanel.style.opacity = '1';
        
        input.focus(); // Auto-focus input
      }, 200); // Match fade out duration
      
      console.log('[MailBot] Expanded UI');
    }
    
    function collapsePanel() {
      container.setAttribute('data-state', 'collapsed');
      
      // Fade out expanded panel and preview
      expandedPanel.style.transition = 'opacity 0.2s ease';
      expandedPanel.style.opacity = '0';
      
      if (previewContainer.style.display === 'block') {
        previewContainer.style.transition = 'opacity 0.2s ease';
        previewContainer.style.opacity = '0';
      }
      
      // After fade out, hide panels and show button
      setTimeout(() => {
        expandedPanel.style.display = 'none';
        previewContainer.style.display = 'none';
        btn.style.display = 'inline-flex';
        btn.style.opacity = '0';
        
        // Trigger reflow
        btn.offsetHeight;
        
        // Fade in collapsed button
        btn.style.transition = 'opacity 0.2s ease';
        btn.style.opacity = '1';
        
        input.value = ''; // Clear input
        previewContent.textContent = ''; // Clear preview
        generatedText = null; // Clear generated text
      }, 200); // Match fade out duration
      
      console.log('[MailBot] Collapsed UI');
    }
    
    // Position preview container below expanded panel
    function positionPreview() {
      if (!document.body.contains(expandedPanel)) return;
      
      const panelRect = expandedPanel.getBoundingClientRect();
      previewContainer.style.top = `${panelRect.bottom + 8}px`;
      previewContainer.style.left = `${panelRect.left}px`;
    }
    
    // EVENT HANDLERS
    
    // Collapse button click
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      collapsePanel();
    });
    
    // Generate button click
    generateBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const userPrompt = input.value.trim();
      if (!userPrompt) {
        input.focus();
        input.style.borderColor = '#ea4335';
        setTimeout(() => { input.style.borderColor = '#333333'; }, 1000);
        return;
      }
      
      console.log('[MailBot] Generate clicked with prompt:', userPrompt);
      
      // Show loading state
      generateBtn.textContent = 'Generating...';
      generateBtn.disabled = true;
      generateBtn.style.opacity = '0.6';
      
      try {
        // Get thread context with enhanced metadata
        const threadContext = extractThreadContext();
        
        // Get default tone from storage
        const { defaultTone } = await chrome.storage.local.get(['defaultTone']);
        const tone = defaultTone || 'neutral';
        
        // Call AI directly in content script with enhanced context
        console.log('[MailBot] Calling AI with enhanced context...');
        let result = await generateWithAI(
          threadContext,
          userPrompt,
          tone,
          1 // Attempt 1
        );
        
        // Check validation
        if (!result.validation.isValid && result.attemptNumber < 2) {
          console.warn('[MailBot] ⚠️ Validation failed on attempt 1:', result.validation.issues);
          console.log('[MailBot] Retrying with more explicit instructions...');
          
          generateBtn.textContent = 'Retrying...';
          
          // Retry with attempt 2 (more explicit prompt)
          result = await generateWithAI(
            threadContext,
            userPrompt,
            tone,
            2 // Attempt 2
          );
        }
        
        // Show validation warnings to user if any
        if (result.validation.issues.length > 0) {
          const warnings = result.validation.issues.filter(i => i.startsWith('WARNING'));
          if (warnings.length > 0) {
            console.warn('[MailBot] ⚠️ Validation warnings:', warnings);
          }
          
          const errors = result.validation.issues.filter(i => i.startsWith('ERROR'));
          if (errors.length > 0) {
            console.error('[MailBot] ❌ Validation errors:', errors);
            
            // Ask user if they want to use it anyway
            const errorMsg = errors.join('\n');
            const useAnyway = confirm(
              `⚠️ Validation Issues Detected:\n\n${errorMsg}\n\n` +
              `The generated email may have problems. Do you want to use it anyway?\n\n` +
              `Click OK to insert, or Cancel to try again with different instructions.`
            );
            
            if (!useAnyway) {
              generateBtn.textContent = 'Generate';
              generateBtn.disabled = false;
              generateBtn.style.opacity = '1';
              input.focus();
              return;
            }
          }
        }
        
        console.log('[MailBot] ✓ Reply generated successfully (attempt ' + result.attemptNumber + ')');
        
        // Store generated text
        generatedText = result.text;
        
        // Show preview in separate box below with fade-in animation
        previewContent.textContent = generatedText;
        previewContainer.style.display = 'block';
        previewContainer.style.opacity = '0';
        positionPreview(); // Position below expanded panel
        
        // Trigger reflow to ensure transition works
        previewContainer.offsetHeight;
        
        // Fade in preview
        previewContainer.style.transition = 'opacity 0.2s ease';
        previewContainer.style.opacity = '1';
        
        console.log('[MailBot] 📝 Preview displayed in separate box - user can review and edit');
        
      } catch (error) {
        console.error('[MailBot] ✗ Generation failed:', error);
        alert('Failed to generate reply:\n\n' + error.message);
      } finally {
        // Reset button
        generateBtn.textContent = 'Generate';
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
      }
    });
    
    // Insert button click - inserts generated text into Gmail compose field
    insertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('[MailBot] Insert clicked');
      
      // Get text from preview (user may have edited it)
      const textToInsert = previewContent.textContent || generatedText;
      
      if (!textToInsert) {
        // Visual feedback: red border on input box
        intentInput.style.borderColor = '#ff4444';
        intentInput.placeholder = 'Please click "Generate" first...';
        setTimeout(() => {
          intentInput.style.borderColor = '#e0e0e0';
          intentInput.placeholder = 'Your thoughts...';
        }, 2000);
        return;
      }
      
      // Insert into Gmail compose field
      insertReplyText(editableField, textToInsert);
      
      // Collapse panel after successful insertion
      collapsePanel();
      
      console.log('[MailBot] ✓ Email inserted into compose field');
    });
    
    // Regenerate button click
    const regenerateBtn = previewContainer.querySelector('.mailbot-regenerate-btn');
    regenerateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      generateBtn.click(); // Trigger generate again
    });
    
    // Enter key in input field = Generate
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generateBtn.click();
      }
    });
    
    // Custom position tracking
    let customPosition = null;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let userHasManuallyPositioned = false; // Track if user has ever dragged the panel
    
    // Position the container above the text field (or use custom position if dragged)
    function positionButton() {
      if (!document.body.contains(editableField)) {
        // Field was removed, clean up container
        if (container.parentNode) container.parentNode.removeChild(container);
        return;
      }
      
      if (customPosition) {
        // User has dragged the container - use custom position
        container.style.top = `${customPosition.y}px`;
        container.style.left = `${customPosition.x}px`;
        container.style.visibility = 'visible';
        return;
      }
      
      const rect = editableField.getBoundingClientRect();
      
      // Position 60px above the field
      const top = rect.top - 60;
      const left = rect.left;
      
      container.style.top = `${Math.max(top, 10)}px`;
      container.style.left = `${Math.max(left, 10)}px`;
      container.style.visibility = (top < 0) ? 'hidden' : 'visible'; // Hide if scrolled out of view
    }
    
    // Drag functionality (works in both collapsed and expanded states)
    function onMouseDown(e) {
      // Allow drag in both states, but from specific elements
      const isCollapsed = container.getAttribute('data-state') === 'collapsed';
      
      if (isCollapsed) {
        // In collapsed state, only drag from the button itself
        if (e.target !== btn) return;
      } else {
        // In expanded state, allow drag from the panel background or label (not from inputs/buttons)
        const clickedElement = e.target;
        const isDraggableArea = 
          clickedElement === expandedPanel ||
          clickedElement.classList.contains('mailbot-label') ||
          clickedElement === container;
        
        if (!isDraggableArea) return;
      }
      
      isDragging = true;
      
      // Set cursor on the appropriate element
      if (isCollapsed) {
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
      } else {
        expandedPanel.style.cursor = 'grabbing';
        expandedPanel.style.transition = 'none';
      }
      
      const rect = container.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      
      e.preventDefault();
      e.stopPropagation();
    }
    
    function onMouseMove(e) {
      if (!isDragging) return;
      
      customPosition = {
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      };
      
      userHasManuallyPositioned = true; // User is actively dragging
      
      positionButton();
      
      // If preview is visible, reposition it to follow the expanded panel
      if (previewContainer.style.display === 'block') {
        positionPreview();
      }
      
      e.preventDefault();
    }
    
    function onMouseUp(e) {
      if (!isDragging) return;
      
      const isCollapsed = container.getAttribute('data-state') === 'collapsed';
      
      isDragging = false;
      
      // Reset cursor based on state
      if (isCollapsed) {
        btn.style.cursor = 'grab';
        btn.style.transition = 'all 0.2s ease';
      } else {
        expandedPanel.style.cursor = 'default';
        expandedPanel.style.transition = 'all 0.2s ease';
      }
      
      // If barely moved and collapsed, treat as a click to expand
      if (isCollapsed && customPosition && dragOffset) {
        const moveDistance = Math.sqrt(
          Math.pow(e.clientX - (customPosition.x + dragOffset.x), 2) +
          Math.pow(e.clientY - (customPosition.y + dragOffset.y), 2)
        );
        
        if (moveDistance < 5) {
          // This was a click, not a drag - expand the panel and reset positioning
          customPosition = null;
          userHasManuallyPositioned = false; // Reset manual positioning flag
          expandPanel();
        }
      } else if (isCollapsed && !customPosition) {
        // No drag started, treat as click
        userHasManuallyPositioned = false; // Reset manual positioning flag
        expandPanel();
      }
      
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Attach drag listeners to both button and expanded panel
    btn.addEventListener('mousedown', onMouseDown);
    expandedPanel.addEventListener('mousedown', onMouseDown);
    label.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // Initial positioning
    requestAnimationFrame(() => {
      positionButton();
    });
    
    // Reposition on scroll/resize (only if not custom positioned and not dragging)
    const updatePosition = () => {
      if (!customPosition && !isDragging && !userHasManuallyPositioned) {
        requestAnimationFrame(positionButton);
      }
    };
    document.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    
    // Only reposition on field focus if there's no custom position
    editableField.addEventListener('focus', () => {
      if (!customPosition && !isDragging && !userHasManuallyPositioned) {
        positionButton();
      }
    });
    
    // Store cleanup function
    container._cleanup = () => {
      document.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      editableField.removeEventListener('focus', positionButton);
    };
    
    // Hover effect for inline (only when not dragging and collapsed)
    btn.addEventListener('mouseenter', () => {
      if (!isDragging && container.getAttribute('data-state') === 'collapsed') {
        btn.style.background = '#1a1a1a';
        btn.style.border = '1.5px solid #333333';
        btn.style.transform = 'scale(1.02)';
      }
    });
    
    btn.addEventListener('mouseleave', () => {
      if (!isDragging && container.getAttribute('data-state') === 'collapsed') {
        btn.style.background = '#000000';
        btn.style.border = '1.5px solid #000000';
        btn.style.transform = 'scale(1)';
      }
    });
  } else {
    // For dialogs, keep bottom-right positioning
    btn.style.position = 'absolute';
    btn.style.right = '12px';
    btn.style.bottom = '12px';
    btn.style.zIndex = 1000;
    btn.style.padding = '6px 14px';
    btn.style.background = '#fff';
    btn.style.border = '1px solid #ccc';
    btn.style.borderRadius = '20px';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s ease';
    
    // Hover effect for dialog
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#f5f5f5';
      btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#fff';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
    });
  }
  
  // Handle click event for dialog type only (inline handles it in drag logic)
  if (type !== 'inline') {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Extract thread context
      const threadContext = extractThreadContext();
      
      // Send message to background with context
      chrome.runtime.sendMessage({ 
        type: 'MAILBOT_BUTTON_CLICKED',
        context: {
          boxType: type,
          thread: threadContext,
          timestamp: Date.now()
        }
      });
      
      console.log(`[MailBot] Button clicked on ${type} compose box`, threadContext);
      // TODO: Open inline UI for tone selection
    });
  }
  
  // Different insertion strategy based on type
  if (type === 'inline') {
    // For inline, append container directly to body - it will float above everything with fixed positioning
    document.body.appendChild(container);
    
    // Mark the field as having a button
    editableField.classList.add('mailbot-has-button');
    
    // Watch for field removal and clean up
    const observer = new MutationObserver(() => {
      if (!document.body.contains(editableField)) {
        if (container._cleanup) container._cleanup();
        if (container.parentNode) container.parentNode.removeChild(container);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    console.log(`[MailBot] ✓ Floating UI attached above ${type} compose box`);
  } else {
    // For dialogs, find the dialog container and append inside
    const dialog = editableField.closest('div[role="dialog"]');
    if (dialog) {
      if (getComputedStyle(dialog).position === 'static') {
        dialog.style.position = 'relative';
      }
      dialog.appendChild(container);
      console.log(`[MailBot] UI attached to ${type} compose box`);
    }
  }
}

/**
 * Handle pop-out compose/reply dialogs
 */
function handleDialogComposeBoxes() {
  document.querySelectorAll('div[role="dialog"]').forEach(dialog => {
    const editableField = dialog.querySelector('div[aria-label="Message Body"]');
    if (editableField && !editableField.classList.contains('mailbot-has-button')) {
      attachMailBotButton(editableField, 'dialog');
    }
  });
}

/**
 * Handle inline reply boxes at the end of email threads
 */
function handleInlineReplies() {
  // Look for contenteditable areas NOT in dialogs
  const editableAreas = document.querySelectorAll('div[contenteditable="true"]');
  
  editableAreas.forEach(editable => {
    // IMPORTANT: Skip if it's inside a dialog (we handle those separately)
    if (editable.closest('div[role="dialog"]')) {
      return;
    }
    
    // Skip if it's inside a minimized/hidden area
    if (editable.closest('[style*="display: none"]')) return;
    
    // Skip if we already added a button for this field
    if (editable.classList.contains('mailbot-has-button')) return;
    
    // Look for compose-like attributes
    const ariaLabel = editable.getAttribute('aria-label') || '';
    const role = editable.getAttribute('role');
    
    const isComposeArea = ariaLabel.toLowerCase().includes('message') || 
                          ariaLabel.toLowerCase().includes('reply') || 
                          ariaLabel.toLowerCase().includes('compose') ||
                          role === 'textbox';
    
    if (isComposeArea && editable.classList.contains('Am')) {
      // Check if visible
      const isVisible = editable.offsetParent !== null;
      if (isVisible) {
        console.log('[MailBot] Found inline compose area', { ariaLabel });
        attachMailBotButton(editable, 'inline');
      }
    }
  });
}

/**
 * Main observer for Gmail DOM changes
 */
const observer = new MutationObserver((mutations) => {
  // Handle pop-out dialogs
  handleDialogComposeBoxes();
  
  // Handle inline replies
  handleInlineReplies();
});

// Start observing
observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

// Debug helper: Log all contenteditable areas found
function debugComposeAreas() {
  console.log('[MailBot Debug] Scanning for compose areas...');
  const editableAreas = document.querySelectorAll('div[contenteditable="true"]');
  console.log(`[MailBot Debug] Found ${editableAreas.length} contenteditable elements`);
  
  editableAreas.forEach((el, index) => {
    const inDialog = !!el.closest('div[role="dialog"]');
    const ariaLabel = el.getAttribute('aria-label');
    const parentClasses = el.parentElement?.className || 'no classes';
    
    console.log(`[MailBot Debug] Element ${index + 1}:`, {
      inDialog,
      ariaLabel,
      parentClasses: parentClasses.substring(0, 100),
      hasButton: !!el.closest('.mailbot-container')
    });
  });
}

// Initial scan after page load
setTimeout(() => {
  console.log('[MailBot] Running initial scan...');
  debugComposeAreas(); // Show what we find
  handleDialogComposeBoxes();
  handleInlineReplies();
}, 2000);

// Additional scan after longer delay (for slow-loading Gmail)
setTimeout(() => {
  console.log('[MailBot] Running secondary scan...');
  debugComposeAreas(); // Show what we find
  handleInlineReplies();
}, 5000);

// Add manual trigger for testing (accessible via console)
window.mailbotDebug = {
  scan: () => {
    debugComposeAreas();
    handleInlineReplies();
    console.log('[MailBot] Manual scan complete');
  },
  refresh: () => {
    handleDialogComposeBoxes();
    handleInlineReplies();
    console.log('[MailBot] Refreshed all buttons');
  }
};

// TODO: Remove button when compose box is closed
// TODO: Add keyboard shortcut support
