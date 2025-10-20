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

const EMAIL_REGEX = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i;

/**
 * Normalize a recipient display name, falling back to email username when needed
 * @param {string|null} rawName
 * @param {string} email
 * @returns {string}
 */
function cleanRecipientName(rawName, email) {
  if (!rawName) {
    return email ? email.split('@')[0] : 'Recipient';
  }

  let name = rawName.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  if (!name || name.length < 2 || name.includes('@') || name.startsWith(':') || name.toLowerCase() === email) {
    return email ? email.split('@')[0] : 'Recipient';
  }

  return name;
}

/**
 * Extract recipient candidates from a Gmail message element
 * @param {HTMLElement} msgEl
 * @returns {Array<{email: string, name: string}>}
 */
function extractRecipientsFromMessage(msgEl) {
  if (!msgEl) {
    return [];
  }

  const selectors = [
    '.g2 [email]',
    '.g2 [data-email]',
    '.g2 [data-hovercard-id*="@"]',
    '.gU span[email]',
    '.eG span[email]',
    '.h7 span[email]',
    '.g3 span[email]',
    '[data-tooltip*="to"] span[email]',
    '[data-tooltip="To"] [email]'
  ];

  const seen = new Map();

  const addRecipient = el => {
    if (!el) {
      return;
    }

    const attributeCandidates = [
      el.getAttribute('data-hovercard-id'),
      el.getAttribute('email'),
      el.getAttribute('data-email')
    ];

    let emailCandidate = attributeCandidates.find(Boolean) || '';
    emailCandidate = emailCandidate.trim();

    let emailMatch = emailCandidate.match(EMAIL_REGEX);
    if (!emailMatch) {
      const text = el.textContent || '';
      emailMatch = text.match(EMAIL_REGEX);
    }

    if (!emailMatch) {
      return;
    }

    let email = emailMatch[0].toLowerCase().replace(/^mailto:/i, '');
    if (!email || seen.has(email)) {
      return;
    }

    const rawName = el.getAttribute('name') || el.textContent;
    const name = cleanRecipientName(rawName, email);

    seen.set(email, { email, name });
  };

  selectors.forEach(selector => {
    msgEl.querySelectorAll(selector).forEach(addRecipient);
  });

  if (seen.size === 0) {
    const headerContainer = msgEl.querySelector('.hb, .ha');
    headerContainer?.querySelectorAll('span[email], [data-hovercard-id], [data-email]')?.forEach(addRecipient);
  }

  return Array.from(seen.values());
}

/**
 * Attempt to locate the Gmail message element and identifiers associated with a compose field
 * @param {HTMLElement} editableField - The compose field element
 * @returns {{messageElement: HTMLElement|null, legacyMessageId: string|null, messageId: string|null, threadIndex: number|null}}
 */
function findMessageMetadataForEditable(editableField) {
  const metadata = {
    messageElement: null,
    legacyMessageId: null,
    messageId: null,
    threadIndex: null
  };

  if (!editableField || editableField.nodeType !== Node.ELEMENT_NODE) {
    return metadata;
  }

  const candidateNodes = [];

  let current = editableField;
  while (current && current !== document.body) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      candidateNodes.push(current);
    }
    current = current.parentElement;
  }

  current = editableField.previousElementSibling;
  let guard = 0;
  while (current && guard < 6) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      candidateNodes.push(current);
    }
    current = current.previousElementSibling;
    guard += 1;
  }

  const scanElement = el => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = el;

    if (!metadata.messageElement && element.classList?.contains('adn')) {
      metadata.messageElement = element;
    }

    if (!metadata.legacyMessageId) {
      const legacyAttr = element.getAttribute?.('data-legacy-message-id');
      if (legacyAttr) {
        metadata.legacyMessageId = legacyAttr;
      }
    }

    if (!metadata.messageId) {
      const messageAttr = element.getAttribute?.('data-message-id');
      if (messageAttr) {
        metadata.messageId = messageAttr;
      }
    }

    if ((!metadata.messageElement || !metadata.legacyMessageId || !metadata.messageId) && element.querySelector) {
      if (!metadata.messageElement) {
        const ancestor = element.closest?.('.adn');
        if (ancestor) {
          metadata.messageElement = ancestor;
        }
      }

      if (!metadata.legacyMessageId) {
        const legacyHolder = element.querySelector('[data-legacy-message-id]');
        if (legacyHolder) {
          metadata.legacyMessageId = legacyHolder.getAttribute('data-legacy-message-id');
          if (!metadata.messageElement) {
            metadata.messageElement = legacyHolder.closest('.adn') || legacyHolder;
          }
        }
      }

      if (!metadata.messageId) {
        const messageHolder = element.querySelector('[data-message-id]');
        if (messageHolder) {
          metadata.messageId = messageHolder.getAttribute('data-message-id');
          if (!metadata.messageElement) {
            metadata.messageElement = messageHolder.closest('.adn') || messageHolder;
          }
        }
      }
    }
  };

  candidateNodes.forEach(scanElement);

  if (!metadata.messageElement) {
    const fallback = editableField.closest?.('.adn, .adp, .nH[role="region"]');
    if (fallback) {
      metadata.messageElement = fallback.classList?.contains('adn')
        ? fallback
        : fallback.querySelector?.('.adn');
    }
  }

  if (metadata.messageElement && metadata.messageElement.querySelector) {
    if (!metadata.legacyMessageId) {
      const holder = metadata.messageElement.querySelector('[data-legacy-message-id]');
      if (holder) {
        metadata.legacyMessageId = holder.getAttribute('data-legacy-message-id');
      }
    }
    if (!metadata.messageId) {
      const holder = metadata.messageElement.querySelector('[data-message-id]');
      if (holder) {
        metadata.messageId = holder.getAttribute('data-message-id');
      }
    }
  }

  if (metadata.messageElement) {
    const allMessages = Array.from(document.querySelectorAll('.adn.ads'));
    const directIndex = allMessages.indexOf(metadata.messageElement);
    if (directIndex !== -1) {
      metadata.threadIndex = directIndex;
    } else {
      const parentMessage = metadata.messageElement.closest?.('.adn.ads');
      if (parentMessage) {
        const parentIndex = allMessages.indexOf(parentMessage);
        if (parentIndex !== -1) {
          metadata.messageElement = parentMessage;
          metadata.threadIndex = parentIndex;
        }
      }
    }
  }

  return metadata;
}

/**
 * Analyze conversation state to understand who's waiting for whom
 * @param {Array} emailThread - Array of email objects with from/to/content
 * @param {string} currentUserEmail - The logged-in user's email
 * @param {number|null} replyingToIndex - Index of the message we're replying to (null = replying at end)
 * @returns {Object} Conversation state analysis
 */
