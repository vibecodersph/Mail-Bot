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
  
  // Check if this is a brand new compose (no existing thread)
  const isNewCompose = !threadContext.emails || threadContext.emails.length === 0;
  
  // Build comprehensive prompt
  const prompt = `You are writing an email on behalf of ${userEmail}.
Your name is: ${userDisplayName}
${isNewCompose ? `You are writing a NEW email.` : `You are ${userDisplayName} writing to ${recipientName}.`}

═══════════════════════════════════════
IDENTITY DECLARATION
═══════════════════════════════════════
YOUR IDENTITY: ${userEmail}
- Your name: ${userDisplayName}
- This is YOUR email address
- You are the SENDER of this email
- Write from first-person perspective (I, me, my)

${isNewCompose ? `RECIPIENT: Unknown (user will fill in)
- Write the email body only
- Use appropriate greeting (Hi, Hello, etc.)` : `RECIPIENT IDENTITY: ${recipientEmail}
- Their name: ${recipientName}
- This is who you are writing TO
- Address them in the email (or use "Hi", "Hello")
- DO NOT address yourself (${userDisplayName})`}

═══════════════════════════════════════
LANGUAGE REQUIREMENT
═══════════════════════════════════════
DETECTED CONVERSATION LANGUAGE: ${detectedLanguage}

⚠️ CRITICAL: Write your ENTIRE response in ${detectedLanguage}.
${isNewCompose ? `- Default to English unless user's intent specifies another language` : `- Match the language used in the conversation history below`}
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
${isNewCompose ? 'NEW EMAIL (No existing conversation)' : 'CONVERSATION HISTORY'}
═══════════════════════════════════════
${isNewCompose ? 'This is a brand new email. No previous thread exists.' : `SUBJECT: ${threadContext.subject}

${conversationHistory}`}

${isNewCompose ? '' : `═══════════════════════════════════════
CURRENT SITUATION
═══════════════════════════════════════
${situationAnalysis}

- Thread length: ${conversationState.threadLength} message(s)
- Last sender: ${conversationState.lastSenderWasUser ? `YOU (${userEmail})` : conversationState.respondingTo || 'Other party'}
- Message type: ${conversationState.isFollowUp ? 'Follow-up' : conversationState.respondingTo ? 'Response' : 'New message'}`}

═══════════════════════════════════════
USER'S INTENT
═══════════════════════════════════════
${userIntent}

═══════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════
Write a ${toneInstructions[tone] || 'professional'} email that:

1. ✓ Starts with an appropriate greeting: ${greetings.join(', ')}
2. ✓ Is from ${userEmail}'s perspective (use "I", "my", "me")
${isNewCompose ? '' : `3. ✓ Addresses ${recipientEmail} (not yourself)`}
3. ✓ Accomplishes this intent: "${userIntent}"
${isNewCompose ? '' : `5. ✓ Maintains appropriate context from the conversation`}
4. ✓ Uses a ${tone} tone
5. ✓ Length: ${isNewCompose ? '8-12 sentences with full context and details. Since this is a NEW email starting a conversation, provide comprehensive background, clear purpose, and sufficient elaboration' : lengthInstructions[emailLength]}
6. ✓ Is ready to send (no placeholders like [insert X])
7. ✓ Does NOT include "Subject:" or "Re:" lines (Gmail handles that)
8. ✓ Ends with one of: ${closings.join(', ')}
9. ✓ Signs as "${userDisplayName}"${isNewCompose ? '' : ` NOT "${recipientName}"`}
10. ✓ FORMAT CLOSING PROPERLY: Put closing on its own line, then name on next line
    Example:
    Regards,
    ${userDisplayName}
    
    NOT: Regards, ${userDisplayName}
${conversationState.isFollowUp ? '11. ✓ Clearly indicates this is a follow-up' : ''}
${conversationState.respondingTo ? '11. ✓ Directly responds to their message' : ''}

