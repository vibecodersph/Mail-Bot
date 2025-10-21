// popup/popup.js
// Handles settings form and AI diagnostics

const DEFAULT_SETTINGS = {
  fullName: '',
  title: '',
  contactNumber: '',
  defaultTone: 'neutral',
  emailLength: 'average',
  preferredGreetings: 'Hi, Hello, Good day',
  preferredClosings: 'Sincerely, Best regards, Kind regards'
};

// Show status message
function showStatus(message, isError = false) {
  const statusEl = document.getElementById('status-message');
  const saveBtn = document.getElementById('save-btn');
  
  statusEl.textContent = message;
  statusEl.className = `status-message ${isError ? 'error' : 'success'}`;
  
  // Change button appearance temporarily on success
  if (!isError) {
    saveBtn.textContent = '✓ Saved!';
    saveBtn.style.background = '#4CAF50';
    
    setTimeout(() => {
      saveBtn.textContent = 'Save Settings';
      saveBtn.style.background = '#000';
    }, 2000);
  }
  
  setTimeout(() => {
    statusEl.style.display = 'none';
    statusEl.className = 'status-message'; // Reset classes
  }, 3000);
}

// Save settings
document.getElementById('save-btn').addEventListener('click', async () => {
  const fullName = document.getElementById('full-name').value.trim();
  const title = document.getElementById('title').value.trim();
  const contactNumber = document.getElementById('contact-number').value.trim();
  const defaultTone = document.getElementById('tone-select').value;
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
    title,
    contactNumber,
    defaultTone,
    emailLength,
    preferredGreetings: greetings.join(', '),
    preferredClosings: closings.join(', ')
  });
  
  showStatus('✓ Settings saved!');
  console.log('[MailBot] Settings saved:', { fullName, title, contactNumber, defaultTone, emailLength, greetings, closings });
});

// Load settings
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'fullName',
    'title',
    'contactNumber',
    'defaultTone',
    'emailLength',
    'preferredGreetings',
    'preferredClosings'
  ]);
  
  document.getElementById('full-name').value = settings.fullName || DEFAULT_SETTINGS.fullName;
  document.getElementById('title').value = settings.title || DEFAULT_SETTINGS.title;
  document.getElementById('contact-number').value = settings.contactNumber || DEFAULT_SETTINGS.contactNumber;
  document.getElementById('tone-select').value = settings.defaultTone || DEFAULT_SETTINGS.defaultTone;
  document.getElementById('email-length').value = settings.emailLength || DEFAULT_SETTINGS.emailLength;
  document.getElementById('preferred-greetings').value = settings.preferredGreetings || DEFAULT_SETTINGS.preferredGreetings;
  document.getElementById('preferred-closings').value = settings.preferredClosings || DEFAULT_SETTINGS.preferredClosings;
  
  console.log('[MailBot] Settings loaded:', settings);
}

// Validate contact number input (only allow numbers and formatting characters)
document.getElementById('contact-number')?.addEventListener('input', (e) => {
  const input = e.target;
  // Allow numbers, +, -, spaces, and parentheses
  input.value = input.value.replace(/[^0-9+\-\s()]/g, '');
});

// Load settings on popup open
window.addEventListener('DOMContentLoaded', loadSettings);
