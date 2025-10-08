// background/service_worker.js
// Handles background events, message passing, and AI generation

/**
 * Generate reply using Gemini Nano (Chrome's built-in AI)
 * @param {string} emailText - The email thread context
 * @param {string} subject - Email subject
 * @param {string} userIntent - What the user wants to say
 * @param {string} tone - Desired tone (neutral, friendly, formal, concise)
 * @returns {Promise<string>} Generated reply text
 */
async function generateWithAI(emailText, subject, userIntent, tone) {
  console.log('[MailBot] Checking AI availability...');
  console.log('[MailBot] self.ai:', self.ai);
  console.log('[MailBot] window.ai:', typeof window !== 'undefined' ? window.ai : 'N/A');
  console.log('[MailBot] globalThis.ai:', globalThis.ai);
  
  // Try multiple API access methods
  let aiAPI = self.ai || (typeof window !== 'undefined' ? window.ai : null) || globalThis.ai;
  
  console.log('[MailBot] Resolved AI API:', aiAPI);
  console.log('[MailBot] AI languageModel:', aiAPI?.languageModel);
  
  // Check if AI API is available
  if (!aiAPI || !aiAPI.languageModel) {
    throw new Error('Gemini Nano API is not available. Please ensure:\n\n1. Chrome Canary/Dev 127+\n2. Flags are enabled\n3. Model is downloaded from chrome://components\n\nCurrent status: AI API not found');
  }
  
  // Use the resolved API
  self.ai = aiAPI;
  
  // Check model availability
  try {
    const availability = await self.ai.languageModel.capabilities();
    console.log('[MailBot] Model availability:', availability);
    
    if (availability.available === 'no') {
      throw new Error('Gemini Nano model is not available on this device.');
    }
    
    if (availability.available === 'after-download') {
      throw new Error('Gemini Nano model is downloading. Please wait and try again in a few minutes.\n\nCheck progress at chrome://components (look for "Optimization Guide On Device Model")');
    }
  } catch (error) {
    console.error('[MailBot] Capability check failed:', error);
    throw new Error('Failed to check AI capabilities: ' + error.message);
  }
  
  console.log('[MailBot] Creating AI session...');
  
  // Create AI session
  const session = await self.ai.languageModel.create({
    systemPrompt: 'You are MailBot, a helpful AI email assistant. Write clear, natural, and contextually appropriate email replies.'
  });
  
  console.log('[MailBot] AI session created successfully');
  
  // Build the prompt
  const toneInstructions = {
    neutral: 'professional and balanced',
    friendly: 'warm, conversational, and approachable',
    formal: 'polished, respectful, and business-appropriate',
    concise: 'brief and to-the-point'
  };
  
  const prompt = `You are writing an email reply.

Subject: ${subject}

Previous email thread:
${emailText || 'No previous context available.'}

The user wants to: ${userIntent}

Write a ${toneInstructions[tone] || 'professional'} reply that:
- Addresses the user's intent clearly
- Is contextually appropriate to the email thread
- Uses a ${tone} tone
- Is ready to send (no placeholders or instructions to the user)

Reply:`;
  
  console.log('[MailBot] Sending prompt to AI...');
  
  // Generate response
  const result = await session.prompt(prompt);
  
  console.log('[MailBot] AI response received, length:', result.length);
  
  // Clean up
  session.destroy();
  
  return result.trim();
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle AI generation requests
  if (message.action === 'generateReply') {
    console.log('[MailBot] Generating reply with AI...', {
      intent: message.userIntent,
      tone: message.tone
    });
    
    // Generate reply asynchronously
    generateWithAI(
      message.emailText,
      message.subject,
      message.userIntent,
      message.tone
    )
      .then(generatedText => {
        console.log('[MailBot] ✓ Reply generated successfully');
        sendResponse({
          success: true,
          generatedText: generatedText
        });
      })
      .catch(error => {
        console.error('[MailBot] ✗ Generation failed:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });
    
    // Return true to indicate async response
    return true;
  }
  
  // Test AI availability
  if (message.action === 'testAI') {
    console.log('[MailBot] Testing AI availability...');
    
    (async () => {
      try {
        let diagnostics = '';
        
        // Check 1: AI API exists
        diagnostics += `1. AI API Check:\n`;
        diagnostics += `   self.ai exists: ${!!self.ai}\n`;
        diagnostics += `   self.ai.languageModel exists: ${!!self.ai?.languageModel}\n\n`;
        
        if (!self.ai || !self.ai.languageModel) {
          throw new Error('AI API not found!\n\n' + diagnostics + 
            '\nPlease check:\n' +
            '- Chrome Canary/Dev version 127+\n' +
            '- chrome://flags/#optimization-guide-on-device-model\n' +
            '- chrome://flags/#prompt-api-for-gemini-nano\n' +
            '- Restart Chrome after enabling flags');
        }
        
        // Check 2: Model capabilities
        diagnostics += `2. Model Capabilities:\n`;
        const capabilities = await self.ai.languageModel.capabilities();
        diagnostics += `   Available: ${capabilities.available}\n`;
        diagnostics += `   Default temperature: ${capabilities.defaultTemperature || 'N/A'}\n`;
        diagnostics += `   Default top-k: ${capabilities.defaultTopK || 'N/A'}\n\n`;
        
        if (capabilities.available === 'no') {
          throw new Error('Model not available on this device!\n\n' + diagnostics);
        }
        
        if (capabilities.available === 'after-download') {
          throw new Error('Model is downloading!\n\n' + diagnostics + 
            '\nPlease wait and check chrome://components\n' +
            'Look for "Optimization Guide On Device Model"');
        }
        
        // Check 3: Create test session
        diagnostics += `3. Session Creation:\n`;
        const session = await self.ai.languageModel.create({
          systemPrompt: 'You are a test assistant.'
        });
        diagnostics += `   ✓ Session created successfully\n\n`;
        
        // Check 4: Generate test response
        diagnostics += `4. Test Generation:\n`;
        const result = await session.prompt('Say "Hello from Gemini Nano!"');
        diagnostics += `   ✓ Response received: "${result.substring(0, 50)}..."\n\n`;
        
        // Cleanup
        session.destroy();
        
        diagnostics += `🎉 All checks passed!\n`;
        diagnostics += `Gemini Nano is working correctly.`;
        
        sendResponse({
          success: true,
          message: diagnostics
        });
      } catch (error) {
        console.error('[MailBot] Test failed:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    
    return true; // Async response
  }
  
  // Legacy button click handler (for debugging)
  if (message.type === 'MAILBOT_BUTTON_CLICKED') {
    console.log('[MailBot] Button click received in service worker');
    console.log('[MailBot] Context:', {
      boxType: message.context?.boxType,
      subject: message.context?.thread?.subject,
      messageCount: message.context?.thread?.messageCount
    });
  }
});

// Log when service worker is activated
console.log('[MailBot] Service worker activated');