CRITICAL REMINDERS:
❌ DO NOT write "Dear ${userDisplayName}" or "Hi ${userDisplayName}" - that's you!
❌ DO NOT write about ${userDisplayName} in third person - use "I"
❌ DO NOT include "Subject: Re: ..." in the email body
❌ DO NOT simply restate the user's intent - WRITE THE ACTUAL EMAIL
❌ DO NOT output instructions or meta-text - ONLY output the email content
${isNewCompose ? '' : `❌ DO NOT sign with "${recipientName}" - that's the RECIPIENT, not you!
❌ DO NOT sign with "${recipientEmail}" - that's who you're writing TO!`}
❌ DO NOT use English greetings/closings if writing in ${detectedLanguage} (unless it's English)
✓ DO write from ${userDisplayName}'s perspective using first-person
${isNewCompose ? '' : `✓ DO address ${recipientName} or use general greetings`}
✓ DO translate greetings to ${detectedLanguage}: ${greetings.join(', ')} → use appropriate ${detectedLanguage} equivalents
✓ DO translate closings to ${detectedLanguage}: ${closings.join(', ')} → use appropriate ${detectedLanguage} equivalents
✓ DO sign with "${userDisplayName}" or just your first name
${isNewCompose ? '' : `✓ YOU ARE ${userDisplayName}, NOT ${recipientName}`}
✓ EVERYTHING must be in ${detectedLanguage} - greetings, body, AND closings
✓ WRITE THE ACTUAL EMAIL - not meta-commentary about writing it

═══════════════════════════════════════
OUTPUT THE COMPLETE EMAIL NOW (from ${userEmail}${isNewCompose ? '' : ` to ${recipientEmail}`}):
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
  console.log('[MailBot] AI raw output:', result.substring(0, 200));
  
  // Clean up session
  session.destroy();
  
  // Unescape any literal \n sequences if AI outputted them
  if (result.includes('\\n')) {
    console.log('[MailBot] ⚠️ Found literal \\n sequences, unescaping...');
    result = result.replace(/\\n/g, '\n');
  }
  
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
 * @param {string} text - The generated text to insert (already includes signature)
 */
function insertReplyText(editableField, text) {
  if (!editableField) return;
  
  // Clear existing content
  editableField.innerHTML = '';
  
  // Insert new text (signature is already included from generation)
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
  dualPill.style.background = 'rgba(30, 31, 34, 0.95)';
  dualPill.style.backdropFilter = 'blur(12px) saturate(180%)';
  dualPill.style.webkitBackdropFilter = 'blur(12px) saturate(180%)';
  dualPill.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
  dualPill.style.borderRadius = '12px';
  dualPill.style.padding = '6px';
  dualPill.style.gap = '4px';
  dualPill.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
  dualPill.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  dualPill.style.cursor = 'grab';
  dualPill.style.marginBottom = '12px';
  
  // Style individual mode buttons
  [composeBtn, summarizeBtn].forEach(btn => {
    btn.style.padding = '8px 20px';
    btn.style.background = 'transparent';
    btn.style.color = 'rgba(232, 234, 237, 0.6)';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    btn.style.whiteSpace = 'nowrap';
    btn.style.pointerEvents = 'auto';
    btn.style.minWidth = '90px';
    btn.style.letterSpacing = '0.01em';
  });
  
  // Compose is active by default
  composeBtn.style.background = '#ffffff';
  composeBtn.style.color = '#000000';
  composeBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
  
  // Add hover micro-interactions with lift
  [composeBtn, summarizeBtn].forEach(btn => {
    btn.addEventListener('mouseenter', function() {
      const isActive = this.style.background === '#ffffff' || this.style.background === 'rgb(255, 255, 255)';
      if (isActive) {
        this.style.transform = 'translateY(-1px)';
        this.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.3)';
      } else {
        this.style.background = 'rgba(58, 59, 62, 0.5)';
        this.style.color = '#E8EAED';
      }
    });
    
    btn.addEventListener('mouseleave', function() {
      const isActive = this.style.background === '#ffffff' || this.style.background === 'rgb(255, 255, 255)';
      if (isActive) {
        this.style.transform = 'none';
        this.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
      } else {
        this.style.background = 'transparent';
        this.style.color = 'rgba(232, 234, 237, 0.6)';
      }
    });
  });
  
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
  
  // Update button states with smooth transitions
  composeBtn.style.background = '#ffffff';
  composeBtn.style.color = '#000000';
  composeBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
  composeBtn.style.transform = 'none';
  
  summarizeBtn.style.background = 'transparent';
  summarizeBtn.style.color = 'rgba(232, 234, 237, 0.6)';
  summarizeBtn.style.boxShadow = 'none';
  summarizeBtn.style.transform = 'none';
  
  // Hide summarize panel if visible
  const summarizePanel = container.querySelector('.mailbot-summarize-panel');
  if (summarizePanel) {
    summarizePanel.style.display = 'none';
  }
  
  // Hide summarize preview container if visible (it's appended to body)
  const summarizePreview = document.querySelector('.mailbot-summarize-preview');
  if (summarizePreview && summarizePreview.parentNode) {
    summarizePreview.style.display = 'none';
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
  
  // Update button states with smooth transitions
  summarizeBtn.style.background = '#ffffff';
  summarizeBtn.style.color = '#000000';
  summarizeBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
  summarizeBtn.style.transform = 'none';
  
  composeBtn.style.background = 'transparent';
  composeBtn.style.color = 'rgba(232, 234, 237, 0.6)';
  composeBtn.style.boxShadow = 'none';
  composeBtn.style.transform = 'none';
  
  // Keep dual pill visible (don't hide it)
  
  // Hide compose panel
  const expandedPanel = container.querySelector('.mailbot-expanded');
  if (expandedPanel) {
    expandedPanel.style.display = 'none';
  }
  
  // Hide compose preview container if visible
  const composePreview = container.querySelector('.mailbot-preview-container');
  if (composePreview) {
    composePreview.style.display = 'none';
  }
  
  // Show or create summarize panel
  let summarizePanel = container.querySelector('.mailbot-summarize-panel');
  if (!summarizePanel) {
    summarizePanel = createSummarizePanel(editableField);
    container.appendChild(summarizePanel);
    
    // Attach drag listeners to the summarize panel if we're in inline mode
    const containerType = container.getAttribute('data-mailbot-type');
    if (containerType === 'inline' && container._dragHandlers) {
      summarizePanel.addEventListener('mousedown', container._dragHandlers.onMouseDown);
      const header = summarizePanel.querySelector('.mb-summary-header');
      const title = summarizePanel.querySelector('.mb-summary-title');
      if (header) header.addEventListener('mousedown', container._dragHandlers.onMouseDown);
      if (title) title.addEventListener('mousedown', container._dragHandlers.onMouseDown);
    }
  }
  
  summarizePanel.style.display = 'flex';
  summarizePanel.style.opacity = '1';
  
  container.setAttribute('data-state', 'summarize');
}

/**
 * Create the Summarize panel UI shell (compact panel first)
 */
function createSummarizePanel(editableField) {
  const panel = document.createElement('div');
  panel.className = 'mailbot-summarize-panel';
  
  // Compact panel with title and action buttons only
  panel.innerHTML = `
    <div class="mb-summary-header">
      <span class="mb-summary-title">What's being discussed?</span>
      <div class="mb-summary-compact-actions">
        <button class="mb-summary-generate">
          Generate
          <span class="mailbot-loading-dot"></span>
        </button>
        <button class="mb-summary-copy" disabled>
          Copy
          <span class="mailbot-loading-dot"></span>
        </button>
        <button class="mb-summary-close" title="Close">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 2L4 8L10 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  
  // Style the compact panel
  styleSummarizePanel(panel);
  
  // Add event listeners
  attachSummarizePanelListeners(panel, editableField);
  
  return panel;
}

/**
 * Style the Summarize panel (compact version)
 */
function styleSummarizePanel(panel) {
  panel.style.display = 'none';
  panel.style.flexDirection = 'row';
  panel.style.alignItems = 'center';
  panel.style.background = 'rgba(30, 31, 34, 0.95)';
  panel.style.backdropFilter = 'blur(12px) saturate(180%)';
  panel.style.webkitBackdropFilter = 'blur(12px) saturate(180%)';
  panel.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
  panel.style.borderRadius = '12px';
  panel.style.padding = '14px 16px';
  panel.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
  panel.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  panel.style.minWidth = '500px';
  panel.style.gap = '12px';
  panel.style.opacity = '1';
  panel.style.cursor = 'grab';  // Make panel draggable
  
  // Header (compact layout with inline buttons)
  const header = panel.querySelector('.mb-summary-header');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.gap = '12px';
  header.style.flex = '1';
  header.style.cursor = 'grab';  // Header is draggable
  
  const title = panel.querySelector('.mb-summary-title');
  title.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  title.style.fontSize = '13px';
  title.style.fontWeight = '500';
  title.style.color = 'rgba(232, 234, 237, 0.7)';
  title.style.whiteSpace = 'nowrap';
  title.style.marginRight = '8px';
  title.style.margin = '0';
  title.style.padding = '0';
  title.style.lineHeight = '1.5';
  title.style.cursor = 'grab';  // Title is draggable
  
  // Compact actions container
  const compactActions = panel.querySelector('.mb-summary-compact-actions');
  compactActions.style.display = 'flex';
  compactActions.style.gap = '8px';
  compactActions.style.alignItems = 'center';
  
  // Style Generate button - White primary with loading dot
  const generateBtn = panel.querySelector('.mb-summary-generate');
  generateBtn.style.position = 'relative';
  generateBtn.style.padding = '9px 32px 9px 18px';
  generateBtn.style.background = '#ffffff';
  generateBtn.style.color = '#000000';
  generateBtn.style.border = 'none';
  generateBtn.style.borderRadius = '8px';
  generateBtn.style.fontSize = '13px';
  generateBtn.style.fontWeight = '500';
  generateBtn.style.cursor = 'pointer';
  generateBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  generateBtn.style.whiteSpace = 'nowrap';
  generateBtn.style.letterSpacing = '0.01em';
  generateBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
  generateBtn.style.minWidth = '88px';
  
  generateBtn.addEventListener('mouseenter', () => {
    if (!generateBtn.disabled) {
      generateBtn.style.background = '#f8f9fa';
      generateBtn.style.transform = 'translateY(-1px)';
      generateBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.25)';
    }
  });
  
  generateBtn.addEventListener('mouseleave', () => {
    generateBtn.style.background = '#ffffff';
    generateBtn.style.transform = 'translateY(0)';
    generateBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
  });
  
  // Style Copy button - Gray secondary with loading dot
  const copyBtn = panel.querySelector('.mb-summary-copy');
  copyBtn.style.position = 'relative';
  copyBtn.style.padding = '9px 32px 9px 20px';
  copyBtn.style.background = '#BDC1C6';
  copyBtn.style.color = '#3C4043';
  copyBtn.style.border = 'none';
  copyBtn.style.borderRadius = '8px';
  copyBtn.style.fontSize = '13px';
  copyBtn.style.fontWeight = '500';
  copyBtn.style.cursor = 'pointer';
  copyBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  copyBtn.style.whiteSpace = 'nowrap';
  copyBtn.style.letterSpacing = '0.01em';
  copyBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
  copyBtn.style.minWidth = '88px';
  copyBtn.disabled = true;
  copyBtn.style.opacity = '0.6';
  
  copyBtn.addEventListener('mouseenter', () => {
    if (!copyBtn.disabled) {
      copyBtn.style.background = '#A8ACB0';
      copyBtn.style.transform = 'translateY(-1px)';
      copyBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.25)';
    }
  });
  
  copyBtn.addEventListener('mouseleave', () => {
    copyBtn.style.background = '#BDC1C6';
    copyBtn.style.transform = 'translateY(0)';
    copyBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
  });
  
  // Style close button - Ghost black style (like Back button)
  const closeBtn = panel.querySelector('.mb-summary-close');
  closeBtn.style.padding = '8px 12px';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = 'rgba(232, 234, 237, 0.7)';
  closeBtn.style.border = 'none';
  closeBtn.style.borderRadius = '8px';
  closeBtn.style.width = 'auto';
  closeBtn.style.height = 'auto';
  closeBtn.style.display = 'flex';
  closeBtn.style.alignItems = 'center';
  closeBtn.style.justifyContent = 'center';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  closeBtn.style.boxShadow = 'none';
  
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(232, 234, 237, 0.1)';
    closeBtn.style.color = '#E8EAED';
    closeBtn.style.transform = 'translateY(-1px)';
  });
  
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = 'rgba(232, 234, 237, 0.7)';
    closeBtn.style.transform = 'translateY(0)';
  });
  
  // Style loading dots
  const loadingDots = panel.querySelectorAll('.mailbot-loading-dot');
  loadingDots.forEach(dot => {
    dot.style.position = 'absolute';
    dot.style.right = '10px';
    dot.style.top = '50%';
    dot.style.transform = 'translateY(-50%)';
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = '#5E97F6';
    dot.style.boxShadow = '0 0 6px rgba(94, 151, 246, 0.45)';
    dot.style.opacity = '0';
    dot.style.pointerEvents = 'none';
    dot.style.transition = 'opacity 0.2s ease';
  });
}

/**
 * Attach event listeners to Summarize panel (compact → preview flow)
 */
function attachSummarizePanelListeners(panel, editableField) {
  const generateBtn = panel.querySelector('.mb-summary-generate');
  const copyBtn = panel.querySelector('.mb-summary-copy');
  const closeBtn = panel.querySelector('.mb-summary-close');
  
  let summaryGenerated = false;
  let generatedContent = {
    conciseSummary: null,
    detailedSummary: null,
    conciseActionItems: null,
    detailedActionItems: null
  };
  let previewContainer = null;
  
  // Close button
  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    if (previewContainer && previewContainer.parentNode) {
      previewContainer.parentNode.removeChild(previewContainer);
      previewContainer = null;
    }
    const container = panel.closest('.mailbot-container');
    if (container) {
      container.setAttribute('data-state', 'collapsed');
      // Don't need to show dual pill - it's always visible now
    }
  });
  
  // Copy button (compact panel)
  copyBtn.addEventListener('click', () => {
    if (!summaryGenerated) {
      copyBtn.textContent = 'Generate first!';
      copyBtn.style.background = '#ff4444';
      copyBtn.style.color = '#ffffff';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.style.background = '#ffffff';
        copyBtn.style.color = '#000000';
      }, 2000);
      return;
    }
    
    const body = previewContainer?.querySelector('.mb-preview-body');
    if (body) {
      const content = body.textContent.trim();
      
      // Check if current view is showing "no action items" or "no key points"
      if (content.toLowerCase().includes('no specific action items identified') || 
          content.toLowerCase().includes('no key points identified')) {
        copyBtn.textContent = 'Nothing to copy';
        copyBtn.style.background = '#ff8800';
        copyBtn.style.color = '#ffffff';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.style.background = '#ffffff';
          copyBtn.style.color = '#000000';
        }, 2000);
        return;
      }
      
      navigator.clipboard.writeText(content).then(() => {
        console.log('[MailBot] Summary copied to clipboard');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });
    }
  });
  
  // Generate button with AI summarization
  generateBtn.addEventListener('click', async () => {
    console.log('[MailBot] Generate Summary clicked');
    
    // Show loading state
    generateBtn.textContent = 'Generating...';
    generateBtn.disabled = true;
    generateBtn.style.opacity = '0.6';
    
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
      const concisePrompt = `You are summarizing an email thread for quick understanding.

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

INSTRUCTIONS:
Summarize the following email thread in 2–3 sentences, focusing on only the most important points, outcomes, and context.

STYLE GUIDELINES:
- Use clear, neutral, and professional language.
- Focus on the main topic, key decisions, and important actions.
- Exclude greetings, closings, and personal remarks.
- Write in third person or neutral perspective.
- Be factual and avoid speculation.
- If there is no meaningful content, return: "No key points identified in this thread."

YOUR SUMMARY:`;
      
      generatedContent.conciseSummary = (await session.prompt(concisePrompt)).trim();
      console.log('[MailBot] ✓ Concise summary generated');
      
      // Generate detailed summary
      console.log('[MailBot] Generating detailed summary...');
      const detailedPrompt = `You are summarizing an email thread for quick understanding.

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

INSTRUCTIONS:
Provide a 4–6 sentence detailed summary of the email thread covering all key points, discussions, and decisions.

STYLE GUIDELINES:
- Use clear, neutral, and professional language.
- Highlight context, decisions, agreements, and next steps.
- Include relevant supporting details without overexplaining.
- Exclude greetings, closings, and personal tone.
- Write in third person or neutral perspective.
- If little information is available, summarize as best as possible without inventing details.

YOUR SUMMARY:`;
      
      generatedContent.detailedSummary = (await session.prompt(detailedPrompt)).trim();
      console.log('[MailBot] ✓ Detailed summary generated');
      
      // STEP 1: Detect if any action items exist
      console.log('[MailBot] Detecting action items...');
      const ACTION_ITEM_PREAMBLE = "Context: This is an email thread. An action item is any explicit or implied task, request, or commitment that requires follow-up or completion. Do not invent people or dates. If none, respond exactly: 'No specific action items identified in this thread.'";
      
      const detectionPrompt = `${ACTION_ITEM_PREAMBLE}

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

QUESTION:
Do any action items (explicit or implied) appear in the following thread?

INSTRUCTIONS:
- Answer "Yes" if you find ANY tasks, requests, commitments, or follow-up actions (explicit OR implied).
- Answer "No" if the thread is purely informational with no actionable items.
- If "Yes", provide a very short reason (one sentence).
- If "No", respond exactly with: "No"

YOUR ANSWER:`;
      
      const detectionResponse = (await session.prompt(detectionPrompt, { temperature: 0.1 })).trim();
      console.log('[MailBot] Detection response:', detectionResponse);
      
      const hasActions = detectionResponse.toLowerCase().startsWith('yes');
      
      if (!hasActions) {
        // No actions detected - use consistent message for both levels
        const noActionsMessage = 'No specific action items identified in this thread.';
        generatedContent.conciseActionItems = noActionsMessage;
        generatedContent.detailedActionItems = noActionsMessage;
        console.log('[MailBot] ✓ No action items detected');
      } else {
        // STEP 2: Extract action items - Concise level
        console.log('[MailBot] Extracting concise action items...');
        const conciseActionItemsPrompt = `${ACTION_ITEM_PREAMBLE}

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

STEP 1: First confirm that action items exist in this thread.
STEP 2: If yes, list only the most critical and high-priority action items.

FORMAT & RULES:
- Present items as bullets ("•" or "-").
- Each bullet: [Action] — [Responsible person or "unknown"] — [Deadline or "unknown"].
- Keep each line short and actionable (under 20 words).
- Include only confirmed or implied actions, not vague suggestions.
- Do NOT invent names or dates - use "unknown" if not specified.
- If no actions exist after careful review, respond exactly: "No specific action items identified in this thread."

ACTION ITEMS:`;
        
        generatedContent.conciseActionItems = (await session.prompt(conciseActionItemsPrompt, { temperature: 0.2 })).trim();
        console.log('[MailBot] ✓ Concise action items extracted');
        
        // STEP 3: Extract action items - Detailed level
        console.log('[MailBot] Extracting detailed action items...');
        const detailedActionItemsPrompt = `${ACTION_ITEM_PREAMBLE}

SUBJECT: ${threadContext.subject}
MESSAGE COUNT: ${threadContext.messageCount}

EMAIL THREAD:
${conversationHistory}

STEP 1: Confirm that action items exist in this thread.
STEP 2: If yes, list ALL action items with relevant context and details.

FORMAT & RULES:
- Present items as bullets ("•" or "-").
- Each bullet: [Action] — [Responsible person or "unknown"] — [Deadline/timeframe or "unknown"].
- Add short supporting context where necessary (e.g., reason, dependency, stakeholder).
- Keep each bullet concise and focused on concrete next steps.
- Include both explicit and implied actions.
- Do NOT invent names or dates - use "unknown" if not specified.
- Avoid duplication and vague statements.
- If no actions exist after careful review, respond exactly: "No specific action items identified in this thread."

ACTION ITEMS:`;
        
        generatedContent.detailedActionItems = (await session.prompt(detailedActionItemsPrompt, { temperature: 0.2 })).trim();
        console.log('[MailBot] ✓ Detailed action items extracted');
        
        // STEP 4: Fallback - if concise found nothing but detailed found items
        const conciseHasNoItems = generatedContent.conciseActionItems.toLowerCase().includes('no specific action items identified');
        const detailedHasItems = !generatedContent.detailedActionItems.toLowerCase().includes('no specific action items identified');
        
        if (conciseHasNoItems && detailedHasItems) {
          console.log('[MailBot] ⚠️ Fallback: Concise found no items, but detailed found items');
          // Add hint to concise version
          const itemCount = generatedContent.detailedActionItems.split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•')).length;
          generatedContent.conciseActionItems = `No high-priority action items identified in this thread.\n\n💡 Tip: Detailed view shows ${itemCount} action item${itemCount !== 1 ? 's' : ''} — switch to "Detailed" to view.`;
        }
      }
      
      // Clean up session
      session.destroy();
      
      console.log('[MailBot] ✓ All content generated successfully');
      
      // Mark as generated
      summaryGenerated = true;
      copyBtn.disabled = false;
      
      // Create preview container if it doesn't exist
      if (!previewContainer) {
        previewContainer = createSummarizePreviewContainer(panel, editableField, generatedContent, threadContext);
        document.body.appendChild(previewContainer);
      } else {
        // Update existing preview
        updatePreviewContent(previewContainer, generatedContent, 'concise', 'summary');
        updatePreviewMetadata(previewContainer, threadContext);
      }
      
      // Show preview with fade-in
      previewContainer.style.display = 'flex';
      previewContainer.style.opacity = '0';
      positionPreviewBelowPanel(panel, previewContainer);
      
      // Trigger reflow
      previewContainer.offsetHeight;
      
      // Fade in
      previewContainer.style.transition = 'opacity 0.2s ease';
      previewContainer.style.opacity = '1';
      
      console.log('[MailBot] 📝 Preview displayed below compact panel');
      
    } catch (error) {
      console.error('[MailBot] ✗ Summary generation failed:', error);
      alert('Failed to generate summary:\\n\\n' + error.message);
    } finally {
      // Reset button
      generateBtn.textContent = 'Generate';
      generateBtn.disabled = false;
      generateBtn.style.opacity = '1';
    }
  });
}

/**
 * Create preview container that appears below compact panel
 */
function createSummarizePreviewContainer(panel, editableField, generatedContent, threadContext) {
  const previewContainer = document.createElement('div');
  previewContainer.className = 'mailbot-summarize-preview';
  
  previewContainer.innerHTML = `
    <div class="mb-preview-controls">
      <div class="mb-preview-level">
        <button class="mb-preview-level-btn mb-preview-level-active" data-level="concise">Concise</button>
        <button class="mb-preview-level-btn" data-level="detailed">Detailed</button>
      </div>
      
      <div class="mb-preview-toggle">
        <button class="mb-preview-toggle-btn mb-preview-toggle-active" data-view="summary">Summary</button>
        <button class="mb-preview-toggle-btn" data-view="actions">Action Items</button>
      </div>
    </div>
    
    <div class="mb-preview-body" contenteditable="false" aria-readonly="true" tabindex="-1"></div>
    
    <div class="mb-preview-meta">
      <span>Generated · <span class="mb-preview-message-count">—</span> messages · Last updated: <span class="mb-preview-last-updated">—</span></span>
    </div>
  `;
  
  // Style preview container
  stylePreviewContainer(previewContainer);
  
  // Set initial content
  updatePreviewContent(previewContainer, generatedContent, 'concise', 'summary');
  updatePreviewMetadata(previewContainer, threadContext);
  
  // Attach preview event listeners
  attachPreviewListeners(previewContainer, editableField, generatedContent);
  
  return previewContainer;
}

/**
 * Style the preview container
 */
function stylePreviewContainer(previewContainer) {
  previewContainer.style.position = 'fixed';
  previewContainer.style.zIndex = '9999999';
  previewContainer.style.display = 'none';
  previewContainer.style.flexDirection = 'column';
  previewContainer.style.background = 'rgba(30, 31, 34, 0.95)';
  previewContainer.style.backdropFilter = 'blur(12px) saturate(180%)';
  previewContainer.style.webkitBackdropFilter = 'blur(12px) saturate(180%)';
  previewContainer.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
  previewContainer.style.borderRadius = '12px';
  previewContainer.style.padding = '14px 16px';
  previewContainer.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
  previewContainer.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  previewContainer.style.minWidth = '500px';
  previewContainer.style.maxWidth = '700px';
  previewContainer.style.gap = '12px';
  previewContainer.style.opacity = '1';
  previewContainer.style.marginTop = '8px';
  
  // Controls
  const controls = previewContainer.querySelector('.mb-preview-controls');
  controls.style.display = 'flex';
  controls.style.justifyContent = 'space-between';
  controls.style.alignItems = 'center';
  controls.style.gap = '12px';
  controls.style.flexWrap = 'wrap';
  
  // Level selector
  const levelDiv = previewContainer.querySelector('.mb-preview-level');
  levelDiv.style.display = 'flex';
  levelDiv.style.gap = '4px';
  levelDiv.style.background = 'rgba(42, 43, 46, 0.6)';
  levelDiv.style.padding = '4px';
  levelDiv.style.borderRadius = '12px';
  
  previewContainer.querySelectorAll('.mb-preview-level-btn').forEach(btn => {
    btn.style.padding = '6px 12px';
    btn.style.background = 'transparent';
    btn.style.color = 'rgba(232, 234, 237, 0.7)';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  });
  
  const activeLevel = previewContainer.querySelector('.mb-preview-level-active');
  if (activeLevel) {
    activeLevel.style.background = '#ffffff';
    activeLevel.style.color = '#000000';
  }
  
  // Toggle
  const toggleDiv = previewContainer.querySelector('.mb-preview-toggle');
  toggleDiv.style.display = 'flex';
  toggleDiv.style.gap = '4px';
  toggleDiv.style.background = 'rgba(42, 43, 46, 0.6)';
  toggleDiv.style.padding = '4px';
  toggleDiv.style.borderRadius = '12px';
  
  previewContainer.querySelectorAll('.mb-preview-toggle-btn').forEach(btn => {
    btn.style.padding = '6px 16px';
    btn.style.background = 'transparent';
    btn.style.color = 'rgba(232, 234, 237, 0.7)';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  });
  
  const activeToggle = previewContainer.querySelector('.mb-preview-toggle-active');
  if (activeToggle) {
    activeToggle.style.background = '#ffffff';
    activeToggle.style.color = '#000000';
  }
  
  // Body
  const body = previewContainer.querySelector('.mb-preview-body');
  body.style.padding = '14px';
  body.style.background = 'rgba(42, 43, 46, 0.6)';
  body.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
  body.style.borderRadius = '8px';
  body.style.color = 'rgba(232, 234, 237, 0.95)';
  body.style.fontSize = '14px';
  body.style.lineHeight = '1.6';
  body.style.minHeight = '150px';
  body.style.maxHeight = '40vh';
  body.style.overflowY = 'auto';
  body.style.outline = 'none';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordWrap = 'break-word';
  body.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  
  // Metadata
  const meta = previewContainer.querySelector('.mb-preview-meta');
  meta.style.fontSize = '12px';
  meta.style.color = 'rgba(232, 234, 237, 0.5)';
  meta.style.textAlign = 'center';
}

/**
 * Position preview container below the compact panel
 */
function positionPreviewBelowPanel(panel, previewContainer) {
  if (!document.body.contains(panel)) return;
  
  const panelRect = panel.getBoundingClientRect();
  previewContainer.style.top = `${panelRect.bottom + 12}px`;
  previewContainer.style.left = `${panelRect.left}px`;
}

/**
 * Update preview content based on level and view
 */
function updatePreviewContent(previewContainer, generatedContent, level, view) {
  const body = previewContainer.querySelector('.mb-preview-body');
  
  if (view === 'summary') {
    body.textContent = level === 'concise' ? generatedContent.conciseSummary : generatedContent.detailedSummary;
  } else {
    body.textContent = level === 'concise' ? generatedContent.conciseActionItems : generatedContent.detailedActionItems;
  }
}

/**
 * Update preview metadata
 */
function updatePreviewMetadata(previewContainer, threadContext) {
  previewContainer.querySelector('.mb-preview-message-count').textContent = threadContext.messageCount;
  previewContainer.querySelector('.mb-preview-last-updated').textContent = new Date().toLocaleTimeString();
}

/**
 * Attach event listeners to preview container
 */
function attachPreviewListeners(previewContainer, editableField, generatedContent) {
  // Level selector
  previewContainer.querySelectorAll('.mb-preview-level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      previewContainer.querySelectorAll('.mb-preview-level-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'rgba(255, 255, 255, 0.6)';
        b.classList.remove('mb-preview-level-active');
      });
      btn.style.background = '#ffffff';
      btn.style.color = '#000000';
      btn.classList.add('mb-preview-level-active');
      
      const activeView = previewContainer.querySelector('.mb-preview-toggle-active')?.dataset.view || 'summary';
      updatePreviewContent(previewContainer, generatedContent, btn.dataset.level, activeView);
    });
  });
  
  // View toggle
  previewContainer.querySelectorAll('.mb-preview-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      previewContainer.querySelectorAll('.mb-preview-toggle-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'rgba(255, 255, 255, 0.6)';
        b.classList.remove('mb-preview-toggle-active');
      });
      btn.style.background = '#ffffff';
      btn.style.color = '#000000';
      btn.classList.add('mb-preview-toggle-active');
      
      const activeLevel = previewContainer.querySelector('.mb-preview-level-active')?.dataset.level || 'concise';
      updatePreviewContent(previewContainer, generatedContent, activeLevel, btn.dataset.view);
    });
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
      <button class="mailbot-generate-btn">
        Generate
        <span class="mailbot-loading-dot"></span>
      </button>
      <button class="mailbot-insert-btn">
        Insert
        <span class="mailbot-loading-dot"></span>
      </button>
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
    
    // EXPANDED PANEL STYLING - Frosted glass design
    expandedPanel.style.display = 'none';
    expandedPanel.style.background = 'rgba(30, 31, 34, 0.95)';
    expandedPanel.style.backdropFilter = 'blur(12px) saturate(180%)';
    expandedPanel.style.webkitBackdropFilter = 'blur(12px) saturate(180%)';
    expandedPanel.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
    expandedPanel.style.borderRadius = '12px';
    expandedPanel.style.padding = '14px 16px';
    expandedPanel.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
    expandedPanel.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    expandedPanel.style.minWidth = '500px';
    expandedPanel.style.display = 'flex';
    expandedPanel.style.alignItems = 'center';
    expandedPanel.style.gap = '12px';
    expandedPanel.style.cursor = 'grab';
    expandedPanel.style.display = 'none';
    expandedPanel.style.opacity = '1';
    
    // Style label - Muted text (also draggable)
    const label = expandedPanel.querySelector('.mailbot-label');
    label.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    label.style.fontSize = '13px';
    label.style.fontWeight = '500';
    label.style.color = 'rgba(232, 234, 237, 0.7)';
    label.style.marginBottom = '0';
    label.style.whiteSpace = 'nowrap';
    label.style.marginRight = '8px';
    label.style.cursor = 'grab';
    label.style.padding = '0';
    label.style.lineHeight = '1.5';
    label.style.letterSpacing = '0.01em';
    
    // Style input - Frosted surface with visible border
    const input = expandedPanel.querySelector('.mailbot-input');
    input.style.flex = '1';
    input.style.padding = '9px 14px';
    input.style.background = '#2A2B2E';
    input.style.color = '#E8EAED';
    input.style.border = '1.5px solid #3A3B3E';
    input.style.borderRadius = '10px';
    input.style.fontSize = '13px';
    input.style.fontFamily = 'inherit';
    input.style.outline = 'none';
    input.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    input.style.cursor = 'text';
    
    input.addEventListener('focus', () => {
      input.style.background = '#2A2B2E';
      input.style.borderColor = '#5E97F6';
      input.style.boxShadow = '0 0 0 2px rgba(94, 151, 246, 0.25)';
    });
    
    input.addEventListener('blur', () => {
      input.style.background = '#2A2B2E';
      input.style.borderColor = '#3A3B3E';
      input.style.boxShadow = 'none';
    });
    
    // Style controls container
    const controls = expandedPanel.querySelector('.mailbot-controls');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';
    
    // Style Generate button - White primary button with loading dot
    const generateBtn = expandedPanel.querySelector('.mailbot-generate-btn');
    generateBtn.style.position = 'relative';
    generateBtn.style.padding = '9px 32px 9px 18px';
    generateBtn.style.background = '#ffffff';
    generateBtn.style.color = '#000000';
    generateBtn.style.border = 'none';
    generateBtn.style.borderRadius = '8px';
    generateBtn.style.fontSize = '13px';
    generateBtn.style.fontWeight = '500';
    generateBtn.style.cursor = 'pointer';
    generateBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    generateBtn.style.whiteSpace = 'nowrap';
    generateBtn.style.letterSpacing = '0.01em';
    generateBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
    generateBtn.style.minWidth = '88px';
    
    generateBtn.addEventListener('mouseenter', () => {
      if (!generateBtn.disabled) {
        generateBtn.style.background = '#f8f9fa';
        generateBtn.style.transform = 'translateY(-1px)';
        generateBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.25)';
      }
    });
    
    generateBtn.addEventListener('mouseleave', () => {
      generateBtn.style.background = '#ffffff';
      generateBtn.style.transform = 'translateY(0)';
      generateBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
    });
    
    // Style Insert button - Gray secondary button matching compose window
    const insertBtn = expandedPanel.querySelector('.mailbot-insert-btn');
    insertBtn.style.position = 'relative';
    insertBtn.style.padding = '9px 32px 9px 20px';
    insertBtn.style.background = '#BDC1C6';
    insertBtn.style.color = '#3C4043';
    insertBtn.style.border = 'none';
    insertBtn.style.borderRadius = '8px';
    insertBtn.style.fontSize = '13px';
    insertBtn.style.fontWeight = '500';
    insertBtn.style.cursor = 'pointer';
    insertBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    insertBtn.style.whiteSpace = 'nowrap';
    insertBtn.style.letterSpacing = '0.01em';
    insertBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
    insertBtn.style.minWidth = '88px';
    
    insertBtn.addEventListener('mouseenter', () => {
      if (!insertBtn.disabled) {
        insertBtn.style.background = '#A8ACB0';
        insertBtn.style.transform = 'translateY(-1px)';
        insertBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.25)';
      }
    });
    
    insertBtn.addEventListener('mouseleave', () => {
      insertBtn.style.background = '#BDC1C6';
      insertBtn.style.transform = 'translateY(0)';
      insertBtn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
    });
    
    // Style disabled state for Insert button
    insertBtn.disabled = true;
    insertBtn.style.opacity = '0.6';
    insertBtn.style.cursor = 'not-allowed';
    
    // Style collapse button (Back button) - Ghost black style
    const collapseBtn = expandedPanel.querySelector('.mailbot-collapse-btn');
    collapseBtn.style.padding = '8px 12px';
    collapseBtn.style.background = 'transparent';
    collapseBtn.style.color = 'rgba(232, 234, 237, 0.7)';
    collapseBtn.style.border = 'none';
    collapseBtn.style.borderRadius = '8px';
    collapseBtn.style.width = 'auto';
    collapseBtn.style.height = 'auto';
    collapseBtn.style.display = 'flex';
    collapseBtn.style.alignItems = 'center';
    collapseBtn.style.justifyContent = 'center';
    collapseBtn.style.cursor = 'pointer';
    collapseBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    collapseBtn.style.boxShadow = 'none';
    
    collapseBtn.addEventListener('mouseenter', () => {
      collapseBtn.style.background = 'rgba(232, 234, 237, 0.1)';
      collapseBtn.style.color = '#E8EAED';
      collapseBtn.style.transform = 'translateY(-1px)';
    });
    
    collapseBtn.addEventListener('mouseleave', () => {
      collapseBtn.style.background = 'transparent';
      collapseBtn.style.color = 'rgba(232, 234, 237, 0.7)';
      collapseBtn.style.transform = 'translateY(0)';
    });
    
    // Style loading dots for both Generate and Insert buttons
    const loadingDots = expandedPanel.querySelectorAll('.mailbot-loading-dot');
    loadingDots.forEach(dot => {
      dot.style.position = 'absolute';
      dot.style.right = '10px';
      dot.style.top = '50%';
      dot.style.transform = 'translateY(-50%)';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = '#5E97F6';
      dot.style.boxShadow = '0 0 6px rgba(94, 151, 246, 0.45)';
      dot.style.opacity = '0';
      dot.style.pointerEvents = 'none';
      dot.style.transition = 'opacity 0.2s ease';
    });
    
    // Add animation for loading dot pulsing
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes mailbot-pulse {
        0%, 100% {
          transform: translateY(-50%) scale(1);
          opacity: 0.6;
        }
        50% {
          transform: translateY(-50%) scale(1.3);
          opacity: 1;
        }
      }
      .mailbot-generate-btn.loading .mailbot-loading-dot,
      .mailbot-insert-btn.loading .mailbot-loading-dot {
        opacity: 1 !important;
        animation: mailbot-pulse 1.2s infinite;
      }
    `;
    document.head.appendChild(styleEl);
    
    // Style preview container - Frosted glass separate box
    previewContainer.style.position = 'fixed';
    previewContainer.style.zIndex = '9999999';
    previewContainer.style.background = 'rgba(30, 31, 34, 0.95)';
    previewContainer.style.backdropFilter = 'blur(12px) saturate(180%)';
    previewContainer.style.webkitBackdropFilter = 'blur(12px) saturate(180%)';
    previewContainer.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
    previewContainer.style.borderRadius = '12px';
    previewContainer.style.padding = '14px 16px';
    previewContainer.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
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
      
      // Show loading state with blue dot
      generateBtn.classList.add('loading');
      generateBtn.disabled = true;
      generateBtn.style.opacity = '0.7';
      generateBtn.style.cursor = 'not-allowed';
      
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
        
        // Add signature to generated text
        const settings = await chrome.storage.local.get(['fullName', 'title', 'contactNumber']);
        console.log('[MailBot] Signature settings:', settings);
        
        const signatureParts = [];
        if (settings.fullName && settings.fullName.trim()) {
          signatureParts.push(settings.fullName.trim());
        }
        if (settings.title && settings.title.trim()) {
          signatureParts.push(settings.title.trim());
        }
        if (settings.contactNumber && settings.contactNumber.trim()) {
          signatureParts.push(settings.contactNumber.trim());
        }
        
        console.log('[MailBot] Signature parts:', signatureParts);
        
        let finalText = result.text;
        
        // Add signature if configured
        if (signatureParts.length > 0 && settings.fullName) {
          const signature = signatureParts.join('\n');
          
          // Check if AI already added the user's name in closing
          const lines = result.text.trim().split('\n');
          const nameParts = settings.fullName.toLowerCase().split(/\s+/);
          const fullNameLower = settings.fullName.toLowerCase();
          
          // Find ALL lines with the user's name in the last 5 lines (closing area)
          const nameLinesInfo = [];
          
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
            const lineLower = lines[i].toLowerCase().trim();
            const hasName = nameParts.some(part => part.length > 2 && lineLower.includes(part));
            
            if (hasName) {
              const closingWords = ['regards', 'sincerely', 'best', 'thanks', 'thank you'];
              const hasClosingWord = closingWords.some(word => lineLower.includes(word));
              
              if (hasClosingWord && lineLower.includes(fullNameLower)) {
                // Name is inline with closing
                nameLinesInfo.push({ index: i, isInline: true });
                console.log('[MailBot] 🔍 Detected inline name with closing word at line', i);
              } else if (lineLower === fullNameLower || lineLower.length < 50) {
                // Name is on its own line (standalone signature)
                nameLinesInfo.push({ index: i, isInline: false });
                console.log('[MailBot] 🔍 Detected standalone name line at line', i);
              } else {
                // Name appears in email body, not signature - skip
                console.log('[MailBot] ℹ Name found in body at line', i, ', not in signature area');
              }
            }
          }
          
          if (nameLinesInfo.length > 0) {
            console.log('[MailBot] Found', nameLinesInfo.length, 'name instance(s) in closing');
            
            // Process all name lines (remove them from the email)
            // Sort by index descending to remove from bottom up (avoids index shifting issues)
            nameLinesInfo.sort((a, b) => b.index - a.index);
            
            for (const info of nameLinesInfo) {
              if (info.isInline) {
                // Remove name from the closing line
                const line = lines[info.index];
                const escapedName = settings.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const namePattern = new RegExp(`[,]?\\s*${escapedName}\\s*$`, 'i');
                lines[info.index] = line.replace(namePattern, '').trim();
                console.log('[MailBot] Cleaned inline name from line', info.index);
              } else {
                // Remove the entire line with just the name
                lines.splice(info.index, 1);
                console.log('[MailBot] Removed standalone name line at index', info.index);
              }
            }
            
            // Append signature once at the end
            finalText = `${lines.join('\n')}\n\n${signature}`;
            console.log('[MailBot] ✓ Removed all AI name instances and added full signature once');
          } else {
            // No name in closing - just append signature
            finalText = `${result.text}\n\n${signature}`;
            console.log('[MailBot] ✓ Signature appended to generated email');
          }
        } else {
          console.log('[MailBot] ℹ No signature configured');
        }
        
        // Store generated text
        generatedText = finalText;
        
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
        // Reset button state
        generateBtn.classList.remove('loading');
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
        generateBtn.style.cursor = 'pointer';
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
      const containerState = container.getAttribute('data-state');
      const isCollapsed = containerState === 'collapsed';
      const isSummarize = containerState === 'summarize';
      
      if (isCollapsed) {
        // In collapsed state, allow drag from anywhere on dual pill
        // We'll detect if it's a drag or click based on movement distance
      } else if (isSummarize) {
        // In summarize state, allow drag from summarize panel, header, title, or dual pill
        const clickedElement = e.target;
        const summarizePanel = container.querySelector('.mailbot-summarize-panel');
        const isDraggableArea = 
          clickedElement.classList.contains('mailbot-summarize-panel') ||
          clickedElement.classList.contains('mb-summary-header') ||
          clickedElement.classList.contains('mb-summary-title') ||
          clickedElement.classList.contains('mailbot-dual-pill') ||
          clickedElement.classList.contains('mailbot-mode-btn') ||
          clickedElement.classList.contains('mailbot-compose-btn') ||
          clickedElement.classList.contains('mailbot-summarize-btn') ||
          (summarizePanel && summarizePanel.contains(clickedElement) && !clickedElement.closest('button')) ||  // Allow drag from panel but not buttons
          clickedElement === container;
        
        if (!isDraggableArea) return;
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
        btn.style.background = 'rgba(30, 31, 34, 0.95)'; // Maintain color during drag
      } else if (isSummarize) {
        const summarizePanel = container.querySelector('.mailbot-summarize-panel');
        if (summarizePanel) {
          summarizePanel.style.cursor = 'grabbing';
          summarizePanel.style.transition = 'none';
        }
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
        btn.style.background = 'rgba(30, 31, 34, 0.95)'; // Maintain color during drag
      } else {
        expandedPanel.style.cursor = 'grabbing';
        expandedPanel.style.transition = 'none';
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
        btn.style.background = 'rgba(30, 31, 34, 0.95)'; // Maintain color during drag
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
      
      // If compose preview is visible, reposition it to follow the expanded panel
      if (previewContainer.style.display === 'block') {
        positionPreview();
      }
      
      // If summarize preview is visible, reposition it to follow the container
      const summarizePreview = document.querySelector('.mailbot-summarize-preview');
      if (summarizePreview && summarizePreview.style.display === 'flex') {
        const summarizePanel = container.querySelector('.mailbot-summarize-panel');
        if (summarizePanel) {
          positionPreviewBelowPanel(summarizePanel, summarizePreview);
        }
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
      const containerState = container.getAttribute('data-state');
      if (containerState === 'collapsed') {
        btn.style.cursor = 'grab';
        btn.style.transition = 'all 0.2s ease';
      } else if (containerState === 'summarize') {
        const summarizePanel = container.querySelector('.mailbot-summarize-panel');
        if (summarizePanel) {
          summarizePanel.style.cursor = 'grab';
          summarizePanel.style.transition = 'all 0.2s ease';
        }
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
    
    // Store drag handlers on container for later use (when summarize panel is created)
    container._dragHandlers = {
      onMouseDown: onMouseDown
    };
    
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
      
      // Remove summarize preview container if it exists
      const summarizePreview = document.querySelector('.mailbot-summarize-preview');
      if (summarizePreview && summarizePreview.parentNode) {
        summarizePreview.parentNode.removeChild(summarizePreview);
      }
    };
    
    // Hover effect for inline (only when not dragging and collapsed)
    btn.addEventListener('mouseenter', () => {
      if (!isDragging && container.getAttribute('data-state') === 'collapsed') {
        btn.style.background = 'rgba(58, 59, 62, 0.95)';
        btn.style.border = '1.5px solid rgba(78, 79, 82, 0.7)';
        btn.style.transform = 'translateY(-1px)';
        btn.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.5)';
      }
    });
    
    btn.addEventListener('mouseleave', () => {
      if (!isDragging && container.getAttribute('data-state') === 'collapsed') {
        btn.style.background = 'rgba(30, 31, 34, 0.95)';
        btn.style.border = '1.5px solid rgba(58, 59, 62, 0.6)';
        btn.style.transform = 'none';
        btn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
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
  
  // PHASE A: Detect if this is a new compose (no thread context)
  // and attach compose-from-scratch UI instead
  detectAndAttachComposeUI(editableField, container, messageMetadata);
}

/**
 * Smart left-first placement for MailBot compose panel
 * 
 * Placement strategy (in priority order):
 * 1. LEFT of compose box (preferred) - outside compose content
 * 2. RIGHT of compose box - if left doesn't have room
 * 3. ABOVE compose header - centered inside compose if neither side fits
 * 4. Shrink width to fit if necessary
 * 
 * Features:
 * - Ensures composeEl is position: relative
 * - Calculates available space and attempts left-first placement
 * - Clamps vertical position to keep panel fully visible in viewport
 * - Adds resize listener and MutationObserver to recompute placement
 * - Returns cleanup function that removes listener and observer
 * - Uses try/catch with sensible fallbacks
 * 
 * @param {HTMLElement} composeEl - Gmail compose container (typically div[role="dialog"])
 * @param {HTMLElement} panelEl - MailBot panel element to position
 * @param {Object} opts - Configuration options
 * @param {number} opts.padding - Space between panel and compose edge (default: 12)
 * @param {number} opts.maxWidth - Maximum panel width in pixels (default: 420)
 * @param {number} opts.minWidth - Minimum panel width in pixels (default: 320)
 * @returns {Function} Cleanup function to remove observers and listeners
 * 
 * @acceptance_test Left placement is preferred when space available
 * @acceptance_test Panel does not overlap with compose body content
 * @acceptance_test Cleanup function removes all listeners and observers
 */
function smartPlacePanel(composeEl, panelEl, opts = {}) {
  const { padding = 12, maxWidth = 420, minWidth = 320 } = opts;
  
  if (!composeEl || !panelEl) {
    console.warn('[MailBot Smart Placement] Missing compose or panel element');
    return () => {};
  }
  
  // Prevent duplicate attachment
  if (composeEl.dataset.mailbotInjected === 'true') {
    console.log('[MailBot Smart Placement] Already attached to this compose');
    return () => {};
  }
  composeEl.dataset.mailbotInjected = 'true';
  
  // Ensure compose container can contain absolute positioned children
  const computedPosition = getComputedStyle(composeEl).position;
  if (computedPosition === 'static') {
    composeEl.style.position = 'relative';
  }
  
  // Append panel to compose container
  if (panelEl.parentElement !== composeEl) {
    composeEl.appendChild(panelEl);
  }
  
  let isPositioning = false; // Prevent recursive calls
  let resizeTimeout;
  let observerTimeout;
  
  /**
   * Compute and apply smart panel positioning
   * Attempts left-first, then right, then above, with viewport clamping
   */
  function computePosition() {
    if (isPositioning) return;
    isPositioning = true;
    
    try {
      const composeRect = composeEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate available space on left and right (outside compose)
      const leftSpace = composeRect.left;
      const rightSpace = viewportWidth - composeRect.right;
      
      // Determine panel width: prefer maxWidth, but shrink if needed
      let panelWidth = maxWidth;
      
      // Find compose header bottom to position below it (avoid overlapping To/Subject fields)
      const headerSelectors = 'input[name="to"], input[name="subjectbox"], textarea[name="to"], .aoT, .vO';
      const headerElements = Array.from(composeEl.querySelectorAll(headerSelectors));
      
      let headerBottom = 0;
      headerElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const relativeBottom = rect.bottom - composeRect.top;
          headerBottom = Math.max(headerBottom, relativeBottom);
        }
      });
      
      // Fallback if no header found
      if (headerBottom < 20 || headerBottom > 300) {
        const subjectField = composeEl.querySelector('input[name="subjectbox"]');
        if (subjectField) {
          headerBottom = subjectField.getBoundingClientRect().bottom - composeRect.top;
        } else {
          headerBottom = 80; // Safe default below typical header
        }
      }
      
      // Determine placement strategy
      let placement = 'left'; // Default preference
      let topPosition = headerBottom + padding;
      
      // Strategy 1: Try LEFT (preferred)
      if (leftSpace >= panelWidth + padding * 2) {
        placement = 'left';
        panelWidth = Math.min(maxWidth, Math.max(minWidth, leftSpace - padding * 2));
      }
      // Strategy 2: Try RIGHT if left insufficient
      else if (rightSpace >= panelWidth + padding * 2) {
        placement = 'right';
        panelWidth = Math.min(maxWidth, Math.max(minWidth, rightSpace - padding * 2));
      }
      // Strategy 3: Place ABOVE compose header (centered, inside compose)
      else {
        placement = 'above';
        panelWidth = Math.min(maxWidth, composeRect.width - padding * 2);
        panelWidth = Math.max(minWidth, panelWidth);
        topPosition = padding; // At top of compose, above header
      }
      
      // Clamp vertical position to keep panel fully visible in viewport
      const panelHeight = panelEl.offsetHeight || 200; // Fallback if not rendered yet
      const absoluteTop = composeRect.top + topPosition;
      const absoluteBottom = absoluteTop + panelHeight;
      
      if (absoluteBottom > viewportHeight - 20) {
        // Panel would overflow viewport bottom - adjust top position
        const overflow = absoluteBottom - (viewportHeight - 20);
        topPosition = Math.max(padding, topPosition - overflow);
      }
      
      if (absoluteTop < 20) {
        // Panel would overflow viewport top - clamp to minimum
        topPosition = Math.max(padding, 20 - composeRect.top);
      }
      
      // Apply positioning based on placement strategy
      panelEl.style.position = 'absolute';
      panelEl.style.top = `${topPosition}px`;
      
      // Get current panel width (might be set by shrinkPanelToContent)
      const currentWidth = panelEl.offsetWidth || panelWidth;
      const effectiveWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth));
      
      // Remove all placement classes
      panelEl.classList.remove('mailbot-left', 'mailbot-right', 'mailbot-above', 'mailbot-inside');
      
      if (placement === 'left') {
        // Position LEFT of compose (outside)
        panelEl.classList.add('mailbot-left');
        panelEl.style.left = `${-effectiveWidth - padding}px`;
        panelEl.style.right = 'auto';
        panelEl.style.transform = 'none';
        console.log(`[MailBot Smart Placement] ✓ LEFT placement (${effectiveWidth}px)`);
      } else if (placement === 'right') {
        // Position RIGHT of compose (outside)
        panelEl.classList.add('mailbot-right');
        panelEl.style.right = `${-effectiveWidth - padding}px`;
        panelEl.style.left = 'auto';
        panelEl.style.transform = 'none';
        console.log(`[MailBot Smart Placement] ✓ RIGHT placement (${effectiveWidth}px)`);
      } else if (placement === 'above') {
        // Position ABOVE compose header (centered, inside compose)
        panelEl.classList.add('mailbot-above');
        panelEl.style.left = '50%';
        panelEl.style.right = 'auto';
        panelEl.style.transform = 'translateX(-50%)';
        console.log(`[MailBot Smart Placement] ✓ ABOVE placement (${effectiveWidth}px)`);
      }
      
      // Show panel after positioning
      panelEl.style.opacity = '1';
      panelEl.style.visibility = 'visible';
      
    } catch (err) {
      console.error('[MailBot Smart Placement] Positioning failed:', err);
      // Fallback positioning - left side with conservative values
      panelEl.style.position = 'absolute';
      panelEl.style.top = '90px';
      panelEl.style.left = '-360px';
      panelEl.style.width = '340px';
      panelEl.style.right = 'auto';
      panelEl.style.transform = 'none';
      panelEl.classList.remove('mailbot-right', 'mailbot-above', 'mailbot-inside');
      panelEl.classList.add('mailbot-left');
      panelEl.style.opacity = '1';
      panelEl.style.visibility = 'visible';
    } finally {
      isPositioning = false;
    }
  }
  
  // Hide panel initially until positioned
  panelEl.style.opacity = '0';
  panelEl.style.visibility = 'hidden';
  
  // Initial positioning with delay for DOM to settle
  setTimeout(() => computePosition(), 100);
  
  // Reposition on window resize (throttled)
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => computePosition(), 150);
  };
  window.addEventListener('resize', handleResize);
  
  // Watch for DOM changes in compose (throttled) - header might change size
  const observer = new MutationObserver(() => {
    clearTimeout(observerTimeout);
    observerTimeout = setTimeout(() => computePosition(), 200);
  });
  observer.observe(composeEl, { childList: true, subtree: true, attributes: false });
  
  // Listen for manual recompute requests
  const handleRecompute = () => {
    computePosition();
  };
  panelEl.addEventListener('mailbot-recompute', handleRecompute);
  
  // Return cleanup function
  return () => {
    clearTimeout(resizeTimeout);
    clearTimeout(observerTimeout);
    window.removeEventListener('resize', handleResize);
    panelEl.removeEventListener('mailbot-recompute', handleRecompute);
    observer.disconnect();
    delete composeEl.dataset.mailbotInjected;
    if (panelEl.parentElement === composeEl) {
      panelEl.remove();
    }
    console.log('[MailBot Smart Placement] ✓ Cleanup completed');
  };
}

