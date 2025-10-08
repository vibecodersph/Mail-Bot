// options/options.js
// Handles saving and loading MailBot settings

const DEFAULT_SETTINGS = {
  fullName: '',
  defaultTone: 'neutral',
  emailLength: 'average',
  preferredGreetings: 'Hi, Hello, Good day',
  preferredClosings: 'Sincerely, Best regards, Kind regards'
};

// Show status message
function showStatus(message, isError = false) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status-message ${isError ? 'error' : 'success'}`;
  
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

// Save settings
document.getElementById('save-btn').addEventListener('click', async () => {
  const fullName = document.getElementById('full-name').value.trim();
  const defaultTone = document.getElementById('default-tone').value;
  const emailLength = document.getElementById('email-length').value;
  const preferredGreetings = document.getElementById('preferred-greetings').value.trim();
  const preferredClosings = document.getElementById('preferred-closings').value.trim();
  
  // Validate full name
  if (!fullName) {
    showStatus('⚠️ Please enter your full name', true);
    document.getElementById('full-name').focus();
    return;
  }
  
  // Parse and validate greetings (max 3)
  const greetings = preferredGreetings
    .split(',')
    .map(g => g.trim())
    .filter(g => g.length > 0)
    .slice(0, 3);
  
  // Parse and validate closings (max 3)
  const closings = preferredClosings
    .split(',')
    .map(c => c.trim())
    .filter(c => c.length > 0)
    .slice(0, 3);
  
  // Save to storage
  await chrome.storage.local.set({
    fullName,
    defaultTone,
    emailLength,
    preferredGreetings: greetings.join(', '),
    preferredClosings: closings.join(', ')
  });
  
  showStatus('✓ Settings saved successfully!');
  console.log('[MailBot] Settings saved:', { fullName, defaultTone, emailLength, greetings, closings });
});

// Reset to defaults
document.getElementById('reset-btn').addEventListener('click', async () => {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    loadSettings();
    showStatus('✓ Settings reset to defaults');
  }
});

// Load settings
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'fullName',
    'defaultTone',
    'emailLength',
    'preferredGreetings',
    'preferredClosings'
  ]);
  
  document.getElementById('full-name').value = settings.fullName || DEFAULT_SETTINGS.fullName;
  document.getElementById('default-tone').value = settings.defaultTone || DEFAULT_SETTINGS.defaultTone;
  document.getElementById('email-length').value = settings.emailLength || DEFAULT_SETTINGS.emailLength;
  document.getElementById('preferred-greetings').value = settings.preferredGreetings || DEFAULT_SETTINGS.preferredGreetings;
  document.getElementById('preferred-closings').value = settings.preferredClosings || DEFAULT_SETTINGS.preferredClosings;
  
  console.log('[MailBot] Settings loaded:', settings);
}

// Load settings on page load
window.addEventListener('DOMContentLoaded', loadSettings);
