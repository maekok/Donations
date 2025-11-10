// Template Manager JavaScript
let currentConfig = null;

// Initialize the template manager
document.addEventListener('DOMContentLoaded', function() {
  loadTemplateConfig();
});

// Load template configuration from server
async function loadTemplateConfig() {
  try {
    const response = await fetch('/api/template');
    const data = await response.json();
    
    if (response.ok) {
      currentConfig = data.config;
      populateFormFields(data.config);
      loadLogoPreview();
      showValidationMessages(data.validation);
    } else {
      showMessage('Error loading template configuration', 'error');
    }
  } catch (error) {
    console.error('Error loading template config:', error);
    showMessage('Failed to load template configuration', 'error');
  }
}

// Populate form fields with current configuration
function populateFormFields(config) {
  // Organization information
  document.getElementById('orgName').value = config.organization.name || '';
  document.getElementById('orgEin').value = config.organization.ein || '';
  document.getElementById('orgAddress').value = config.organization.address || '';
  document.getElementById('orgCity').value = config.organization.city || '';
  document.getElementById('orgState').value = config.organization.state || '';
  document.getElementById('orgZip').value = config.organization.zip || '';
  document.getElementById('orgPhone').value = config.organization.phone || '';
  document.getElementById('orgEmail').value = config.organization.email || '';
  document.getElementById('orgWebsite').value = config.organization.website || '';
  document.getElementById('orgType').value = config.organization.type || 'Non-Profit';
  
  // Setup formatting after populating the fields
  setupEinFormatting();
  setupPhoneFormatting();

  // Receipt settings
  document.getElementById('receiptTitle').value = config.receipt.title || '';
  document.getElementById('receiptSubtitle').value = config.receipt.subtitle || '';
  document.getElementById('receiptFooter').value = config.receipt.footer || '';

  // Logo settings
  document.getElementById('logoPosition').value = config.receipt.logo.position || 'top-right';
  document.getElementById('logoWidth').value = config.receipt.logo.width || 150;
  document.getElementById('logoHeight').value = config.receipt.logo.height || 80;

  // Branding options
  document.getElementById('showLogo').checked = config.branding.showLogo;
  document.getElementById('showEin').checked = config.branding.showEin;
  document.getElementById('showAddress').checked = config.branding.showAddress;
  document.getElementById('showContact').checked = config.branding.showContact;
}

// Load logo preview
async function loadLogoPreview() {
  try {
    const response = await fetch('/api/template/logo');
    if (response.ok) {
      const blob = await response.blob();
      const imageUrl = URL.createObjectURL(blob);
      displayLogoPreview(imageUrl);
      document.getElementById('deleteLogoBtn').style.display = 'block';
    } else {
      displayLogoPlaceholder();
    }
  } catch (error) {
    console.log('No logo found or error loading logo');
    displayLogoPlaceholder();
  }
}

// Display logo preview
function displayLogoPreview(imageUrl) {
  const preview = document.getElementById('logoPreview');
  preview.innerHTML = `<img src="${imageUrl}" alt="Organization Logo">`;
}

// Display logo placeholder
function displayLogoPlaceholder() {
  const preview = document.getElementById('logoPreview');
  preview.innerHTML = `
    <i class="fas fa-image"></i>
    <p>No logo uploaded</p>
  `;
  document.getElementById('deleteLogoBtn').style.display = 'none';
}

// Preview logo before upload
function previewLogo(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    
    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      showMessage('File size must be less than 5MB', 'error');
      input.value = '';
      return;
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      showMessage('Only PNG, JPG, JPEG, and GIF files are allowed', 'error');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      displayLogoPreview(e.target.result);
      uploadLogo(file);
    };
    reader.readAsDataURL(file);
  }
}

// Upload logo to server
async function uploadLogo(file) {
  try {
    const formData = new FormData();
    formData.append('logo', file);

    const response = await fetch('/api/template/logo', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      showMessage('Logo uploaded successfully!', 'success');
      document.getElementById('deleteLogoBtn').style.display = 'block';
    } else {
      showMessage(result.error || 'Failed to upload logo', 'error');
      displayLogoPlaceholder();
    }
  } catch (error) {
    console.error('Error uploading logo:', error);
    showMessage('Failed to upload logo', 'error');
    displayLogoPlaceholder();
  }
}

// Delete logo
async function deleteLogo() {
  if (!confirm('Are you sure you want to delete the logo?')) {
    return;
  }

  try {
    const response = await fetch('/api/template/logo', {
      method: 'DELETE'
    });

    const result = await response.json();

    if (response.ok) {
      showMessage('Logo deleted successfully!', 'success');
      displayLogoPlaceholder();
      document.getElementById('logoFile').value = '';
      
      // Clear logo width and height values
      document.getElementById('logoWidth').value = '';
      document.getElementById('logoHeight').value = '';
    } else {
      showMessage(result.error || 'Failed to delete logo', 'error');
    }
  } catch (error) {
    console.error('Error deleting logo:', error);
    showMessage('Failed to delete logo', 'error');
  }
}