/**
 * Adaptive compact panel sizing - measures actual content and clamps to available space
 * Ensures panel width always fits content with no wasted space
 * 
 * @param {HTMLElement} composeEl - Compose container (for anchor rect calculation)
 * @param {HTMLElement} panelEl - Panel element to resize
 * @param {Object} opts - Options
 * @param {number} opts.minWidth - Minimum width in pixels (default: 280)
 * @param {number} opts.maxWidth - Maximum width in pixels (default: 380)
 * @param {number} opts.hPadding - Horizontal padding buffer (default: 20)
 * @returns {Function} Cleanup function to disconnect observers
 */
function shrinkPanelToContent(composeEl, panelEl, opts = {}) {
  const MIN = opts.minWidth ?? 280;
  const MAX = opts.maxWidth ?? 380;
  const PADDING = opts.hPadding ?? 20;

  function compute() {
    try {
      // Temporarily set to auto to measure natural width
      panelEl.style.width = 'auto';
      panelEl.style.maxWidth = 'none';
      
      // Measure the content - use button section as it's the widest row
      const row = panelEl.querySelector('.mb-button-section') || panelEl;
      const needed = Math.ceil(row.scrollWidth + PADDING);
      
      // Calculate available space based on panel position
      const anchorRect = composeEl.getBoundingClientRect();
      let maxAvailable = MAX;
      
      if (panelEl.classList.contains('mailbot-left')) {
        maxAvailable = Math.max(MIN, anchorRect.left - 16);
      } else if (panelEl.classList.contains('mailbot-right')) {
        const rightSpace = window.innerWidth - anchorRect.right;
        maxAvailable = Math.max(MIN, rightSpace - 16);
      } else {
        maxAvailable = Math.max(MIN, window.innerWidth - 32);
      }
      
      // Clamp to min/max and available space
      const finalWidth = Math.max(MIN, Math.min(needed, Math.min(MAX, maxAvailable)));
      panelEl.style.width = `${finalWidth}px`;
      panelEl.style.maxWidth = '';
      
      console.log(`[MailBot Shrink] ${finalWidth}px (needed: ${needed}px, max: ${maxAvailable}px)`);
      
    } catch (err) {
      console.warn('[MailBot Shrink] Error:', err);
      panelEl.style.width = '';
      panelEl.style.maxWidth = '';
    }
  }

  // Throttle to prevent excessive calls
  let computeTimeout;
  function throttledCompute() {
    clearTimeout(computeTimeout);
    computeTimeout = setTimeout(() => compute(), 100);
  }

  // Initial compute
  setTimeout(() => compute(), 150);

  // Observe ONLY childList changes (loading dot appearing/disappearing)
  // NOT attributes or characterData - those fire too frequently
  const mo = new MutationObserver(() => throttledCompute());
  mo.observe(panelEl, { subtree: true, childList: true, attributes: false, characterData: false });

  // Window resize
  const handleResize = () => throttledCompute();
  window.addEventListener('resize', handleResize);

  return () => {
    clearTimeout(computeTimeout);
    mo.disconnect();
    window.removeEventListener('resize', handleResize);
  };
}