function analyzeConversationState(emailThread, currentUserEmail, replyingToIndex = null) {
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

  // Determine which email we're responding to
  let targetEmail;
  if (replyingToIndex !== null && replyingToIndex >= 0 && replyingToIndex < emailThread.length) {
    // Replying to a specific message in the middle of the thread
    targetEmail = emailThread[replyingToIndex];
    console.log('[MailBot] 📧 Replying to message in middle of thread:', {
      from: targetEmail.from,
      fromName: targetEmail.fromName,
      index: replyingToIndex
    });
  } else {
    // Replying at the end of the thread (default behavior)
    targetEmail = emailThread[emailThread.length - 1];
    console.log('[MailBot] 📧 Replying at end of thread to:', {
      from: targetEmail.from,
      fromName: targetEmail.fromName
    });
  }

  const currentUserEmailLower = currentUserEmail?.toLowerCase() || null;
  const secondLastEmail = emailThread.length > 1 ? emailThread[emailThread.length - 2] : null;
  const lastSenderWasUser = targetEmail.isFromUser;
  const isFollowUp = lastSenderWasUser && secondLastEmail?.isFromUser;
  const recipientCandidates = Array.isArray(targetEmail.toRecipients) ? targetEmail.toRecipients : [];

  let recipientEmail;
  let recipientName;

  if (lastSenderWasUser) {
    // If user sent the target email, we're following up with the same recipient (prefer non-user recipients)
    const nonUserCandidates = currentUserEmailLower
      ? recipientCandidates.filter(candidate => candidate.email && candidate.email !== currentUserEmailLower)
      : recipientCandidates.filter(candidate => candidate.email);

    const candidate = nonUserCandidates[0] || recipientCandidates[0];
    if (candidate) {
      recipientEmail = candidate.email;
      recipientName = candidate.name;
      console.log('[MailBot] 👤 Recipient from your sent message:', recipientName, recipientEmail);
    } else {
      console.log('[MailBot] ⚠️ Could not determine recipient directly from your sent message.');
    }
  } else {
    // If someone else sent the target email, reply to them
    recipientEmail = targetEmail.from;
    recipientName = targetEmail.fromName;
    console.log('[MailBot] 👤 Recipient is the person who wrote to YOU:', recipientName, recipientEmail);
  }

  let needsFallback = !recipientEmail;
  if (!needsFallback && currentUserEmailLower && recipientEmail === currentUserEmailLower) {
    needsFallback = true;
  }

  // Validation & fallback: Make sure we're not addressing ourselves or missing a recipient
  if (needsFallback) {
    console.error('[MailBot] ❌ Recipient is missing or set to the current user. Attempting to find correct recipient...');

    for (const email of emailThread) {
      if (!email.isFromUser && email.from && (!currentUserEmailLower || email.from !== currentUserEmailLower)) {
        recipientEmail = email.from;
        recipientName = email.fromName;
        console.log('[MailBot] ✓ Found alternative recipient from incoming message:', recipientName, recipientEmail);
        needsFallback = false;
        break;
      }

      if (email.isFromUser) {
        const altRecipient = (email.toRecipients || []).find(candidate => candidate.email && (!currentUserEmailLower || candidate.email !== currentUserEmailLower));
        if (altRecipient) {
          recipientEmail = altRecipient.email;
          recipientName = altRecipient.name;
          console.log('[MailBot] ✓ Found alternative recipient from your sent message:', recipientName, recipientEmail);
          needsFallback = false;
          break;
        }
      }
    }
  }

  if (needsFallback) {
    const fallbackCandidate = recipientCandidates.find(candidate => candidate.email && (!currentUserEmailLower || candidate.email !== currentUserEmailLower));
    if (fallbackCandidate) {
      recipientEmail = fallbackCandidate.email;
      recipientName = fallbackCandidate.name;
      console.log('[MailBot] ✓ Using fallback recipient from candidate list:', recipientName, recipientEmail);
      needsFallback = false;
    }
  }

  if (needsFallback && !lastSenderWasUser && targetEmail.from && (!currentUserEmailLower || targetEmail.from !== currentUserEmailLower)) {
    recipientEmail = targetEmail.from;
    recipientName = targetEmail.fromName;
    needsFallback = false;
  }

  if (!recipientEmail) {
    recipientEmail = 'unknown@recipient.com';
  }

  if (recipientEmail.includes('mailto:')) {
    recipientEmail = recipientEmail.replace(/^mailto:/i, '');
  }
  recipientEmail = recipientEmail.toLowerCase();

  if (!recipientName || recipientName.includes('@') || recipientName.startsWith(':') || recipientName.length < 2) {
    recipientName = recipientEmail.split('@')[0];
  }

  return {
    lastSenderWasUser,
    isFollowUp, // User is following up on their own email
    waitingForResponse: lastSenderWasUser, // If user sent last, they're waiting
    respondingTo: lastSenderWasUser ? null : targetEmail.from, // Who we're responding to
    conversationStarter: emailThread.length === 1 && lastSenderWasUser,
    recipientEmail,
    recipientName,
    recipientList: recipientCandidates,
    threadLength: emailThread.length
  };
}

/**
 * Extract email thread context from the current page with enhanced metadata
 * @param {HTMLElement} editableField - The compose field we're generating for (optional)
 * @returns {Object} Thread context including subject, messages with sender/recipient info
 */