// Save all settings
async function saveAllSettings() {
  const saveButton = document.querySelector('button[onclick="saveAllSettings()"]');
  const originalText = saveButton.innerHTML;
  
  try {
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    saveButton.disabled = true;

    // Validate phone number before saving
    const phoneInput = document.getElementById('orgPhone');
    if (phoneInput.value.trim() !== '' && !validatePhoneNumber(phoneInput)) {
      showMessage('Please enter a valid phone number in the format (xxx) xxx-xxxx', 'error');
      saveButton.innerHTML = originalText;
      saveButton.disabled = false;
      return;
    }

    // Collect form data
    const organizationData = {
      name: document.getElementById('orgName').value,
      ein: document.getElementById('orgEin').value,
      address: document.getElementById('orgAddress').value,
      city: document.getElementById('orgCity').value,
      state: document.getElementById('orgState').value,
      zip: document.getElementById('orgZip').value,
      phone: document.getElementById('orgPhone').value,
      email: document.getElementById('orgEmail').value,
      website: document.getElementById('orgWebsite').value,
      type: document.getElementById('orgType').value
    };

    const receiptData = {
      title: document.getElementById('receiptTitle').value,
      subtitle: document.getElementById('receiptSubtitle').value,
      footer: document.getElementById('receiptFooter').value,
      logo: {
        position: document.getElementById('logoPosition').value,
        width: parseInt(document.getElementById('logoWidth').value),
        height: parseInt(document.getElementById('logoHeight').value)
      }
    };

    const brandingData = {
      showLogo: document.getElementById('showLogo').checked,
      showEin: document.getElementById('showEin').checked,
      showAddress: document.getElementById('showAddress').checked,
      showContact: document.getElementById('showContact').checked
    };

    // Save organization information
    await updateOrganization(organizationData);

    // Save receipt settings
    await updateReceiptSettings(receiptData);

    // Save branding settings
    await updateBranding(brandingData);

    showMessage('All settings saved successfully!', 'success');
    
    // Reload configuration to get updated data
    await loadTemplateConfig();

  } catch (error) {
    console.error('Error saving settings:', error);
    showMessage('Failed to save settings', 'error');
  } finally {
    saveButton.innerHTML = originalText;
    saveButton.disabled = false;
  }
}

// Update organization information
async function updateOrganization(data) {
  const response = await fetch('/api/template/organization', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to update organization');
  }

  return response.json();
}

// Update receipt settings
async function updateReceiptSettings(data) {
  const response = await fetch('/api/template/receipt', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to update receipt settings');
  }

  return response.json();
}

// Update branding settings
async function updateBranding(data) {
  const response = await fetch('/api/template/branding', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to update branding settings');
  }

  return response.json();
}

// Generate receipt preview
async function generatePreview() {
  const previewButton = document.querySelector('button[onclick="generatePreview()"]');
  const originalText = previewButton.innerHTML;
  
  try {
    previewButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    previewButton.disabled = true;

    // First save current settings
    await saveAllSettings();

    // Generate a preview receipt using the first transaction
    const response = await fetch('/api/receipts/generate/30', {
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      const previewContainer = document.getElementById('previewContainer');
      const previewFrame = document.getElementById('previewFrame');
      
      previewFrame.src = `/receipts/30`;
      previewContainer.style.display = 'block';
      
      // Scroll to preview
      previewContainer.scrollIntoView({ behavior: 'smooth' });
      
      showMessage('Preview generated successfully!', 'success');
    } else {
      const result = await response.json();
      showMessage(result.error || 'Failed to generate preview', 'error');
    }

  } catch (error) {
    console.error('Error generating preview:', error);
    showMessage('Failed to generate preview', 'error');
  } finally {
    previewButton.innerHTML = originalText;
    previewButton.disabled = false;
  }
}

// Show validation messages
function showValidationMessages(validation) {
  if (!validation.isValid) {
    const message = `Configuration issues found: ${validation.errors.join(', ')}`;
    showMessage(message, 'error');
  }
}

// Show message to user
function showMessage(message, type = 'info') {
  // Remove existing messages
  const existingMessages = document.querySelectorAll('.message');
  existingMessages.forEach(msg => msg.remove());

  // Create new message
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = message;

  // Insert at top of container
  const container = document.querySelector('.template-container');
  container.insertBefore(messageDiv, container.firstChild);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.remove();
    }
  }, 5000);
}

// EIN format validation
function setupEinFormatting() {
  const einInput = document.getElementById('orgEin');
  if (!einInput) {
    console.warn('EIN input field not found');
    return;
  }

  einInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
    
    if (value.length > 9) {
      value = value.substring(0, 9);
    }
    
    if (value.length >= 2) {
      value = value.substring(0, 2) + '-' + value.substring(2);
    }
    
    e.target.value = value;
  });
}

// Setup phone formatting and validation
function setupPhoneFormatting() {
  const phoneInput = document.getElementById('orgPhone');
  if (!phoneInput) {
    console.warn('Phone input field not found');
    return;
  }

  // Phone format validation and formatting (xxx) xxx-xxxx
  phoneInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    
    // Limit to 10 digits
    if (value.length > 10) {
      value = value.substring(0, 10);
    }
    
    // Format as (xxx) xxx-xxxx
    let formattedValue = '';
    if (value.length >= 6) {
      formattedValue = '(' + value.substring(0, 3) + ') ' + value.substring(3, 6) + '-' + value.substring(6);
    } else if (value.length >= 3) {
      formattedValue = '(' + value.substring(0, 3) + ') ' + value.substring(3);
    } else if (value.length > 0) {
      formattedValue = '(' + value;
    }
    
    // Only update if the formatted value is different to avoid cursor jumping
    if (e.target.value !== formattedValue) {
      e.target.value = formattedValue;
    }
    
    // Validate phone number
    validatePhoneNumber(e.target);
  });

  // Add validation on blur
  phoneInput.addEventListener('blur', function(e) {
    validatePhoneNumber(e.target);
  });
}

// Phone number validation function
function validatePhoneNumber(input) {
  const phoneRegex = /^\(\d{3}\) \d{3}-\d{4}$/;
  const value = input.value.trim();
  
  // Remove validation classes
  input.classList.remove('valid', 'invalid');
  
  if (value === '') {
    // Empty is valid (optional field)
    return true;
  }
  
  if (phoneRegex.test(value)) {
    input.classList.add('valid');
    return true;
  } else {
    input.classList.add('invalid');
    return false;
  }
} 