/**
 * Initialize preview panel with interactive behaviors
 * - Click-to-edit with contenteditable toggle
 * - Regenerate button wiring
 * - Copy to clipboard functionality
 * - Insert into compose functionality
 * - Keyboard shortcuts (Escape to exit edit, Enter on regenerate)
 * - Accessibility announcements via aria-live
 * 
 * @param {HTMLElement} panelEl - Preview panel element
 * @param {Object} context - Context object containing necessary functions and elements
 * @param {Function} context.generateFunction - Function to call for regeneration
 * @param {Function} context.insertFunction - Function to call for insertion
 * @param {HTMLElement} context.subjectEl - Preview subject element  
 * @param {HTMLElement} context.bodyEl - Preview body element
 * @returns {Function} Cleanup function to remove event listeners
 */
function initPreviewPanel(panelEl, context) {
  const { generateFunction, subjectEl, bodyEl } = context;
  
  // Get elements
  const card = panelEl.querySelector('.preview-card');
  const btnRegenerate = panelEl.querySelector('.btn-regenerate');
  const statusLive = panelEl.querySelector('.mb-status-live');
  
  let isEditing = false;
  
  // Helper: Update aria-live status
  function announceStatus(message) {
    if (statusLive) {
      statusLive.textContent = message;
    }
  }
  
  // Click-to-edit behavior
  function handleCardClick(e) {
    if (!isEditing && e.target === card) {
      isEditing = true;
      card.setAttribute('contenteditable', 'true');
      card.focus();
      card.classList.add('editing');
      announceStatus('Editing preview. Press Escape to finish.');
    }
  }
  
  // Exit edit mode on blur
  function handleCardBlur() {
    if (isEditing) {
      isEditing = false;
      card.removeAttribute('contenteditable');
      card.classList.remove('editing');
      announceStatus('Preview editing finished.');
    }
  }
  
  // Keyboard shortcuts
  function handleCardKeyDown(e) {
    if (e.key === 'Escape' && isEditing) {
      e.preventDefault();
      card.blur(); // Triggers handleCardBlur
    }
  }
  
  // Regenerate button click
  async function handleRegenerate(e) {
    e.preventDefault();
    
    try {
      // Show loading state
      btnRegenerate.classList.add('loading');
      btnRegenerate.disabled = true;
      announceStatus('Generating new preview...');
      
      // Call existing generation function
      await generateFunction();
      
      // Reset button state
      btnRegenerate.classList.remove('loading');
      btnRegenerate.disabled = false;
      announceStatus('Preview updated.');
      
    } catch (error) {
      console.error('[MailBot Preview] Regenerate error:', error);
      btnRegenerate.classList.remove('loading');
      btnRegenerate.disabled = false;
      announceStatus('Regeneration failed. Please try again.');
    }
  }
  
  // Attach event listeners
  card?.addEventListener('click', handleCardClick);
  card?.addEventListener('blur', handleCardBlur);
  card?.addEventListener('keydown', handleCardKeyDown);
  btnRegenerate?.addEventListener('click', handleRegenerate);
  
  // Add visible animation class
  setTimeout(() => {
    panelEl.classList.add('mailbot-visible');
  }, 10);
  
  // Cleanup function
  return () => {
    card?.removeEventListener('click', handleCardClick);
    card?.removeEventListener('blur', handleCardBlur);
    card?.removeEventListener('keydown', handleCardKeyDown);
    btnRegenerate?.removeEventListener('click', handleRegenerate);
    console.log('[MailBot Preview] Event listeners cleaned up');
  };
}

