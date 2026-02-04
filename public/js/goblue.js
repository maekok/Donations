document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('adminLoginForm');
  const loginMessage = document.getElementById('adminLoginMessage');
  const passwordForm = document.getElementById('adminPasswordForm');
  const passwordMessage = document.getElementById('adminPasswordMessage');
  const logoutButton = document.getElementById('adminLogoutButton');

  const setMessage = (element, text, type = '') => {
    if (!element) return;
    element.textContent = text;
    element.classList.remove('error', 'success');
    if (type) {
      element.classList.add(type);
    }
  };

  const postJSON = async (url, payload = {}) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      // If response isn't JSON, get text
      const text = await response.text().catch(() => '');
      throw new Error(`Server error (${response.status}): ${text || response.statusText}`);
    }

    if (!response.ok) {
      const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  };

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = loginForm.password.value.trim();

      if (!password) {
        setMessage(loginMessage, 'Password is required', 'error');
        return;
      }

      setMessage(loginMessage, 'Authenticating...');
      loginForm.querySelector('button[type="submit"]').disabled = true;

      try {
        await postJSON('/goblue/login', { password });
        setMessage(loginMessage, 'Login successful. Redirecting...', 'success');
        window.location.reload();
      } catch (error) {
        setMessage(loginMessage, error.message, 'error');
      } finally {
        loginForm.querySelector('button[type="submit"]').disabled = false;
      }
    });
  }

  if (passwordForm) {
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentPassword = passwordForm.currentPassword.value.trim();
      const newPassword = passwordForm.newPassword.value.trim();

      if (!currentPassword || !newPassword) {
        setMessage(passwordMessage, 'Both password fields are required', 'error');
        return;
      }

      setMessage(passwordMessage, 'Updating password...');
      passwordForm.querySelector('button[type="submit"]').disabled = true;

      try {
        await postJSON('/goblue/password', { currentPassword, newPassword });
        setMessage(passwordMessage, 'Password updated. Please sign in again.', 'success');
        setTimeout(() => {
          window.location.href = '/goblue';
        }, 1500);
      } catch (error) {
        setMessage(passwordMessage, error.message, 'error');
      } finally {
        passwordForm.querySelector('button[type="submit"]').disabled = false;
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      try {
        await postJSON('/goblue/logout');
      } catch (error) {
        // ignore logout errors, still redirect
      } finally {
        window.location.href = '/goblue';
      }
    });
  }

  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

  if (tabButtons.length && tabPanels.length) {
    const activateTab = (tabName) => {
      tabButtons.forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      tabPanels.forEach(panel => {
        const isPanelActive = panel.dataset.tab === tabName;
        panel.classList.toggle('active', isPanelActive);
        // Load options when password tab is activated
        if (panel.dataset.tab === 'password' && isPanelActive) {
          loadOptions();
        }
      });
    };

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        activateTab(button.dataset.tab);
      });
    });
  }

  // Beta: create invite code
  const betaCreateCodeForm = document.getElementById('betaCreateCodeForm');
  const betaCodeMessage = document.getElementById('betaCodeMessage');
  if (betaCreateCodeForm && betaCodeMessage) {
    betaCreateCodeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('betaCodeInput');
      const code = input && input.value ? input.value.trim() : '';
      if (!code) {
        setMessage(betaCodeMessage, 'Enter a code (e.g. BETA-ABC123)', 'error');
        return;
      }
      setMessage(betaCodeMessage, 'Creating code...');
      betaCreateCodeForm.querySelector('button[type="submit"]').disabled = true;
      try {
        await postJSON('/goblue/beta/invite-codes', { code });
        setMessage(betaCodeMessage, `Code "${code}" created. Refreshing...`, 'success');
        window.location.reload();
      } catch (error) {
        setMessage(betaCodeMessage, error.message, 'error');
        betaCreateCodeForm.querySelector('button[type="submit"]').disabled = false;
      }
    });
  }

  // Options management
  const optionsList = document.getElementById('optionsList');
  const addOptionForm = document.getElementById('addOptionForm');
  const optionMessage = document.getElementById('optionMessage');

  async function loadOptions() {
    if (!optionsList) return;
    
    try {
      optionsList.innerHTML = '<p class="info">Loading options...</p>';
      const response = await fetch('/goblue/options', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to load options');
      }
      
      const data = await response.json();
      const options = data.options || [];
      
      if (options.length === 0) {
        optionsList.innerHTML = '<p class="info">No options configured. Add options below.</p>';
        return;
      }
      
      const optionsHtml = `
        <table style="width: 100%; margin-top: 10px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 8px;">Key</th>
              <th style="text-align: left; padding: 8px;">Value</th>
              <th style="text-align: right; padding: 8px; width: 100px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${options.map(option => `
              <tr data-key="${option.key}">
                <td style="padding: 8px; font-family: monospace; font-size: 0.9em;">${escapeHtml(option.key)}</td>
                <td style="padding: 8px;">
                  <input type="text" 
                         class="option-value-input" 
                         value="${escapeHtml(option.value)}" 
                         data-key="${option.key}"
                         style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 4px;">
                </td>
                <td style="padding: 8px; text-align: right;">
                  <button class="btn btn-sm btn-primary save-option-btn" data-key="${option.key}" title="Save">
                    <i class="fas fa-save"></i>
                  </button>
                  <button class="btn btn-sm btn-danger delete-option-btn" data-key="${option.key}" title="Delete">
                    <i class="fas fa-trash"></i>
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      
      optionsList.innerHTML = optionsHtml;
      
      // Attach event listeners
      document.querySelectorAll('.save-option-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.target.closest('button').dataset.key;
          const input = document.querySelector(`input[data-key="${key}"]`);
          const value = input.value;
          await saveOption(key, value);
        });
      });
      
      document.querySelectorAll('.delete-option-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.target.closest('button').dataset.key;
          if (confirm(`Are you sure you want to delete option "${key}"?`)) {
            await deleteOption(key);
          }
        });
      });
      
    } catch (error) {
      optionsList.innerHTML = `<p class="error">Error loading options: ${error.message}</p>`;
    }
  }

  async function saveOption(key, value) {
    try {
      setMessage(optionMessage, 'Saving...');
      await postJSON('/goblue/options', { key, value });
      setMessage(optionMessage, 'Option saved successfully', 'success');
      setTimeout(() => {
        setMessage(optionMessage, '');
        loadOptions();
      }, 1000);
    } catch (error) {
      setMessage(optionMessage, error.message, 'error');
    }
  }

  async function deleteOption(key) {
    try {
      setMessage(optionMessage, 'Deleting...');
      const response = await fetch(`/goblue/options/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete option');
      }
      
      setMessage(optionMessage, 'Option deleted successfully', 'success');
      setTimeout(() => {
        setMessage(optionMessage, '');
        loadOptions();
      }, 1000);
    } catch (error) {
      setMessage(optionMessage, error.message, 'error');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  if (addOptionForm) {
    addOptionForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const key = addOptionForm.optionKey.value.trim();
      const value = addOptionForm.optionValue.value.trim();

      if (!key || !value) {
        setMessage(optionMessage, 'Both key and value are required', 'error');
        return;
      }

      try {
        await saveOption(key, value);
        addOptionForm.optionKey.value = '';
        addOptionForm.optionValue.value = '';
      } catch (error) {
        // Error already handled in saveOption
      }
    });
  }

  // Load options on page load if password tab is active
  if (document.querySelector('.tab-panel[data-tab="password"].active')) {
    loadOptions();
  }
});