function extractThreadContext(editableField = null) {
  const currentUserEmail = getCurrentUserEmail();
  const currentUserEmailLower = currentUserEmail?.toLowerCase() || null;
  const subject = document.querySelector('h2.hP')?.innerText || 'No subject';

  // Extract email messages with sender and recipient information
  const messageElements = Array.from(document.querySelectorAll('.adn.ads'));
  const emails = messageElements.map(msgEl => {
    // Try to extract sender email and name from the message header
    const senderEl = msgEl.querySelector('.gD, .go, [email]');
    const senderEmailRaw = senderEl?.getAttribute('email') || 
                       senderEl?.getAttribute('data-email') ||
                       senderEl?.textContent?.match(EMAIL_REGEX)?.[0] ||
                       'unknown@sender.com';
    const senderEmail = senderEmailRaw.toLowerCase();
    
    // Extract sender display name (the text shown before the email)
    const senderNameEl = msgEl.querySelector('.gD');
    const senderName = senderNameEl?.getAttribute('name') || 
                      senderNameEl?.textContent?.trim() ||
                      senderEmail.split('@')[0];

    const legacyMessageId = msgEl.getAttribute('data-legacy-message-id') ||
      msgEl.dataset?.legacyMessageId ||
      msgEl.querySelector?.('[data-legacy-message-id]')?.getAttribute('data-legacy-message-id') ||
      null;

    const messageId = msgEl.getAttribute('data-message-id') ||
      msgEl.dataset?.messageId ||
      msgEl.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') ||
      null;

    const domId = msgEl.id || msgEl.getAttribute('id') || null;
    
    const recipients = extractRecipientsFromMessage(msgEl);
    const filteredRecipients = recipients.filter(recipient => recipient.email);
    const nonUserRecipients = currentUserEmailLower
      ? filteredRecipients.filter(recipient => recipient.email !== currentUserEmailLower)
      : filteredRecipients;
    const primaryRecipient = nonUserRecipients[0] || filteredRecipients[0] || null;

    let recipientEmail = primaryRecipient?.email || 'unknown@recipient.com';
    let recipientName = primaryRecipient?.name || recipientEmail.split('@')[0];

    if (recipientName.includes('@') || recipientName.startsWith(':') || recipientName.length < 2) {
      recipientName = recipientEmail.split('@')[0];
    }
    
    const content = msgEl.innerText?.substring(0, 1000) || ''; // Limit to 1000 chars
    
    // Determine if this email is from or to the current user
    const isFromUser = currentUserEmailLower ? senderEmail === currentUserEmailLower : false;
    const isToUser = currentUserEmailLower ? filteredRecipients.some(recipient => recipient.email === currentUserEmailLower) : false;

    // Debug log for each message
    console.log('[MailBot] 📨 Parsed message:', {
      from: `${senderName} <${senderEmail}>`,
      to: `${recipientName} <${recipientEmail}>`,
      recipientCount: filteredRecipients.length,
      isFromUser,
      isToUser,
      legacyMessageId,
      messageId,
      domId
    });

    return {
      from: senderEmail,
      fromName: senderName,
      to: recipientEmail,
      toName: recipientName,
      toRecipients: filteredRecipients,
      content,
      isFromUser,
      isToUser,
      legacyMessageId,
      messageId,
      domId,
      element: msgEl // Keep reference to DOM element
    };
  });

  // If we have an editableField, try to find which message we're replying to
  let replyingToMessageIndex = null;
  if (editableField && emails.length > 0) {
    const datasetIndex = editableField.dataset?.mailbotMessageIndex;
    if (datasetIndex !== undefined) {
      const numericIndex = parseInt(datasetIndex, 10);
      if (!Number.isNaN(numericIndex) && emails[numericIndex]) {
        replyingToMessageIndex = numericIndex;
        console.log('[MailBot] 🎯 Reply index from stored dataset:', replyingToMessageIndex,
          'from:', emails[replyingToMessageIndex].fromName);
      }
    }
  }

  if (replyingToMessageIndex === null && editableField && emails.length > 0) {
    const datasetLegacy = editableField.dataset?.mailbotLegacyMessageId;
    if (datasetLegacy) {
      const legacyIndex = emails.findIndex(email => email.legacyMessageId === datasetLegacy);
      if (legacyIndex !== -1) {
        replyingToMessageIndex = legacyIndex;
        console.log('[MailBot] 🎯 Reply index matched via legacy message ID:', replyingToMessageIndex,
          'from:', emails[replyingToMessageIndex].fromName);
      }
    }
  }

  if (replyingToMessageIndex === null && editableField && emails.length > 0) {
    const datasetMessageId = editableField.dataset?.mailbotMessageId;
    if (datasetMessageId) {
      const messageIdIndex = emails.findIndex(email => email.messageId === datasetMessageId);
      if (messageIdIndex !== -1) {
        replyingToMessageIndex = messageIdIndex;
        console.log('[MailBot] 🎯 Reply index matched via message ID:', replyingToMessageIndex,
          'from:', emails[replyingToMessageIndex].fromName);
      }
    }
  }

  if (replyingToMessageIndex === null && editableField && emails.length > 0) {
    const datasetDomId = editableField.dataset?.mailbotMessageDomId;
    if (datasetDomId) {
      const domIndex = emails.findIndex(email => email.domId === datasetDomId);
      if (domIndex !== -1) {
        replyingToMessageIndex = domIndex;
        console.log('[MailBot] 🎯 Reply index matched via DOM id:', replyingToMessageIndex,
          'from:', emails[replyingToMessageIndex].fromName);
      }
    }
  }

  if (replyingToMessageIndex === null && editableField && emails.length > 0) {
    // First attempt: check if the compose field lives inside a specific message element
    const directMatchIndex = emails.findIndex(email => email.element?.contains(editableField));
    if (directMatchIndex !== -1) {
      replyingToMessageIndex = directMatchIndex;
      console.log('[MailBot] 🎯 Reply compose detected within message at index:', replyingToMessageIndex,
        'from:', emails[replyingToMessageIndex].fromName);
    }
  }

  if (replyingToMessageIndex === null && editableField && emails.length > 0) {
    const nearbyMessageEl = editableField.closest('.adn, .adp, .nH[role="region"], .gs');
    if (nearbyMessageEl) {
      const nearbyIndex = emails.findIndex(email => email.element === nearbyMessageEl);
      if (nearbyIndex !== -1) {
        replyingToMessageIndex = nearbyIndex;
        console.log('[MailBot] 🎯 Reply compose linked to closest message at index:', replyingToMessageIndex,
          'from:', emails[replyingToMessageIndex].fromName);
      }
    }
  }

  if (replyingToMessageIndex === null && editableField && emails.length > 0) {
    // Strategy: Find the message element that appears immediately before the compose field in the DOM

    // Get the compose container (walk up the DOM tree)
    let composeContainer = editableField;
    while (composeContainer && !composeContainer.classList.contains('M9')) {
      composeContainer = composeContainer.parentElement;
      if (composeContainer === document.body) {
        composeContainer = null;
        break;
      }
    }

    if (composeContainer) {
      // Walk backwards through siblings to find the nearest message
      let sibling = composeContainer.previousElementSibling;
      while (sibling) {
        // Check if this sibling is or contains a message element
        const messageEl = sibling.classList.contains('adn') ? sibling : sibling.querySelector('.adn.ads');

        if (messageEl) {
          // Find this message in our emails array
          replyingToMessageIndex = emails.findIndex(email => email.element === messageEl);
          if (replyingToMessageIndex !== -1) {
            console.log('[MailBot] 🎯 Detected replying to message at index via sibling traversal:', replyingToMessageIndex,
                       'from:', emails[replyingToMessageIndex].fromName);
            break;
          }
        }
        sibling = sibling.previousElementSibling;
      }
    }

    // Fallback: If we couldn't find a specific message, assume we're replying at the end
    if (replyingToMessageIndex === null) {
      console.log('[MailBot] 📍 Could not detect specific reply position, assuming end of thread');
    }
  }

  // Analyze conversation state with context about which message we're replying to
  const conversationState = analyzeConversationState(emails, currentUserEmail, replyingToMessageIndex);

  // Build full thread text with context markers
  const fullThread = emails.map((email, idx) => {
    const role = email.isFromUser ? '[YOU]' : '[THEM]';
    return `${role} From: ${email.from}\nTo: ${email.to}\n${email.content}`;
  }).join('\n\n---\n\n');

  console.log('[MailBot] Thread context extracted:', {
    subject,
    currentUserEmail,
    messageCount: emails.length,
    conversationState,
    allEmails: emails.map((e, i) => ({
      index: i,
      from: e.fromName,
      to: e.toName,
      isFromUser: e.isFromUser
    }))
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
 * Detect the primary language used in the email thread
 * @param {Array} emails - Array of email objects with content
 * @returns {string} Language description for AI prompt
 */
function detectConversationLanguage(emails) {
  if (!emails || emails.length === 0) {
    return 'English';
  }
  
  // Collect all email content
  const allContent = emails.map(email => email.content).join(' ');
  
  // Simple heuristic: check for common non-English characters/patterns
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(allContent);
  const hasChinese = /[\u4E00-\u9FFF]/.test(allContent) && !hasJapanese;
  const hasKorean = /[\uAC00-\uD7AF]/.test(allContent);
  const hasArabic = /[\u0600-\u06FF]/.test(allContent);
  const hasCyrillic = /[\u0400-\u04FF]/.test(allContent);
  const hasGreek = /[\u0370-\u03FF]/.test(allContent);
  const hasThai = /[\u0E00-\u0E7F]/.test(allContent);
  const hasHebrew = /[\u0590-\u05FF]/.test(allContent);
  
  // Common Spanish/French/German/Italian characters (with accents)
  const hasRomanceAccents = /[àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝŸÑÇ]/.test(allContent);
  
  if (hasJapanese) {
    console.log('[MailBot] Detected language: Japanese');
    return 'Japanese';
  } else if (hasChinese) {
    console.log('[MailBot] Detected language: Chinese');
    return 'Chinese';
  } else if (hasKorean) {
    console.log('[MailBot] Detected language: Korean');
    return 'Korean';
  } else if (hasArabic) {
    console.log('[MailBot] Detected language: Arabic');
    return 'Arabic';
  } else if (hasCyrillic) {
    console.log('[MailBot] Detected language: Russian or other Cyrillic script');
    return 'Russian (or other Cyrillic script language)';
  } else if (hasGreek) {
    console.log('[MailBot] Detected language: Greek');
    return 'Greek';
  } else if (hasThai) {
    console.log('[MailBot] Detected language: Thai');
    return 'Thai';
  } else if (hasHebrew) {
    console.log('[MailBot] Detected language: Hebrew');
    return 'Hebrew';
  } else if (hasRomanceAccents) {
    // Could be Spanish, French, Portuguese, Italian, etc.
    console.log('[MailBot] Detected language: Spanish/French/Portuguese/Italian (Romance language)');
    return 'the same language as the conversation (Spanish, French, Portuguese, Italian, or other Romance language based on context)';
  } else {
    console.log('[MailBot] Detected language: English (default)');
    return 'English';
  }
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
  
  // Detect conversation language
  const detectedLanguage = detectConversationLanguage(threadContext.emails);
  
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
LANGUAGE REQUIREMENT
═══════════════════════════════════════
DETECTED CONVERSATION LANGUAGE: ${detectedLanguage}

⚠️ CRITICAL: Write your ENTIRE response in ${detectedLanguage}.
- Match the language used in the conversation history below
- If the user specifies a different language in their intent, use that instead
- Otherwise, ALWAYS use ${detectedLanguage} to maintain conversation consistency
- Translate ALL parts of the email including greetings, body, and closings to ${detectedLanguage}

═══════════════════════════════════════
USER PREFERENCES
═══════════════════════════════════════
GREETING OPTIONS (translate to ${detectedLanguage} if needed): ${greetings.join(', ')}
- If writing in ${detectedLanguage} and it's not English, translate these greetings appropriately
- Choose a culturally appropriate greeting for ${detectedLanguage}
- Examples: "Hi" → Spanish: "Hola", French: "Bonjour", German: "Hallo"

CLOSING OPTIONS (translate to ${detectedLanguage} if needed): ${closings.join(', ')}
- If writing in ${detectedLanguage} and it's not English, translate these closings appropriately
- Choose a culturally appropriate closing for ${detectedLanguage}
- Examples: "Best regards" → Spanish: "Saludos cordiales", French: "Cordialement", German: "Mit freundlichen Grüßen"
- Always sign with: ${userDisplayName}

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
❌ DO NOT use English greetings/closings if writing in ${detectedLanguage} (unless it's English)
✓ DO write from ${userDisplayName}'s perspective using first-person
✓ DO address ${recipientName} or use general greetings
✓ DO translate greetings to ${detectedLanguage}: ${greetings.join(', ')} → use appropriate ${detectedLanguage} equivalents
✓ DO translate closings to ${detectedLanguage}: ${closings.join(', ')} → use appropriate ${detectedLanguage} equivalents
✓ DO sign with "${userDisplayName}" or just your first name
✓ YOU ARE ${userDisplayName}, NOT ${recipientName}
✓ EVERYTHING must be in ${detectedLanguage} - greetings, body, AND closings

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

    // Extract email context (pass editableField to detect reply position)
    const threadContext = extractThreadContext(editableField);
    
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
 * Create and inject dual-mode MailBot pill (Compose | Summarize)
 * @param {HTMLElement} editableField - The contenteditable text field element
 * @param {HTMLElement} container - The mailbot container element
 * @param {string} type - Type of compose box
 */
function injectDualModePill(editableField, container, type) {
  const dualPill = document.createElement('div');
  dualPill.className = 'mailbot-dual-pill';
  
  // Create Compose button
  const composeBtn = document.createElement('button');
  composeBtn.className = 'mailbot-mode-btn mailbot-compose-btn';
  composeBtn.textContent = 'Compose';
  composeBtn.setAttribute('data-mode', 'compose');
  
  // Create Summarize button
  const summarizeBtn = document.createElement('button');
  summarizeBtn.className = 'mailbot-mode-btn mailbot-summarize-btn';
  summarizeBtn.textContent = 'Summarize';
  summarizeBtn.setAttribute('data-mode', 'summarize');
  
  dualPill.appendChild(composeBtn);
  dualPill.appendChild(summarizeBtn);
  
  // Style the dual pill container
  dualPill.style.display = 'inline-flex';
  dualPill.style.background = '#000000';
  dualPill.style.border = '1.5px solid #000000';
  dualPill.style.borderRadius = '16px';
  dualPill.style.padding = '8px 12px';  // Increased padding for larger draggable area
  dualPill.style.gap = '12px';  // Increased gap between buttons for easier dragging
  dualPill.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  dualPill.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  dualPill.style.cursor = 'grab';  // Show grab cursor on the container
  
  // Style individual mode buttons
  [composeBtn, summarizeBtn].forEach(btn => {
    btn.style.padding = '8px 16px';
    btn.style.background = 'transparent';
    btn.style.color = 'rgba(255, 255, 255, 0.6)';
    btn.style.border = 'none';
    btn.style.borderRadius = '12px';
    btn.style.cursor = 'pointer';  // Pointer cursor on buttons
    btn.style.fontSize = '14px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s ease';
    btn.style.whiteSpace = 'nowrap';
    btn.style.pointerEvents = 'auto'; // Ensure buttons are clickable
  });
  
  // Compose is active by default
  composeBtn.style.background = '#ffffff';
  composeBtn.style.color = '#000000';
  
  // Event listeners for mode switching (will be checked in drag logic)
  composeBtn.addEventListener('click', (e) => {
    openComposeMode(editableField, container, composeBtn, summarizeBtn);
    e.stopPropagation(); // Prevent event from bubbling to pill
  });
  summarizeBtn.addEventListener('click', (e) => {
    openSummarizeMode(editableField, container, composeBtn, summarizeBtn);
    e.stopPropagation(); // Prevent event from bubbling to pill
  });
  
  return dualPill;
}

/**
 * Open Compose mode (existing behavior)
 */
function openComposeMode(editableField, container, composeBtn, summarizeBtn) {
  console.log('[MailBot] Opening Compose mode');
  
  // Update button states
  composeBtn.style.background = '#ffffff';
  composeBtn.style.color = '#000000';
  summarizeBtn.style.background = 'transparent';
  summarizeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
  
  // Hide summarize panel if visible
  const summarizePanel = container.querySelector('.mailbot-summarize-panel');
  if (summarizePanel) {
    summarizePanel.style.display = 'none';
  }
  
  // Show compose expanded panel
  const expandedPanel = container.querySelector('.mailbot-expanded');
  if (expandedPanel) {
    expandedPanel.style.display = 'flex';
    expandedPanel.style.opacity = '1';
    const input = expandedPanel.querySelector('.mailbot-input');
    if (input) input.focus();
  }
  
  container.setAttribute('data-state', 'compose');
}

/**
 * Open Summarize mode
 */
function openSummarizeMode(editableField, container, composeBtn, summarizeBtn) {
  console.log('[MailBot] Opening Summarize mode');
  
  // Update button states
  summarizeBtn.style.background = '#ffffff';
  summarizeBtn.style.color = '#000000';
  composeBtn.style.background = 'transparent';
  composeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
  
  // Hide compose panel
  const expandedPanel = container.querySelector('.mailbot-expanded');
  if (expandedPanel) {
    expandedPanel.style.display = 'none';
  }
  
  // Show or create summarize panel
  let summarizePanel = container.querySelector('.mailbot-summarize-panel');
  if (!summarizePanel) {
    summarizePanel = createSummarizePanel(editableField);
    container.appendChild(summarizePanel);
  }
  
  summarizePanel.style.display = 'flex';
  summarizePanel.style.opacity = '1';
  
  container.setAttribute('data-state', 'summarize');
}

/**
 * Create the Summarize panel UI shell
 */
function createSummarizePanel(editableField) {
  const panel = document.createElement('div');
  panel.className = 'mailbot-summarize-panel';
  
  panel.innerHTML = `
    <div class="mb-summary-header">
      <span class="mb-summary-title">Thread Summary</span>
      <button class="mb-summary-close" title="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10 2L4 8L10 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    
    <div class="mb-summary-controls">
      <div class="mb-summary-level">
        <button class="mb-level-btn mb-level-active" data-level="concise">Concise</button>
        <button class="mb-level-btn" data-level="detailed">Detailed</button>
      </div>
      
      <div class="mb-summary-toggle">
        <button class="mb-toggle-btn mb-toggle-active" data-view="summary">Summary</button>
        <button class="mb-toggle-btn" data-view="actions">Action Items</button>
      </div>
    </div>
    
    <div class="mb-summary-body" contenteditable="false" aria-readonly="true" tabindex="-1">Click Generate to summarize thread</div>
    
    <div class="mb-summary-actions">
      <button class="mb-summary-generate">Generate</button>
      <button class="mb-summary-copy" disabled>Copy</button>
      <button class="mb-summary-insert" disabled>Insert</button>
    </div>
    
    <div class="mb-summary-meta">
      <span>Generated · <span class="mb-message-count">—</span> messages · Last updated: <span class="mb-last-updated">—</span></span>
    </div>
  `;
  
  // Style the panel
  styleSummarizePanel(panel);
  
  // Add event listeners
  attachSummarizePanelListeners(panel, editableField);
  
  return panel;
}

/**
 * Style the Summarize panel
 */
function styleSummarizePanel(panel) {
  panel.style.display = 'none';
  panel.style.flexDirection = 'column';
  panel.style.background = '#000000';
  panel.style.border = '1.5px solid #000000';
  panel.style.borderRadius = '16px';
  panel.style.padding = '16px 20px';
  panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  panel.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  panel.style.minWidth = '500px';
  panel.style.maxWidth = '700px';
  panel.style.gap = '12px';
  panel.style.opacity = '1';
  
  // Header
  const header = panel.querySelector('.mb-summary-header');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '8px';
  
  const title = panel.querySelector('.mb-summary-title');
  title.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  title.style.fontSize = '15px';
  title.style.fontWeight = '600';
  title.style.color = 'rgba(255, 255, 255, 0.9)';
  title.style.marginBottom = '6px';
  title.style.lineHeight = 'normal';
  
  const closeBtn = panel.querySelector('.mb-summary-close');
  closeBtn.style.padding = '8px';
  closeBtn.style.background = '#ffffff';
  closeBtn.style.color = '#000000';
  closeBtn.style.border = 'none';
  closeBtn.style.borderRadius = '50%';
  closeBtn.style.width = '32px';
  closeBtn.style.height = '32px';
  closeBtn.style.display = 'flex';
  closeBtn.style.alignItems = 'center';
  closeBtn.style.justifyContent = 'center';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.transition = 'all 0.2s ease';
  
  // Add hover effects to close button
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = '#e8e8e8';
    closeBtn.style.transform = 'scale(1.05)';
  });
  
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = '#ffffff';
    closeBtn.style.transform = 'scale(1)';
  });
  
  // Controls container
  const controls = panel.querySelector('.mb-summary-controls');
  controls.style.display = 'flex';
  controls.style.justifyContent = 'space-between';
  controls.style.alignItems = 'center';
  controls.style.gap = '12px';
  controls.style.flexWrap = 'wrap';
  
  // Level selector
  const levelDiv = panel.querySelector('.mb-summary-level');
  levelDiv.style.display = 'flex';
  levelDiv.style.gap = '4px';
  levelDiv.style.background = '#1a1a1a';
  levelDiv.style.padding = '4px';
  levelDiv.style.borderRadius = '12px';
  
  panel.querySelectorAll('.mb-level-btn').forEach(btn => {
    btn.style.padding = '6px 12px';
    btn.style.background = 'transparent';
    btn.style.color = 'rgba(255, 255, 255, 0.6)';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s ease';
  });
  
  const activeLevel = panel.querySelector('.mb-level-active');
  if (activeLevel) {
    activeLevel.style.background = '#ffffff';
    activeLevel.style.color = '#000000';
  }
  
  // Toggle (Summary/Action Items)
  const toggleDiv = panel.querySelector('.mb-summary-toggle');
  toggleDiv.style.display = 'flex';
  toggleDiv.style.gap = '4px';
  toggleDiv.style.background = '#1a1a1a';
  toggleDiv.style.padding = '4px';
  toggleDiv.style.borderRadius = '12px';
  
  panel.querySelectorAll('.mb-toggle-btn').forEach(btn => {
    btn.style.padding = '6px 16px';
    btn.style.background = 'transparent';
    btn.style.color = 'rgba(255, 255, 255, 0.6)';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s ease';
  });
  
  const activeToggle = panel.querySelector('.mb-toggle-active');
  if (activeToggle) {
    activeToggle.style.background = '#ffffff';
    activeToggle.style.color = '#000000';
  }
  
  // Body (editable content area)
  const body = panel.querySelector('.mb-summary-body');
  body.style.padding = '12px';
  body.style.background = '#1a1a1a';
  body.style.border = '1.5px solid #333333';
  body.style.borderRadius = '12px';
  body.style.color = '#ffffff';
  body.style.fontSize = '14px';
  body.style.lineHeight = '1.6';
  body.style.minHeight = '150px';
  body.style.maxHeight = '400px';
  body.style.overflowY = 'auto';
  body.style.outline = 'none';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordWrap = 'break-word';
  body.style.textAlign = 'left';
  body.style.verticalAlign = 'top';
  body.style.display = 'flex';
  body.style.alignItems = 'flex-start';
  body.style.justifyContent = 'flex-start';
  
  // Action buttons
  const actions = panel.querySelector('.mb-summary-actions');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.justifyContent = 'flex-end';
  
  panel.querySelectorAll('.mb-summary-actions button').forEach(btn => {
    btn.style.padding = '10px 20px';
    btn.style.background = '#ffffff';
    btn.style.color = '#000000';
    btn.style.border = '1.5px solid #ffffff';
    btn.style.borderRadius = '20px';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = '500';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s ease';
    btn.style.whiteSpace = 'nowrap';
    btn.style.letterSpacing = '0.3px';
    btn.style.pointerEvents = 'auto';  // Ensure buttons respond to clicks even when disabled
    
    // Add hover effects matching Compose panel buttons (always active, even when disabled)
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#e8e8e8';
      btn.style.transform = 'scale(1.02)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#ffffff';
      btn.style.transform = 'scale(1)';
    });
  });
  
  // Metadata line
  const meta = panel.querySelector('.mb-summary-meta');
  meta.style.fontSize = '12px';
  meta.style.color = 'rgba(255, 255, 255, 0.5)';
  meta.style.textAlign = 'center';
}