/**
 * PHASE A: Compose-from-scratch UI (UI-only, simulated generation)
 * Detects if this is a new compose and shows subject+body generation interface
 */
function detectAndAttachComposeUI(editableField, container, messageMetadata) {
  try {
    // Check if this is a new compose (no thread context)
    const isNewCompose = messageMetadata.threadIndex === null && !messageMetadata.messageId;
    
    if (!isNewCompose) {
      return;
    }
    
    // Guard: Only attach once per container
    if (container.dataset.composeUIAttached === 'true') {
      return;
    }
    container.dataset.composeUIAttached = 'true';
    
    console.log('[MailBot Compose] Detected new compose, attaching UI');
    
    // Find the compose window container
    const dialog = editableField.closest('div[role="dialog"]');
    if (!dialog) {
      console.warn('[MailBot Compose] Could not find compose dialog');
      return;
    }
    
    // Find subject field for validation
    const subjectField = dialog.querySelector('input[name="subjectbox"]') || 
                         dialog.querySelector('input[aria-label*="Subject"]');
    
    if (!subjectField) {
      console.warn('[MailBot Compose] Could not find subject field');
      return;
    }
    
    // Hide the default floating UI (not needed for compose-from-scratch)
    const dualPill = container.querySelector('.mailbot-dual-pill');
    const expandedPanel = container.querySelector('.mailbot-expanded');
    const previewContainer = container.querySelector('.mailbot-preview-container');
    
    if (dualPill) dualPill.style.display = 'none';
    if (expandedPanel) expandedPanel.style.display = 'none';
    if (previewContainer) previewContainer.style.display = 'none';
    
    // Also hide the floating container completely
    if (container) container.style.display = 'none';
    
    // Prevent duplicate panels
    if (dialog.querySelector('.mailbot-compose-panel')) {
      console.log('[MailBot Compose] Panel already exists in this compose');
      return;
    }
    
    // Create expanded compose panel (default state)
    const composePanel = document.createElement('div');
    composePanel.className = 'mailbot-compose-panel mailbot-expanded';
    composePanel.setAttribute('data-state', 'expanded');
    
    composePanel.innerHTML = `
      <div class="mb-input-section">
        <label class="mb-label">
          💬 What do you want to say?
        </label>
        <input type="text" class="mb-intent-input" placeholder="Type your thoughts..." />
      </div>
      <div class="mb-button-section">
        <div class="mb-actions">
          <button class="mb-action-btn mb-generate-btn">
            Generate
            <span class="mailbot-loading-dot" aria-hidden="true"></span>
          </button>
          <button class="mb-action-btn mb-insert-btn" disabled>
            Insert
            <span class="mailbot-loading-dot" aria-hidden="true"></span>
          </button>
          <button class="mb-back-btn" title="Minimize">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10 2L4 8L10 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Back
          </button>
        </div>
      </div>
    `;
    
    // Create inline pill (minimized state) - initially hidden
    const inlinePill = document.createElement('div');
    inlinePill.className = 'mailbot-compose-pill mailbot-inline';
    inlinePill.style.display = 'none';
    inlinePill.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;">
        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
      </svg>
      <span>Compose</span>
    `;
    
    // Create preview panel with polished UI matching compose panel
    const composePreview = document.createElement('div');
    composePreview.className = 'mailbot-preview-panel';
    composePreview.setAttribute('role', 'region');
    composePreview.setAttribute('aria-label', 'MailBot preview panel');
    composePreview.style.display = 'none'; // Hidden initially
    
    composePreview.innerHTML = `
      <div class="preview-header">
        <span class="preview-title">Preview (click to edit):</span>
        <button class="btn-regenerate mb-action-btn" aria-label="Regenerate draft">
          Regenerate
          <span class="mailbot-loading-dot" aria-hidden="true"></span>
        </button>
      </div>
      <div class="preview-card" role="article" tabindex="0">
        <div class="preview-subject-section">
          <strong class="preview-label">Subject:</strong>
          <div class="preview-subject"></div>
        </div>
        <div class="preview-body-section">
          <strong class="preview-label">Body:</strong>
          <div class="preview-body"></div>
        </div>
      </div>
      <div class="mb-status-live" role="status" aria-live="polite" aria-atomic="true" style="position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden;"></div>
    `;
    
    // Append inline pill to dialog (positioned at bottom-right)
    dialog.appendChild(inlinePill);
    
    // Style inline pill for bottom-right positioning
    inlinePill.style.position = 'absolute';
    inlinePill.style.bottom = '60px'; // Above Gmail toolbar
    inlinePill.style.right = '20px';
    inlinePill.style.zIndex = '1000';
    
    // Position and attach expanded panel using smart left-first placement
    const cleanupPanelPosition = smartPlacePanel(dialog, composePanel, {
      padding: 12,
      maxWidth: 380,
      minWidth: 280
    });
    
    // Adaptive compact sizing - measures content and clamps to available space
    const cleanupPanelResize = shrinkPanelToContent(dialog, composePanel, {
      minWidth: 280,
      maxWidth: 380,
      hPadding: 20
    });
    
    // Watch compose DOM changes (header resizing, fields changing) to recompute panel size
    // Throttled heavily to prevent performance issues
    let composeDOMTimeout;
    const composeDOMObserver = new MutationObserver(() => {
      clearTimeout(composeDOMTimeout);
      composeDOMTimeout = setTimeout(() => {
        // Re-run positioning when compose structure changes
        const computeEvent = new CustomEvent('mailbot-recompute');
        composePanel.dispatchEvent(computeEvent);
      }, 300); // Increased throttle to 300ms
    });
    // Only watch childList, not attributes or characterData
    composeDOMObserver.observe(dialog, { childList: true, subtree: false, attributes: false });
    
    // Watch for compose dialog removal and call cleanup
    // @acceptance_test Cleanup function is called when compose closes
    const composeCloseObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === dialog || (node.contains && node.contains(dialog))) {
            console.log('[MailBot Compose] Compose dialog closed, cleaning up');
            clearTimeout(composeDOMTimeout);
            clearTimeout(previewResizeTimeout);
            composeDOMObserver.disconnect();
            window.removeEventListener('resize', handlePreviewResize);
            cleanupPanelPosition();
            cleanupPanelResize();
            if (cleanupPreviewPanel) cleanupPreviewPanel();
            composeCloseObserver.disconnect();
          }
        });
      });
    });
    
    // Observe parent for removal of compose dialog
    if (dialog.parentElement) {
      composeCloseObserver.observe(dialog.parentElement, { childList: true });
    }
    
    // Attach preview panel to compose dialog below the main panel
    dialog.appendChild(composePreview);
    
    // Position preview panel below compact panel
    function positionPreview() {
      if (composePreview.style.display !== 'none') {
        const panelRect = composePanel.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        
        // Calculate position relative to dialog
        const relativeTop = panelRect.bottom - dialogRect.top + 8; // 8px gap
        composePreview.style.position = 'absolute';
        composePreview.style.top = `${relativeTop}px`;
        
        // Match panel positioning (left, right, or inside)
        composePreview.classList.remove('mailbot-left', 'mailbot-right', 'mailbot-inside');
        
        if (composePanel.classList.contains('mailbot-left')) {
          composePreview.classList.add('mailbot-left');
          composePreview.style.left = composePanel.style.left;
          composePreview.style.right = 'auto';
          composePreview.style.width = composePanel.style.width;
          composePreview.style.transform = 'none';
        } else if (composePanel.classList.contains('mailbot-right')) {
          composePreview.classList.add('mailbot-right');
          composePreview.style.right = composePanel.style.right;
          composePreview.style.left = 'auto';
          composePreview.style.width = composePanel.style.width;
          composePreview.style.transform = 'none';
        } else {
          // Inside placement
          composePreview.classList.add('mailbot-inside');
          composePreview.style.left = '50%';
          composePreview.style.right = 'auto';
          composePreview.style.width = '90%';
          composePreview.style.maxWidth = '500px';
          composePreview.style.transform = 'translateX(-50%)';
        }
        
        // Viewport clamping: Calculate available space and adjust preview height
        const previewTopInViewport = panelRect.bottom + 8;
        const availableHeight = viewportHeight - previewTopInViewport - 20; // 20px bottom padding
        
        // Get preview content element for height control
        const previewContent = composePreview.querySelector('.mb-preview-content');
        if (previewContent && availableHeight > 100) {
          // Set max-height to fit within viewport
          // Account for preview header (~40px), padding (~28px), and borders
          const maxContentHeight = Math.max(150, Math.min(400, availableHeight - 70));
          previewContent.style.maxHeight = `${maxContentHeight}px`;
          previewContent.style.overflowY = 'auto';
        }
      }
    }
    
    // Add resize listener to reposition preview when viewport changes
    let previewResizeTimeout;
    const handlePreviewResize = () => {
      clearTimeout(previewResizeTimeout);
      previewResizeTimeout = setTimeout(() => {
        if (composePreview.classList.contains('mailbot-visible')) {
          positionPreview();
        }
      }, 150);
    };
    window.addEventListener('resize', handlePreviewResize);
    
    // State to hold generated draft
    let generatedDraft = null;
    
    // Get UI elements with updated selectors
    const intentInput = composePanel.querySelector('.mb-intent-input');
    const generateBtn = composePanel.querySelector('.mb-generate-btn');
    const insertBtn = composePanel.querySelector('.mb-insert-btn');
    const backBtn = composePanel.querySelector('.mb-back-btn');
    
    // Preview panel elements
    const previewSubject = composePreview.querySelector('.preview-subject');
    const previewBody = composePreview.querySelector('.preview-body');
    const btnRegenerate = composePreview.querySelector('.btn-regenerate');
    
    // Enter key on intent input triggers generate
    intentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generateBtn.click();
      }
    });
    
    // Generate button click
    generateBtn.addEventListener('click', async () => {
      console.log('[MailBot Compose] Generate button clicked');
      console.log('[MailBot Compose] Button disabled?', generateBtn.disabled);
      console.log('[MailBot Compose] Panel display:', composePanel.style.display);
      console.log('[MailBot Compose] Panel opacity:', composePanel.style.opacity);
      
      try {
        const intent = intentInput.value.trim();
        
        if (!intent) {
          intentInput.style.borderColor = '#ff4444';
          setTimeout(() => {
            intentInput.style.borderColor = '#333333';
          }, 2000);
          return;
        }
        
        console.log('[MailBot Compose] Generating draft for intent:', intent);
        
        // Show loading state with class
        generateBtn.classList.add('loading');
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.7';
        generateBtn.style.cursor = 'not-allowed';
        
        // Use the shared performGeneration function
        await performGeneration();
        
        // Reset Generate button
        generateBtn.classList.remove('loading');
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
        generateBtn.style.cursor = 'pointer';
        
        console.log('[MailBot Compose] Preview displayed');
        
      } catch (error) {
        console.error('[MailBot Compose] Generation error:', error);
        generateBtn.classList.remove('loading');
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
        generateBtn.style.cursor = 'pointer';
        alert('Failed to generate draft: ' + error.message);
      }
    });
    
    // Shared generation function for reuse
    async function performGeneration() {
      const intent = intentInput.value.trim();
      if (!intent) {
        throw new Error('Intent is required');
      }
      
      console.log('[MailBot Compose] Generating draft for intent:', intent);
      
      // Call AI generation
      const threadContext = extractThreadContext(editableField);
      
      // Get default tone from storage
      const { defaultTone } = await chrome.storage.local.get(['defaultTone']);
      const tone = defaultTone || 'neutral';
      
      console.log('[MailBot Compose] Calling AI with context...');
      let result = await generateWithAI(
        threadContext,
        intent,
        tone,
        1 // Attempt 1
      );
      
      // Check validation and retry if needed
      if (!result.validation.isValid && result.attemptNumber < 2) {
        console.warn('[MailBot Compose] Validation failed, retrying...');
        result = await generateWithAI(
          threadContext,
          intent,
          tone,
          2 // Attempt 2
        );
      }
      
      console.log('[MailBot Compose] AI generation complete');
      
      // Add signature if configured
      const settings = await chrome.storage.local.get(['fullName', 'title', 'contactNumber']);
      const signatureParts = [];
      if (settings.fullName && settings.fullName.trim()) {
        signatureParts.push(settings.fullName.trim());
      }
      if (settings.title && settings.title.trim()) {
        signatureParts.push(settings.title.trim());
      }
      if (settings.contactNumber && settings.contactNumber.trim()) {
        signatureParts.push(settings.contactNumber.trim());
      }
      
      let finalBody = result.text;
      
      // Add signature if configured
      if (signatureParts.length > 0 && settings.fullName) {
        const signature = signatureParts.join('\n');
        const lines = result.text.trim().split('\n');
        const nameParts = settings.fullName.toLowerCase().split(/\s+/);
        
        // Check if AI already added name in closing
        const lastFewLines = lines.slice(-3).join('\n').toLowerCase();
        const hasName = nameParts.some(part => part.length > 2 && lastFewLines.includes(part));
        
        if (hasName) {
          // Remove AI's name and add full signature
          const filteredLines = lines.filter((line, index) => {
            if (index < lines.length - 3) return true;
            const lineLower = line.toLowerCase().trim();
            return !nameParts.some(part => part.length > 2 && lineLower.includes(part));
          });
          finalBody = `${filteredLines.join('\n')}\n\n${signature}`;
        } else {
          finalBody = `${result.text}\n\n${signature}`;
        }
      }
      
      // Generate proper subject line
      let subject;
      if (threadContext.subject && threadContext.subject !== 'No subject') {
        subject = threadContext.subject;
      } else {
        // Ask AI to generate a subject line
        console.log('[MailBot Compose] Generating subject line...');
        const subjectPrompt = `Based on this email content, write ONLY a short, professional subject line (3-6 words max).

Rules:
- NO names (sender or recipient)
- NO quotes or punctuation at the end
- NO "Subject:" prefix
- Just the topic/purpose

Email content:
${finalBody.substring(0, 300)}

Subject line:`;
        
        try {
          const subjectSession = await LanguageModel.create({ 
            systemPrompt: 'You generate concise email subject lines. Output ONLY the subject line without names, quotes, or prefixes.' 
          });
          const generatedSubject = await subjectSession.prompt(subjectPrompt);
          subjectSession.destroy();
          
          // Clean up subject (remove quotes, "Subject:", names, etc.)
          subject = generatedSubject
            .replace(/^(Subject:|Re:|Fwd:)\s*/i, '')
            .replace(/^["']|["']$/g, '')
            .replace(/\s*-\s*.+$/, '') // Remove " - Name" patterns
            .trim();
          
          console.log('[MailBot Compose] Generated subject:', subject);
        } catch (error) {
          console.warn('[MailBot Compose] Failed to generate subject, using fallback');
          subject = intent.substring(0, 50) + (intent.length > 50 ? '...' : '');
        }
      }
      
      generatedDraft = {
        subject: subject,
        body: finalBody
      };
      
      // Update preview
      previewSubject.textContent = generatedDraft.subject;
      previewBody.textContent = generatedDraft.body;
      
      console.log('[MailBot Compose] Preview panel before show:', {
        display: composePreview.style.display,
        opacity: composePreview.style.opacity,
        transition: composePreview.style.transition,
        hasVisibleClass: composePreview.classList.contains('mailbot-visible'),
        computedDisplay: window.getComputedStyle(composePreview).display,
        computedOpacity: window.getComputedStyle(composePreview).opacity
      });
      
      // Show preview with proper animation - clear ALL inline styles first
      composePreview.style.display = 'block';
      composePreview.style.opacity = '';
      composePreview.style.transform = '';
      composePreview.style.transition = '';
      composePreview.classList.add('mailbot-visible');
      
      console.log('[MailBot Compose] Preview panel after show:', {
        display: composePreview.style.display,
        opacity: composePreview.style.opacity,
        hasVisibleClass: composePreview.classList.contains('mailbot-visible'),
        computedDisplay: window.getComputedStyle(composePreview).display,
        computedOpacity: window.getComputedStyle(composePreview).opacity
      });
      
      positionPreview();
      
      // Enable insert button
      insertBtn.disabled = false;
      
      return generatedDraft;
    }
    
    // Shared insert function for reuse
    async function performInsertion() {
      if (!generatedDraft) {
        console.warn('[MailBot Compose] No draft to insert');
        return;
      }
      
      console.log('[MailBot Compose] Inserting draft into Gmail');
      
      // Get potentially edited content from preview
      const finalSubject = previewSubject.textContent.trim();
      const finalBody = previewBody.textContent.trim();
      
      // Insert subject
      if (subjectField && finalSubject) {
        subjectField.value = finalSubject;
        subjectField.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      // Insert body with proper line breaks
      if (editableField && finalBody) {
        editableField.innerHTML = '';
        
        // Split by newlines and create proper structure
        const lines = finalBody.split('\n');
        lines.forEach((line, index) => {
          const textNode = document.createTextNode(line);
          editableField.appendChild(textNode);
          
          // Add line break after each line except the last
          if (index < lines.length - 1) {
            editableField.appendChild(document.createElement('br'));
          }
        });
        
        editableField.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      // Hide preview and collapse to pill
      composePreview.classList.remove('mailbot-visible');
      composePreview.style.display = 'none';
      collapsePanelToInline(composePanel, composePreview, inlinePill);
      
      console.log('[MailBot Compose] Draft inserted successfully');
    }
    
    // Initialize preview panel with interactive behaviors
    let cleanupPreviewPanel = null;
    
    // Regenerate button in preview (legacy support)
    if (btnRegenerate) {
      btnRegenerate.addEventListener('click', async () => {
        try {
          const intent = intentInput.value.trim();
          if (!intent) return;
          
          console.log('[MailBot Compose] Regenerating draft');
          
          btnRegenerate.classList.add('loading');
          btnRegenerate.disabled = true;
          
          await performGeneration();
          
          btnRegenerate.classList.remove('loading');
          btnRegenerate.disabled = false;
          
          console.log('[MailBot Compose] Draft regenerated');
          
        } catch (error) {
          console.error('[MailBot Compose] Regeneration error:', error);
          btnRegenerate.classList.remove('loading');
          btnRegenerate.disabled = false;
        }
      });
    }
    
    // Wire up preview panel behaviors
    cleanupPreviewPanel = initPreviewPanel(composePreview, {
      generateFunction: performGeneration,
      subjectEl: previewSubject,
      bodyEl: previewBody
    });
    
    // Insert button click (from compose panel)
    insertBtn.addEventListener('click', async () => {
      try {
        await performInsertion();
      } catch (error) {
        console.error('[MailBot Compose] Insert error:', error);
        alert('Failed to insert draft: ' + error.message);
      }
    });
    
    // Back button click - collapse to inline pill
    backBtn.addEventListener('click', () => {
      collapsePanelToInline(composePanel, composePreview, inlinePill);
    });
    
    // Inline pill click - expand back to full panel
    inlinePill.addEventListener('click', () => {
      expandPanelFromInline(composePanel, composePreview, inlinePill, cleanupPanelPosition);
    });
    
    // Helper: Collapse to inline pill
    function collapsePanelToInline(panel, preview, pill) {
      panel.setAttribute('data-state', 'collapsed');
      
      // Fade out expanded panel and preview
      panel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(-10px)';
      
      if (preview.style.display !== 'none') {
        preview.classList.remove('mailbot-visible');
        preview.style.transition = 'opacity 0.2s ease';
        preview.style.opacity = '0';
      }
      
      setTimeout(() => {
        panel.style.display = 'none';
        preview.style.display = 'none';
        
        // Clear inline styles from preview
        preview.style.opacity = '';
        preview.style.transition = '';
        preview.style.transform = '';
        
        // Show inline pill with fade-in
        pill.style.display = 'flex';
        pill.style.opacity = '0';
        pill.style.transition = 'opacity 0.2s ease';
        
        // Trigger reflow
        pill.offsetHeight;
        
        pill.style.opacity = '1';
        
        console.log('[MailBot Compose] Collapsed to inline pill');
      }, 200);
    }
    
    // Helper: Expand from inline pill
    function expandPanelFromInline(panel, preview, pill, positionCleanup) {
      panel.setAttribute('data-state', 'expanded');
      
      // Fade out pill
      pill.style.transition = 'opacity 0.2s ease';
      pill.style.opacity = '0';
      
      setTimeout(() => {
        pill.style.display = 'none';
        
        // Show expanded panel with fade-in
        panel.style.display = 'flex';
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(-10px)';
        
        // Trigger reflow
        panel.offsetHeight;
        
        panel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        panel.style.opacity = '1';
        panel.style.transform = 'translateY(0)';
        
        // After animation completes, clear inline styles to prevent issues
        setTimeout(() => {
          panel.style.transition = '';
          panel.style.opacity = '';
          panel.style.transform = '';
          
          // Trigger recompute of panel position to ensure correct placement
          const computeEvent = new CustomEvent('mailbot-recompute');
          panel.dispatchEvent(computeEvent);
          
          // Reset button states to ensure they're interactive
          if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.classList.remove('loading');
            generateBtn.style.opacity = '1';
            generateBtn.style.cursor = 'pointer';
            console.log('[MailBot Compose] Reset generate button state');
          }
          
          // Ensure intent input is enabled
          if (intentInput) {
            intentInput.disabled = false;
            intentInput.style.pointerEvents = '';
          }
        }, 200);
        
        console.log('[MailBot Compose] Expanded from inline pill');
      }, 200);
    }
    
    console.log('[MailBot Compose] ✓ Compose UI attached successfully');
    
  } catch (error) {
    console.error('[MailBot Compose] Error attaching compose UI:', error);
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