/**
 * Attach event listeners to Summarize panel
 */
function attachSummarizePanelListeners(panel, editableField) {
  // Close button
  const closeBtn = panel.querySelector('.mb-summary-close');
  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    const container = panel.closest('.mailbot-container');
    if (container) {
      container.setAttribute('data-state', 'collapsed');
    }
  });
  
  // Level selector buttons
  panel.querySelectorAll('.mb-level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.mb-level-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'rgba(255, 255, 255, 0.6)';
        b.classList.remove('mb-level-active');
      });
      btn.style.background = '#ffffff';
      btn.style.color = '#000000';
      btn.classList.add('mb-level-active');
      
      // If content has been generated, switch to the appropriate version
      if (summaryGenerated) {
        const body = panel.querySelector('.mb-summary-body');
        const newLevel = btn.dataset.level;
        const currentView = panel.querySelector('.mb-toggle-active')?.dataset.view || 'summary';
        
        // Switch content based on BOTH current view AND new level
        if (currentView === 'summary') {
          if (newLevel === 'concise' && generatedContent.conciseSummary) {
            body.textContent = generatedContent.conciseSummary;
          } else if (newLevel === 'detailed' && generatedContent.detailedSummary) {
            body.textContent = generatedContent.detailedSummary;
          }
        } else if (currentView === 'actions') {
          if (newLevel === 'concise' && generatedContent.conciseActionItems) {
            body.textContent = generatedContent.conciseActionItems;
          } else if (newLevel === 'detailed' && generatedContent.detailedActionItems) {
            body.textContent = generatedContent.detailedActionItems;
          }
        }
      }
      
      console.log('[MailBot] Summary level changed to:', btn.dataset.level);
    });
  });
  
  // Toggle buttons (Summary/Action Items)
  panel.querySelectorAll('.mb-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.mb-toggle-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'rgba(255, 255, 255, 0.6)';
        b.classList.remove('mb-toggle-active');
      });
      btn.style.background = '#ffffff';
      btn.style.color = '#000000';
      btn.classList.add('mb-toggle-active');
      
      const body = panel.querySelector('.mb-summary-body');
      
      // If content has been generated, switch to the appropriate view
      if (summaryGenerated) {
        const newView = btn.dataset.view;
        const activeLevel = panel.querySelector('.mb-level-active')?.dataset.level || 'concise';
        
        // Switch content based on BOTH new view AND current level
        if (newView === 'actions') {
          if (activeLevel === 'concise' && generatedContent.conciseActionItems) {
            body.textContent = generatedContent.conciseActionItems;
          } else if (activeLevel === 'detailed' && generatedContent.detailedActionItems) {
            body.textContent = generatedContent.detailedActionItems;
          }
        } else if (newView === 'summary') {
          if (activeLevel === 'concise' && generatedContent.conciseSummary) {
            body.textContent = generatedContent.conciseSummary;
          } else if (activeLevel === 'detailed' && generatedContent.detailedSummary) {
            body.textContent = generatedContent.detailedSummary;
          }
        }
      } else {
        // No content generated yet, show placeholder
        if (btn.dataset.view === 'actions') {
          body.textContent = 'Action items will appear here after generation';
        } else {
          body.textContent = 'Click Generate to summarize thread';
        }
      }
      
      console.log('[MailBot] View switched to:', btn.dataset.view);
    });
  });
  
  // Generate button with AI summarization
  const generateBtn = panel.querySelector('.mb-summary-generate');
  let summaryGenerated = false;  // Track if summary has been generated
  let generatedContent = {
    conciseSummary: null,
    detailedSummary: null,
    conciseActionItems: null,
    detailedActionItems: null
  };  // Store all generated content
  
  generateBtn.addEventListener('click', async () => {
    console.log('[MailBot] Generate Summary clicked');
    const body = panel.querySelector('.mb-summary-body');
    const activeView = panel.querySelector('.mb-toggle-active')?.dataset.view || 'summary';
    const activeLevel = panel.querySelector('.mb-level-active')?.dataset.level || 'concise';
    
    // Show loading state
    generateBtn.textContent = 'Generating...';
    generateBtn.disabled = true;
    generateBtn.style.opacity = '0.6';
    body.textContent = 'Analyzing email thread and extracting insights...';
    body.style.color = '#ffffff';
    
    try {
      // Extract thread context
      const threadContext = extractThreadContext(editableField);
      
      if (!threadContext.emails || threadContext.emails.length === 0) {
        throw new Error('No email messages found in thread');
      }
      
      console.log('[MailBot] Thread extracted:', {
        messageCount: threadContext.messageCount,
        subject: threadContext.subject
      });
      
      // Check if AI is available (same approach as Compose panel)
      if (!('LanguageModel' in self)) {
        throw new Error('Gemini Nano API is not available. Please ensure:\n\n1. Chrome Canary/Dev 127+\n2. Flags are enabled\n3. Model is downloaded from chrome://components');
      }
      
      console.log('[MailBot] Creating AI session for summarization...');
      
      // Create AI session (same as Compose panel)
      const session = await LanguageModel.create({
        systemPrompt: 'You are an AI assistant that summarizes email threads clearly and concisely.'
      });
      
      console.log('[MailBot] AI session created successfully');
      
      // Build conversation history
      const conversationHistory = threadContext.emails.map((email, idx) => {
        const role = email.isFromUser ? '[YOU]' : `[${email.fromName || 'Other'}]`;
        const timestamp = email.timestamp ? new Date(email.timestamp).toLocaleString() : '';
        return `Message ${idx + 1} ${timestamp ? `(${timestamp})` : ''}:\n${role}\nFrom: ${email.fromName || email.from}\nTo: ${email.toName || email.to}\n\n${email.content}`;
      }).join('\n\n═══════════════════════════════════════\n\n');
      
      // Generate all three versions in sequence
      console.log('[MailBot] Generating concise summary...');
      body.textContent = 'Generating concise summary...';
      const concisePrompt = `You are summarizing an email thread for quick understanding.

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

INSTRUCTIONS:
Write a brief, concise summary in 2-3 sentences. Focus only on the most important points.

- Use clear, professional language
- Focus on the main topic and key points
- Identify any decisions, agreements, or action items mentioned
- Keep it informative but easy to scan
- Do NOT include greetings or closings
- Do NOT address anyone directly
- Write in third person or neutral perspective

YOUR SUMMARY:`;
      
      generatedContent.conciseSummary = (await session.prompt(concisePrompt)).trim();
      console.log('[MailBot] ✓ Concise summary generated');
      
      // Generate detailed summary
      console.log('[MailBot] Generating detailed summary...');
      body.textContent = 'Generating detailed summary...';
      const detailedPrompt = `You are summarizing an email thread for quick understanding.

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

INSTRUCTIONS:
Write a detailed summary covering all major points discussed. Include context, key decisions, and important details. Use 4-6 sentences.

- Use clear, professional language
- Focus on the main topic and key points
- Identify any decisions, agreements, or action items mentioned
- Keep it informative but easy to scan
- Do NOT include greetings or closings
- Do NOT address anyone directly
- Write in third person or neutral perspective

YOUR SUMMARY:`;
      
      generatedContent.detailedSummary = (await session.prompt(detailedPrompt)).trim();
      console.log('[MailBot] ✓ Detailed summary generated');
      
      // Generate concise action items
      console.log('[MailBot] Extracting concise action items...');
      body.textContent = 'Extracting concise action items...';
      const conciseActionItemsPrompt = `You are extracting action items from an email thread.

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

INSTRUCTIONS:
List only the most critical action items. Be brief.

- Extract clear, actionable tasks mentioned in the thread
- Include who is responsible if mentioned
- Include deadlines if mentioned
- Format as a bulleted list using "•" or "-"
- If no action items are found, respond with: "No specific action items identified in this thread."
- Keep each item very concise
- Focus only on the most important next steps

ACTION ITEMS:`;
      
      generatedContent.conciseActionItems = (await session.prompt(conciseActionItemsPrompt)).trim();
      console.log('[MailBot] ✓ Concise action items extracted');
      
      // Generate detailed action items
      console.log('[MailBot] Extracting detailed action items...');
      body.textContent = 'Extracting detailed action items...';
      const detailedActionItemsPrompt = `You are extracting action items from an email thread.

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

INSTRUCTIONS:
List all action items with relevant context and details.

- Extract clear, actionable tasks mentioned in the thread
- Include who is responsible if mentioned
- Include deadlines if mentioned
- Format as a bulleted list using "•" or "-"
- If no action items are found, respond with: "No specific action items identified in this thread."
- Keep each item concise and actionable
- Include relevant context for each action item
- Focus on concrete next steps, not vague statements

ACTION ITEMS:`;
      
      generatedContent.detailedActionItems = (await session.prompt(detailedActionItemsPrompt)).trim();
      console.log('[MailBot] ✓ Detailed action items extracted');
      
      // Clean up session
      session.destroy();
      
      console.log('[MailBot] ✓ All content generated successfully');
      
      // Display the appropriate content based on current view AND level
      if (activeView === 'summary') {
        body.textContent = activeLevel === 'concise' ? generatedContent.conciseSummary : generatedContent.detailedSummary;
      } else {
        body.textContent = activeLevel === 'concise' ? generatedContent.conciseActionItems : generatedContent.detailedActionItems;
      }
      body.style.color = '#ffffff';
      
      // Update metadata
      panel.querySelector('.mb-message-count').textContent = threadContext.messageCount;
      panel.querySelector('.mb-last-updated').textContent = new Date().toLocaleTimeString();
      
      // Mark as generated and enable editing
      summaryGenerated = true;
      body.contentEditable = 'true';
      body.setAttribute('aria-readonly', 'false');
      body.setAttribute('tabindex', '0');
      body.focus();
      
      // Enable Copy and Insert buttons
      copyBtn.disabled = false;
      insertBtn.disabled = false;
      
    } catch (error) {
      console.error('[MailBot] ✗ Summary generation failed:', error);
      body.textContent = `Failed to generate summary: ${error.message}`;
      body.style.color = '#ff4444';
    } finally {
      // Reset button
      generateBtn.textContent = 'Generate';
      generateBtn.disabled = false;
      generateBtn.style.opacity = '1';
    }
  });
  
  // Copy button
  const copyBtn = panel.querySelector('.mb-summary-copy');
  copyBtn.addEventListener('click', () => {
    if (!summaryGenerated) {
      // Show visual feedback
      const body = panel.querySelector('.mb-summary-body');
      const originalText = body.textContent;
      body.textContent = 'Please click "Generate" first...';
      body.style.color = '#ff4444';
      setTimeout(() => {
        body.textContent = originalText;
        body.style.color = '#ffffff';
      }, 2000);
      return;
    }
    
    const body = panel.querySelector('.mb-summary-body');
    navigator.clipboard.writeText(body.textContent).then(() => {
      console.log('[MailBot] Summary copied to clipboard');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 2000);
    });
  });
  
  // Insert button
  const insertBtn = panel.querySelector('.mb-summary-insert');
  insertBtn.addEventListener('click', () => {
    if (!summaryGenerated) {
      // Show visual feedback
      const body = panel.querySelector('.mb-summary-body');
      const originalText = body.textContent;
      body.textContent = 'Please click "Generate" first...';
      body.style.color = '#ff4444';
      setTimeout(() => {
        body.textContent = originalText;
        body.style.color = '#ffffff';
      }, 2000);
      return;
    }
    
    const body = panel.querySelector('.mb-summary-body');
    if (editableField) {
      editableField.textContent = body.textContent;
      editableField.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('[MailBot] Summary inserted into compose field');
    }
  });
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

  // Capture message metadata so we know which part of the thread this compose relates to
  const messageMetadata = findMessageMetadataForEditable(editableField);
  if (messageMetadata.threadIndex !== null && messageMetadata.threadIndex >= 0) {
    editableField.dataset.mailbotMessageIndex = String(messageMetadata.threadIndex);
  }
  if (messageMetadata.legacyMessageId) {
    editableField.dataset.mailbotLegacyMessageId = messageMetadata.legacyMessageId;
  }
  if (messageMetadata.messageId) {
    editableField.dataset.mailbotMessageId = messageMetadata.messageId;
  }
  if (messageMetadata.messageElement?.id) {
    editableField.dataset.mailbotMessageDomId = messageMetadata.messageElement.id;
  }
  
  // Create container that will hold both collapsed and expanded states
  const container = document.createElement('div');
  container.className = 'mailbot-container';
  container.setAttribute('data-mailbot-type', type);
  container.setAttribute('data-field-id', editableField._mailbotId);
  container.setAttribute('data-state', 'collapsed'); // Track UI state
  
  // Create dual-mode pill (Compose | Summarize)
  const dualPill = injectDualModePill(editableField, container, type);
  
  // Legacy reference for backward compatibility
  const collapsedBtn = dualPill; // Use dual pill as the "collapsed" button
  
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
  
  // Reference for easier access (dual pill acts as the collapsed button)
  const btn = dualPill;
  
  // Different styling based on type
  if (type === 'inline') {
    // CONTAINER STYLING (for inline replies - fixed positioning to float above)
    container.style.position = 'fixed';
    container.style.zIndex = '9999999';
    container.style.pointerEvents = 'auto';
    container.style.userSelect = 'none';
    
    // Dual pill styling already applied in injectDualModePill(), just add positioning properties
    btn.style.cursor = 'grab';
    btn.style.transition = 'all 0.2s ease';
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
    label.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    label.style.fontSize = '14px';
    label.style.fontWeight = '600';
    label.style.color = 'rgba(255, 255, 255, 0.9)';
    label.style.marginBottom = '6px';
    label.style.whiteSpace = 'nowrap';
    label.style.marginRight = '8px';
    label.style.cursor = 'grab';  // Label is draggable
    label.style.padding = '0';  // Reset default label padding
    label.style.lineHeight = 'normal';  // Reset line height
    
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
    input.style.cursor = 'text';  // Text cursor to indicate it's an input field
    
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
      // Default to Compose mode when expanding
      const composeBtn = container.querySelector('.mailbot-compose-btn');
      const summarizeBtn = container.querySelector('.mailbot-summarize-btn');
      
      if (composeBtn && summarizeBtn) {
        openComposeMode(editableField, container, composeBtn, summarizeBtn);
      } else {
        // Fallback for legacy behavior
        container.setAttribute('data-state', 'expanded');
      }
      
      // Fade out dual pill
      btn.style.transition = 'opacity 0.2s ease';
      btn.style.opacity = '0';
      
      // After fade out, hide pill and show expanded panel
      setTimeout(() => {
        btn.style.display = 'none';
        expandedPanel.style.display = 'flex';
        expandedPanel.style.opacity = '0';
        
        // Trigger reflow to ensure transition works
        expandedPanel.offsetHeight;
        
        // Fade in expanded panel
        expandedPanel.style.transition = 'opacity 0.2s ease';
        expandedPanel.style.opacity = '1';
        
        // Restore preview AFTER expanded panel finishes fading in
        if (generatedText) {
          setTimeout(() => {
            previewContainer.style.display = 'block';
            previewContainer.style.opacity = '0';
            
            // Trigger reflow
            previewContainer.offsetHeight;
            
            // Fade in preview
            previewContainer.style.transition = 'opacity 0.2s ease';
            previewContainer.style.opacity = '1';
            positionPreview();
            console.log('[MailBot] Restored previous work');
          }, 200); // Wait for expanded panel fade to complete
        }
        
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
        
        // DO NOT clear input or generated text - preserve user's work!
        // input.value and generatedText are retained so user can resume
      }, 200); // Match fade out duration
      
      console.log('[MailBot] Collapsed UI - work preserved');
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
        // Get thread context with enhanced metadata (pass editableField to detect reply position)
        const threadContext = extractThreadContext(editableField);
        
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
    let isDraggingGlobal = false;
    let dragStartPos = null;  // Track initial click position
    
    function onMouseDown(e) {
      // Allow drag in both states, but from specific elements
      const isCollapsed = container.getAttribute('data-state') === 'collapsed';
      
      if (isCollapsed) {
        // In collapsed state, allow drag from anywhere on dual pill
        // We'll detect if it's a drag or click based on movement distance
      } else {
        // In expanded state, allow drag from the panel background, label, or dual pill (not from inputs/buttons inside panel)
        const clickedElement = e.target;
        const isDraggableArea = 
          clickedElement === expandedPanel ||
          clickedElement.classList.contains('mailbot-label') ||
          clickedElement.classList.contains('mailbot-dual-pill') ||
          clickedElement.classList.contains('mailbot-mode-btn') ||
          clickedElement.classList.contains('mailbot-compose-btn') ||
          clickedElement.classList.contains('mailbot-summarize-btn') ||
          clickedElement === container;
        
        if (!isDraggableArea) return;
      }
      
      // Store initial click position to detect movement
      dragStartPos = {
        x: e.clientX,
        y: e.clientY
      };
      
      isDragging = true;
      
      // Set cursor on the appropriate element
      if (isCollapsed) {
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
      } else {
        expandedPanel.style.cursor = 'grabbing';
        expandedPanel.style.transition = 'none';
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
      }
      
      const rect = container.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      
      e.preventDefault();
      e.stopPropagation();
    }
    
    function onMouseMove(e) {
      if (!isDragging) return;
      
      // Check if we've moved enough to consider this a real drag
      if (dragStartPos && !isDraggingGlobal) {
        const moveDistance = Math.sqrt(
          Math.pow(e.clientX - dragStartPos.x, 2) +
          Math.pow(e.clientY - dragStartPos.y, 2)
        );
        
        // If moved more than 5px, set the global drag flag
        if (moveDistance > 5) {
          isDraggingGlobal = true;
        }
      }
      
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
      
      // Calculate movement distance from initial click
      let moveDistance = 0;
      if (dragStartPos) {
        moveDistance = Math.sqrt(
          Math.pow(e.clientX - dragStartPos.x, 2) +
          Math.pow(e.clientY - dragStartPos.y, 2)
        );
      }
      
      // Reset cursor based on state
      if (isCollapsed) {
        btn.style.cursor = 'grab';
        btn.style.transition = 'all 0.2s ease';
      } else {
        expandedPanel.style.cursor = 'grab';  // Keep grab cursor to show it's still draggable
        expandedPanel.style.transition = 'all 0.2s ease';
      }
      
      // If this was a click (< 5px movement), handle appropriately
      if (moveDistance < 5 && isCollapsed) {
        const target = e.target;
        const isModeBtnClick = target.classList.contains('mailbot-mode-btn') ||
                              target.classList.contains('mailbot-compose-btn') ||
                              target.classList.contains('mailbot-summarize-btn');
        
        if (!isModeBtnClick) {
          // Clicked on pill background (not a button), expand panel
          expandPanel();
        }
        // If clicked on a button, the button's click handler will fire naturally
      } else if (moveDistance >= 5) {
        // This was a drag - prevent button clicks by stopping propagation
        e.stopImmediatePropagation();
      }
      
      // Reset drag state
      setTimeout(() => {
        isDraggingGlobal = false;
        dragStartPos = null;
      }, 10);
      
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

      // Extract thread context (pass editableField to detect reply position)
      const threadContext = extractThreadContext(editableField);
      
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
