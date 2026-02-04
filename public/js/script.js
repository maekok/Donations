// Function to open a receipt from the database in modal
async function openReceipt(transactionId) {
  console.log('Opening receipt for transaction:', transactionId);
  
  try {
    // Check if receipt exists for this transaction (without generating)
    const response = await fetch(`/api/receipts/check/${transactionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    
    if (response.ok && result.exists) {
      // Receipt exists - open in modal
      openPdfModal(transactionId);
    } else {
      showNotification('No receipt found for this transaction. Please generate a receipt first.', 'error');
    }
    
  } catch (error) {
    console.error('❌ Error opening receipt:', error);
    showNotification(`Failed to open receipt: ${error.message}`, 'error');
  }
}

// Function to open PDF modal
function openPdfModal(transactionId) {
  const modal = document.getElementById('pdfModal');
  const modalTitle = document.getElementById('modalTitle');
  const pdfViewer = document.getElementById('pdfViewer');
  
  // Set modal title
  modalTitle.textContent = `Receipt`;
  
  // Set PDF source using transaction ID
  pdfViewer.src = `/receipts/${transactionId}`;
  
  // Store current receipt info for download
  window.currentReceiptInfo = {
    transactionId: transactionId
  };
  
  // Show modal
  modal.style.display = 'block';
  
  // Prevent body scroll
  document.body.style.overflow = 'hidden';
}

// Function to close PDF modal
function closePdfModal() {
  const modal = document.getElementById('pdfModal');
  const pdfViewer = document.getElementById('pdfViewer');
  
  // Hide modal
  modal.style.display = 'none';
  
  // Clear PDF source
  pdfViewer.src = '';
  
  // Clear current receipt info
  window.currentReceiptInfo = null;
  
  // Restore body scroll
  document.body.style.overflow = 'auto';
}

// Function to download current PDF
function downloadPdf() {
  if (window.currentReceiptInfo) {
    const { transactionId } = window.currentReceiptInfo;
    const link = document.createElement('a');
    link.href = `/receipts/${transactionId}`;
    link.download = `receipt_${transactionId}.pdf`;
    link.click();
  }
}

// Close modal when clicking outside of it (legacy function - will be replaced)

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    const pdfModal = document.getElementById('pdfModal');
    const orgModal = document.getElementById('organizationModal');
    if (pdfModal.style.display === 'block') {
      closePdfModal();
    }
    if (orgModal.style.display === 'block') {
      closeOrganizationModal();
    }
  }
});

// Hamburger Menu Functions
function toggleMenu() {
  const dropdown = document.getElementById('dropdownMenu');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
  const menuContainer = document.querySelector('.menu-container');
  const dropdown = document.getElementById('dropdownMenu');
  
  if (menuContainer && dropdown && !menuContainer.contains(event.target)) {
    dropdown.classList.remove('show');
  }
});

// Organization Modal Functions
let currentOrganizationId = null;

function openOrganizationDialog() {
  // Check if user is logged into QuickBooks
  if (!isLoggedInToQuickbooks) {
    showNotification('Please connect to QuickBooks first to manage organization settings.', 'warning');
    return;
  }
  
  // Close dropdown menu
  document.getElementById('dropdownMenu').classList.remove('show');
  
  // Load organization data
  loadOrganizationData();
  
  // Show modal
  const modal = document.getElementById('organizationModal');
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeOrganizationModal() {
  const modal = document.getElementById('organizationModal');
  modal.style.display = 'none';
  document.body.style.overflow = 'auto';
  
  // Reset form
  document.getElementById('organizationForm').reset();
  currentOrganizationId = null;
}

async function loadOrganizationData() {
  try {
    console.log('🔍 Loading current organization data...');
    const response = await fetch('/api/organizations/current');
    console.log('📡 Response status:', response.status);
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Error loading organization:', error);
      showNotification(error.error || 'Failed to load organization data', 'error');
      return;
    }
    
    const org = await response.json();
    console.log('📊 Current organization received:', org);
    console.log('🏢 Using organization:', org);
    currentOrganizationId = org.id;
    
    // Populate form fields
    const form = document.getElementById('organizationForm');
    if (!form) {
      console.error('❌ Organization form not found!');
      showNotification('Organization form not found', 'error');
      return;
    }
    
    document.getElementById('orgName').value = org.name || '';
    document.getElementById('orgEin').value = formatEin(org.ein || '');
    document.getElementById('orgAddress').value = org.address || '';
    document.getElementById('orgCity').value = org.city || '';
    document.getElementById('orgState').value = org.state || '';
    document.getElementById('orgZip').value = org.zip || '';
    document.getElementById('orgEmail').value = org.email || '';
    document.getElementById('orgPhone').value = formatPhoneNumber(org.phone || '');
    document.getElementById('orgContact').value = org.contact || '';
    document.getElementById('orgType').value = org.type || '';
    document.getElementById('orgUrl').value = org.url || '';
    
    // Setup formatting for inputs
    setupPhoneFormatting();
    setupEinFormatting();
    
    console.log('✅ Organization data loaded successfully');
  } catch (error) {
    console.error('❌ Error loading organization data:', error);
    showNotification('Failed to load organization data. Please try again.', 'error');
  }
}

async function saveOrganization() {
  try {
    const form = document.getElementById('organizationForm');
    const formData = new FormData(form);
    
    // Convert FormData to object
    const organizationData = {};
    for (let [key, value] of formData.entries()) {
      organizationData[key] = value;
    }
    
    // Strip formatting from phone number (keep only digits)
    if (organizationData.phone) {
      organizationData.phone = organizationData.phone.replace(/\D/g, '');
    }
    
    // Strip formatting from EIN (keep only digits)
    if (organizationData.ein) {
      organizationData.ein = organizationData.ein.replace(/\D/g, '');
    }
    
    // Validate required fields
    if (!organizationData.name) {
      showNotification('Organization name is required', 'error');
      return;
    }
    
    // Validate phone number if provided (should be 10 digits after stripping)
    if (organizationData.phone && organizationData.phone.length !== 10) {
      showNotification('Please enter a valid 10-digit phone number', 'error');
      return;
    }
    
    // Validate EIN if provided (should be 9 digits after stripping)
    if (organizationData.ein && organizationData.ein.length !== 9) {
      showNotification('Please enter a valid 9-digit EIN', 'error');
      return;
    }
    
    let response;
    if (currentOrganizationId) {
      // Update existing organization
      response = await fetch(`/api/organizations/${currentOrganizationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(organizationData)
      });
    } else {
      // Create new organization
      response = await fetch('/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(organizationData)
      });
    }
    
    if (response.ok) {
      const result = await response.json();
      showNotification('Organization saved successfully!', 'success');
      closeOrganizationModal();
      
      // Update current organization ID if it was a new organization
      if (!currentOrganizationId) {
        currentOrganizationId = result.id;
      }
    } else {
      const error = await response.json();
      showNotification(error.error || 'Failed to save organization', 'error');
    }
  } catch (error) {
    console.error('Error saving organization:', error);
    showNotification('Failed to save organization', 'error');
  }
}

// Close organization modal when clicking outside
window.onclick = function(event) {
  const pdfModal = document.getElementById('pdfModal');
  const orgModal = document.getElementById('organizationModal');
  const logoModal = document.getElementById('logoModal');
  const emailModal = document.getElementById('emailModal');
  
  if (event.target === pdfModal) {
    closePdfModal();
  }
  if (event.target === orgModal) {
    closeOrganizationModal();
  }
  if (event.target === logoModal) {
    closeLogoModal();
  }
  if (event.target === emailModal) {
    closeEmailModal();
  }
}

// Logo Modal Functions
function openLogoDialog() {
  // Check if user is logged into QuickBooks
  if (!isLoggedInToQuickbooks) {
    showNotification('Please connect to QuickBooks first to manage logo settings.', 'warning');
    return;
  }
  
  // Close dropdown menu
  document.getElementById('dropdownMenu').classList.remove('show');
  
  // Load logo data
  loadLogoData();
  
  // Show modal
  const modal = document.getElementById('logoModal');
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeLogoModal() {
  const modal = document.getElementById('logoModal');
  modal.style.display = 'none';
  document.body.style.overflow = 'auto';
  
  // Reset form
  document.getElementById('logoForm').reset();
}

async function loadLogoData() {
  try {
    console.log('🔍 Loading logo data...');
    const response = await fetch('/api/logos');
    
    if (response.ok) {
      const logoData = await response.json();
      console.log('📊 Received logo data:', logoData);
      console.log('📊 Logo data type:', typeof logoData.Logo);
      console.log('📊 Logo data:', logoData.Logo);
      
      // Populate logo settings
      document.getElementById('logoPosition').value = logoData.logoposition || 'top-right';
      document.getElementById('logoWidth').value = logoData.width || 150;
      document.getElementById('logoHeight').value = logoData.height || 80;
      
      // Load existing logo if available
      if (logoData.Logo && logoData.Logo !== '[object Object]' && Array.isArray(logoData.Logo) && logoData.Logo.length > 0) {
        const logoPreview = document.getElementById('logoPreview');
        
        // Handle different data formats
        let logoBuffer;
        if (Array.isArray(logoData.Logo)) {
          // Convert array back to Uint8Array
          logoBuffer = new Uint8Array(logoData.Logo);
        } else if (typeof logoData.Logo === 'string') {
          // Handle base64 or other string formats
          try {
            logoBuffer = new Uint8Array(JSON.parse(logoData.Logo));
          } catch (e) {
            console.error('Error parsing logo data:', e);
            showNoLogoState();
            return;
          }
        } else {
          console.error('Unknown logo data format:', typeof logoData.Logo);
          showNoLogoState();
          return;
        }
        
        // Convert buffer to blob and display
        const blob = new Blob([logoBuffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        logoPreview.innerHTML = `<img src="${url}" alt="Logo">`;
        document.getElementById('deleteLogoBtn').style.display = 'block';
        console.log('✅ Logo loaded and displayed');
      } else {
        showNoLogoState();
      }
      
      console.log('✅ Logo data loaded successfully');
    } else if (response.status === 404) {
      // No logo found - show default state
      console.log('📋 No logo found for organization - showing default state');
      showNoLogoState();
    } else if (response.status === 400 || response.status === 401) {
      // Authentication or connection issue
      const errorData = await response.json().catch(() => ({ error: 'Authentication required' }));
      console.log('⚠️ Logo loading issue:', errorData.error);
      showNoLogoState();
      // Don't show error notification for expected states (no connection, no logo)
    } else {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ Error loading logo data:', error);
    showNoLogoState();
    // Only show error notification for unexpected errors
    if (!error.message.includes('404') && !error.message.includes('400') && !error.message.includes('401')) {
      showNotification('Failed to load logo data. Please try again.', 'error');
    }
  }
}

function showNoLogoState() {
  const logoPreview = document.getElementById('logoPreview');
  logoPreview.innerHTML = `
    <div class="logo-placeholder">
      <i class="fas fa-image"></i>
      <p>No logo uploaded</p>
    </div>
  `;
  document.getElementById('deleteLogoBtn').style.display = 'none';
  
  // Reset form fields to defaults
  document.getElementById('logoPosition').value = 'top-right';
  document.getElementById('logoWidth').value = 150;
  document.getElementById('logoHeight').value = 80;
}

function previewLogo(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    
    // Show file information
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    
    if (fileName && fileSize && fileInfo) {
      fileName.textContent = file.name;
      fileSize.textContent = formatFileSize(file.size);
      fileInfo.style.display = 'block';
    }
    
    // Enhanced validation with better error messages
    const validationResult = validateLogoFile(file);
    if (!validationResult.isValid) {
      showNotification(validationResult.error, 'error');
      input.value = ''; // Clear the input
      if (fileInfo) fileInfo.style.display = 'none'; // Hide file info
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const logoPreview = document.getElementById('logoPreview');
      const img = new Image();
      
      img.onload = function() {
        // Auto-detect and set dimensions
        const width = this.naturalWidth;
        const height = this.naturalHeight;
        
        // Set the width and height fields
        document.getElementById('logoWidth').value = width;
        document.getElementById('logoHeight').value = height;
        
        // Show the image in preview
        logoPreview.innerHTML = `<img src="${e.target.result}" alt="Logo Preview" style="max-width: 200px; max-height: 150px; object-fit: contain;">`;
        document.getElementById('deleteLogoBtn').style.display = 'block';
        
        // Show dimension validation warning if needed
        if (width > 2048 || height > 2048) {
          showNotification(`Warning: Image dimensions (${width}x${height}px) exceed recommended maximum of 2048x2048px`, 'warning');
        }
        
        console.log(`Logo dimensions detected: ${width}x${height}`);
      };
      
      img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    // Hide file info when no file selected
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) fileInfo.style.display = 'none';
  }
}

// Function to validate logo file upload
function validateLogoFile(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
  const maxDimensions = 2048; // Max width/height in pixels
  
  // Check if file exists
  if (!file) {
    return {
      isValid: false,
      error: 'No file selected. Please choose a logo file to upload.'
    };
  }
  
  // Check file size
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File size too large. Maximum allowed size is ${formatFileSize(maxSize)}, but your file is ${formatFileSize(file.size)}. Please compress or choose a smaller image.`
    };
  }
  
  // Check file type
  if (!allowedTypes.includes(file.type)) {
    const allowedExtensions = allowedTypes.map(type => type.split('/')[1].toUpperCase()).join(', ');
    return {
      isValid: false,
      error: `Invalid file type. Only ${allowedExtensions} files are allowed. Your file type: ${file.type || 'unknown'}.`
    };
  }
  
  // Check file name
  if (file.name.length > 255) {
    return {
      isValid: false,
      error: 'File name too long. Please rename your file to be shorter than 255 characters.'
    };
  }
  
  // Check for suspicious file names
  const suspiciousPatterns = /[<>:"/\\|?*\x00-\x1f]/;
  if (suspiciousPatterns.test(file.name)) {
    return {
      isValid: false,
      error: 'Invalid file name. Please use a file name without special characters.'
    };
  }
  
  return {
    isValid: true,
    message: `File validation passed: ${file.name} (${formatFileSize(file.size)})`
  };
}

// Function to format file size for display
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to validate image dimensions (async)
function validateImageDimensions(file, maxWidth = 2048, maxHeight = 2048) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = function() {
      URL.revokeObjectURL(url);
      
      if (this.width > maxWidth || this.height > maxHeight) {
        resolve({
          isValid: false,
          error: `Image dimensions too large. Maximum allowed: ${maxWidth}x${maxHeight}px. Your image: ${this.width}x${this.height}px. Please resize your image.`
        });
      } else {
        resolve({
          isValid: true,
          dimensions: { width: this.width, height: this.height }
        });
      }
    };
    
    img.onerror = function() {
      URL.revokeObjectURL(url);
      resolve({
        isValid: false,
        error: 'Invalid image file. The file appears to be corrupted or not a valid image.'
      });
    };
    
    img.src = url;
  });
}

async function saveLogo() {
  try {
    // Get logo settings
    const logoData = {
      logoposition: document.getElementById('logoPosition').value,
      width: parseInt(document.getElementById('logoWidth').value),
      height: parseInt(document.getElementById('logoHeight').value)
    };
    
    // Handle file upload if a new file is selected
    const fileInput = document.getElementById('logoFile');
    if (fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      
      // Enhanced file validation
      const validationResult = validateLogoFile(file);
      if (!validationResult.isValid) {
        showNotification(validationResult.error, 'error');
        return;
      }
      
      // Show upload progress
      showNotification('Validating image dimensions...', 'info');
      
      // Validate image dimensions
      const dimensionValidation = await validateImageDimensions(file);
      if (!dimensionValidation.isValid) {
        showNotification(dimensionValidation.error, 'error');
        return;
      }
      
      // Update progress
      showNotification('Processing logo upload...', 'info');
      
      // Convert file to buffer for database storage
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        logoData.Logo = Array.from(buffer); // Convert to regular array for JSON serialization
        logoData.logofilename = file.name;
        console.log(`✅ Logo file processed successfully: ${file.name} (${formatFileSize(file.size)})`);
      } catch (processingError) {
        console.error('❌ Error processing logo file:', processingError);
        showNotification('Failed to process logo file. Please try a different file.', 'error');
        return;
      }
    } else {
      // No new file selected - preserve existing logo data
      // First, get the current logo data to preserve it
      try {
        const currentLogoResponse = await fetch('/api/logos');
        if (currentLogoResponse.ok) {
          const currentLogoData = await currentLogoResponse.json();
          if (currentLogoData.Logo && Array.isArray(currentLogoData.Logo) && currentLogoData.Logo.length > 0) {
            // Preserve existing logo data
            logoData.Logo = currentLogoData.Logo;
            logoData.logofilename = currentLogoData.logofilename;
            console.log('📋 Preserving existing logo data for update');
          }
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch current logo data:', error);
        // Continue without preserving - this might be a new logo
      }
    }
    
    // Save logo to database
    const response = await fetch('/api/logos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
      },
      body: JSON.stringify(logoData)
    });
    
    if (response.ok) {
      showNotification('Logo saved successfully!', 'success');
      closeLogoModal();
    } else {
      const error = await response.json();
      
      // Handle detailed validation errors from server
      if (error.details && Array.isArray(error.details)) {
        const errorMessage = error.details.join('. ');
        showNotification(`Validation failed: ${errorMessage}`, 'error');
      } else {
        showNotification(error.error || 'Failed to save logo', 'error');
      }
    }
  } catch (error) {
    console.error('❌ Error saving logo:', error);
    showNotification('Failed to save logo. Please try again.', 'error');
  }
}

async function deleteLogo() {
  if (!confirm('Are you sure you want to delete the current logo?')) {
    return;
  }
  
  try {
    const response = await fetch('/api/logos', {
      method: 'DELETE'
    });
    
    if (response.ok) {
      // Reset preview
      const logoPreview = document.getElementById('logoPreview');
      logoPreview.innerHTML = '<i class="fas fa-image"></i><p>No logo uploaded</p>';
      document.getElementById('deleteLogoBtn').style.display = 'none';
      document.getElementById('logoFile').value = '';
      
      // Clear logo width and height values
      document.getElementById('logoWidth').value = '';
      document.getElementById('logoHeight').value = '';
      
      showNotification('Logo deleted successfully!', 'success');
    } else {
      const error = await response.json();
      showNotification(error.error || 'Failed to delete logo', 'error');
    }
  } catch (error) {
    console.error('Error deleting logo:', error);
    showNotification('Failed to delete logo', 'error');
  }
}

// Email Configuration Modal Functions
function openEmailSettingsDialog() {
  // Check if user is logged into QuickBooks
  if (!isLoggedInToQuickbooks) {
    showNotification('Please connect to QuickBooks first to manage email settings.', 'warning');
    return;
  }
  
  // Close dropdown menu
  const dropdownMenu = document.getElementById('dropdownMenu');
  if (dropdownMenu) {
    dropdownMenu.classList.remove('show');
  }
  
  // Initialize checkbox to unchecked state first (hide fields initially)
  const checkbox = document.getElementById('useCustomEmail');
  if (checkbox) {
    checkbox.checked = false;
  }
  // Hide fields initially before loading settings
  toggleEmailFields();
  
  // Load email settings (this will update checkbox and fields if custom is enabled)
  loadEmailSettings();
  
  // Show modal
  const modal = document.getElementById('emailSettingsModal');
  if (modal) {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }
}

function closeEmailSettingsModal() {
  const modal = document.getElementById('emailSettingsModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }
  
  // Reset form
  const form = document.getElementById('emailForm');
  if (form) {
    form.reset();
  }
}

function toggleEmailFields() {
  const checkbox = document.getElementById('useCustomEmail');
  const fieldsContainer = document.getElementById('emailFieldsContainer');
  const defaultInfo = document.getElementById('defaultEmailInfo');
  
  if (!checkbox || !fieldsContainer || !defaultInfo) {
    console.warn('Email form elements not found');
    return;
  }
  
  const useCustom = checkbox.checked;
  
  if (useCustom) {
    // Show custom fields
    fieldsContainer.style.display = 'block';
    defaultInfo.style.display = 'none';
    
    // Enable all fields
    const fields = fieldsContainer.querySelectorAll('input, select');
    fields.forEach(field => {
      field.disabled = false;
      field.required = true;
    });
  } else {
    // Hide custom fields
    fieldsContainer.style.display = 'none';
    defaultInfo.style.display = 'block';
    
    // Disable all fields
    const fields = fieldsContainer.querySelectorAll('input, select');
    fields.forEach(field => {
      field.disabled = true;
      field.required = false;
    });
  }
}

async function loadEmailSettings() {
  try {
    console.log('🔍 Loading email settings...');
    const response = await fetch('/api/email/settings');
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Error loading email settings:', error);
      showNotification(error.error || 'Failed to load email settings', 'error');
      return;
    }
    
    const settings = await response.json();
    console.log('📊 Email settings received:', { ...settings, hasPassword: settings.hasPassword });
    
    // Check if custom email is enabled (default to false if not set)
    const useCustom = settings.useCustom === 'true' || settings.useCustom === true;
    const checkbox = document.getElementById('useCustomEmail');
    if (checkbox) {
      checkbox.checked = useCustom;
    }
    
    // Toggle fields based on checkbox state (this will hide/show appropriately)
    toggleEmailFields();
    
    // Populate form fields (only if custom is enabled)
    if (useCustom) {
      document.getElementById('emailFrom').value = settings.from || '';
      document.getElementById('emailHost').value = settings.host || '';
      document.getElementById('emailPort').value = settings.port || '';
      document.getElementById('emailSecure').checked = settings.secure === 'true';
      document.getElementById('emailUser').value = settings.user || '';
      
      // Don't populate password field - user needs to re-enter if changing
      // Only clear it if password is not set
      if (!settings.hasPassword) {
        document.getElementById('emailPass').value = '';
      }
    }
    
    console.log('✅ Email settings loaded successfully');
  } catch (error) {
    console.error('❌ Error loading email settings:', error);
    showNotification('Failed to load email settings. Please try again.', 'error');
  }
}

async function saveEmailSettings() {
  try {
    const form = document.getElementById('emailForm');
    if (!form) {
      showNotification('Email form not found', 'error');
      return;
    }
    
    const useCustom = document.getElementById('useCustomEmail').checked;
    
    const formData = {
      useCustom: useCustom,
      from: useCustom ? document.getElementById('emailFrom').value.trim() : '',
      host: useCustom ? document.getElementById('emailHost').value.trim() : '',
      port: useCustom ? document.getElementById('emailPort').value.trim() : '',
      secure: useCustom ? document.getElementById('emailSecure').checked : false,
      user: useCustom ? document.getElementById('emailUser').value.trim() : '',
      pass: useCustom ? document.getElementById('emailPass').value.trim() : '' // Only sent if user enters/changes password
    };
    
    // Validate required fields only if custom email is enabled
    if (useCustom) {
      if (!formData.from || !formData.host || !formData.port || !formData.user) {
        showNotification('Please fill in all required fields', 'error');
        return;
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.from)) {
        showNotification('Please enter a valid email address for "From" field', 'error');
        return;
      }
      
      // Validate port
      const portNum = parseInt(formData.port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        showNotification('Port must be a number between 1 and 65535', 'error');
        return;
      }
    }
    
    // Password is optional - only send if provided
    // If not provided, the server will keep the existing password
    
    console.log('💾 Saving email settings...', { useCustom });
    const response = await fetch('/api/email/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      showNotification(useCustom ? 'Custom email settings saved successfully!' : 'Now using default email settings from environment variables', 'success');
      closeEmailSettingsModal();
    } else {
      showNotification(result.error || 'Failed to save email settings', 'error');
    }
  } catch (error) {
    console.error('❌ Error saving email settings:', error);
    showNotification('Failed to save email settings. Please try again.', 'error');
  }
}

async function testEmailConnection() {
  try {
    const form = document.getElementById('emailForm');
    if (!form) {
      showNotification('Email form not found', 'error');
      return;
    }
    
    const useCustom = document.getElementById('useCustomEmail').checked;
    
    if (!useCustom) {
      showNotification('Please enable "Use custom email address" to test connection with custom settings', 'warning');
      return;
    }
    
    // Read values
    const fromVal = (document.getElementById('emailFrom').value || '').trim();
    const hostVal = (document.getElementById('emailHost').value || '').trim();
    const portVal = (document.getElementById('emailPort').value || '').trim();
    const userVal = (document.getElementById('emailUser').value || '').trim();
    const passVal = (document.getElementById('emailPass').value || '').trim();
    const secureVal = document.getElementById('emailSecure').checked;
    
    // Debug log current values (without password)
    console.log('🧪 Testing email with values:', { fromVal, hostVal, portVal, userVal, secureVal });
    
    // Validate required fields (password optional)
    if (!fromVal) {
      showNotification('From email is required', 'error');
      document.getElementById('emailFrom').focus();
      return;
    }
    if (!hostVal) {
      showNotification('SMTP host is required', 'error');
      document.getElementById('emailHost').focus();
      return;
    }
    if (!portVal) {
      showNotification('SMTP port is required', 'error');
      document.getElementById('emailPort').focus();
      return;
    }
    if (!userVal) {
      showNotification('SMTP username is required', 'error');
      document.getElementById('emailUser').focus();
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(fromVal)) {
      showNotification('Please enter a valid From email address', 'error');
      document.getElementById('emailFrom').focus();
      return;
    }
    
    // Validate port range
    const portNum = parseInt(portVal, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      showNotification('Port must be a number between 1 and 65535', 'error');
      document.getElementById('emailPort').focus();
      return;
    }
    
    // Save settings first (password optional)
    console.log('💾 Saving email settings before test...');
    const saveResponse = await fetch('/api/email/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        useCustom: true,
        from: fromVal,
        host: hostVal,
        port: portVal,
        secure: secureVal,
        user: userVal,
        pass: passVal // optional; server keeps previous if empty
      })
    });
    
    if (!saveResponse.ok) {
      const error = await saveResponse.json().catch(() => ({}));
      showNotification(error.error || 'Failed to save settings', 'error');
      return;
    }
    
    // Test connection
    console.log('🧪 Testing email connection...');
    showNotification('Testing email connection...', 'info');
    
    const testResponse = await fetch('/api/email/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const testResult = await testResponse.json().catch(() => ({}));
    
    if (testResponse.ok && testResult.success) {
      showNotification('✅ Email connection test successful!', 'success');
    } else {
      showNotification(`❌ Connection test failed: ${testResult.message || testResult.error || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('❌ Error testing email connection:', error);
    showNotification('Failed to test email connection. Please try again.', 'error');
  }
}

// Logout from QuickBooks
function logoutFromQuickbooks() {
  showNotification('Logging out from QuickBooks...', 'info');
  
  fetch('/api/quickbooks/disconnect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.message) {
      showNotification(data.message, 'success');
      
      // Clear the transaction table immediately
      const tbody = document.querySelector('table tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #999;">No transactions found. Connect to QuickBooks to load transactions.</td></tr>';
      }
      
      // Refresh the page to show logged-out state
      setTimeout(() => {
        window.location.reload();
      }, 2000); // Wait 2 seconds to show the success message
    } else {
      showNotification(data.error || 'Failed to logout from QuickBooks', 'error');
    }
  })
  .catch(error => {
    console.error('Error logging out from QuickBooks:', error);
    showNotification('Failed to logout from QuickBooks', 'error');
  });
}

// Input formatting for organization form
document.addEventListener('DOMContentLoaded', function() {
  // EIN formatting (XX-XXXXXXX)
  const einInput = document.getElementById('orgEin');
  if (einInput) {
    einInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 0) {
        value = value.substring(0, 2) + '-' + value.substring(2, 9);
      }
      e.target.value = value;
    });
  }
  
  // Phone formatting for organization modal (xxx) xxx-xxxx
  const phoneInput = document.getElementById('orgPhone');
  if (phoneInput) {
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
  
  // ZIP code formatting (XXXXX or XXXXX-XXXX)
  const zipInput = document.getElementById('orgZip');
  if (zipInput) {
    zipInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 5) {
        value = value.substring(0, 5) + '-' + value.substring(5, 9);
      }
      e.target.value = value;
    });
  }
  
  // State formatting (uppercase, max 2 characters)
  const stateInput = document.getElementById('orgState');
  if (stateInput) {
    stateInput.addEventListener('input', function(e) {
      e.target.value = e.target.value.toUpperCase().substring(0, 2);
    });
  }
});

// Phone number validation function for organization modal
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

// Function to open a PDF in a new window (legacy function)
function openPDF(pdfPath) {
  window.open(pdfPath, '_blank', 'width=800,height=600');
}

// Function to generate receipt for a transaction
async function generateReceipt(transactionId) {
  console.log('Generating receipt for transaction:', transactionId);
  
  try {
    // Show loading state
    const icon = event.target;
    const originalClass = icon.className;
    icon.className = 'fas fa-spinner fa-spin icon';
    icon.style.color = '#007bff';
    
    // Call the receipt generation API
    const response = await fetch(`/api/receipts/generate/${transactionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    
    if (response.ok) {
      // Receipt generated successfully - show view link
        icon.className = 'fas fa-check icon';
        icon.style.color = '#28a745';
        icon.title = 'Receipt Generated - Click to View';
        
        // Change click handler to open receipt in modal
        icon.onclick = () => {
        openPdfModal(transactionId);
        };
        
        showNotification('Receipt generated successfully!', 'success');
      
      // Update the UI to show the "View Receipt" button without refreshing
      updateReceiptButtons(transactionId);
      
    } else {
      throw new Error(result.error || 'Failed to generate receipt');
    }
    
  } catch (error) {
    console.error('❌ Error generating receipt:', error);
    
    // Reset icon to error state
    const icon = event.target;
    icon.className = 'fas fa-exclamation-triangle icon';
    icon.style.color = '#dc3545';
    icon.title = 'Error generating receipt';
    
    showNotification(`Failed to generate receipt: ${error.message}`, 'error');
    
    // Reset icon after 3 seconds
    setTimeout(() => {
      icon.className = 'fas fa-receipt icon';
      icon.style.color = '#28a745';
      icon.title = 'Generate Receipt';
      icon.onclick = () => generateReceipt(transactionId);
    }, 3000);
  }
}

// Beta: submit invite code before connecting to QuickBooks
async function submitBetaCode() {
  const input = document.getElementById('betaInviteCode');
  const submitBtn = document.getElementById('betaCodeSubmit');
  const successEl = document.getElementById('betaCodeSuccess');
  const errorEl = document.getElementById('betaCodeError');
  const code = input && input.value ? input.value.trim() : '';
  if (!code) {
    if (successEl) successEl.classList.add('beta-code-hidden');
    if (errorEl) { errorEl.textContent = 'Please enter your invite code.'; errorEl.classList.remove('beta-code-hidden'); }
    return;
  }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
  if (errorEl) errorEl.classList.add('beta-code-hidden');
  if (successEl) successEl.classList.add('beta-code-hidden');
  try {
    const res = await fetch('/api/beta/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (successEl) { successEl.classList.remove('beta-code-hidden'); successEl.textContent = data.message || 'Invite code accepted. You can now connect to QuickBooks.'; }
      if (errorEl) errorEl.classList.add('beta-code-hidden');
    } else {
      if (errorEl) { errorEl.textContent = data.error || 'Invalid invite code.'; errorEl.classList.remove('beta-code-hidden'); }
      if (successEl) successEl.classList.add('beta-code-hidden');
    }
  } catch (e) {
    if (errorEl) { errorEl.textContent = 'Could not validate code. Please try again.'; errorEl.classList.remove('beta-code-hidden'); }
    if (successEl) successEl.classList.add('beta-code-hidden');
  }
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
}

// Function to sync with Quickbooks
async function syncWithQuickbooks() {
  console.log('Sync with Quickbooks button clicked');
  
  const button = document.querySelector('.qb-connect-btn');
  const srText = button ? button.querySelector('.sr-only') : null;
  const originalLabel = button ? (srText ? srText.textContent.trim() : button.getAttribute('aria-label') || 'Sync with QuickBooks') : 'Sync with QuickBooks';
  
  const setButtonState = (label, options = {}) => {
    if (!button) return;
    if (srText) {
      srText.textContent = label;
    }
    button.setAttribute('aria-label', label);
    button.disabled = !!options.disabled;
    button.classList.remove('loading', 'success', 'error');
    if (options.loading) button.classList.add('loading');
    if (options.success) button.classList.add('success');
    if (options.error) button.classList.add('error');
  };
  
  const resetButtonState = () => setButtonState(originalLabel, { disabled: false });
  
  try {
    setButtonState('Connecting to QuickBooks', { loading: true, disabled: true });
    
    // Check Quickbooks connection status first
    const statusResponse = await fetch('/api/quickbooks/status');
    const status = await statusResponse.json();
    
    if (!status.isAuthenticated) {
      // Not connected: check Terms of Service option before redirecting
      setButtonState('Connect to QuickBooks', { disabled: false });

      // First check localStorage for ToS agreement
      try {
        const localTosAgreed = localStorage.getItem('tosAgreed');
        if (localTosAgreed === 'true') {
          // Already agreed in localStorage, proceed to connect
          window.location.href = '/auth/quickbooks';
          return;
        }
      } catch (e) {
        // If localStorage check fails, continue to server check
      }

      // If no localStorage agreement, check server-side option
      try {
        const tosResp = await fetch('/api/options/showtermsofservice');
        if (!tosResp.ok) {
          // No option set yet => show ToS modal
          openTermsModal();
          return;
        }
        const tos = await tosResp.json();
        if (!tos || tos.value !== 'false') {
          openTermsModal();
          return;
        }
        // Server-side agreement found, also set localStorage for future
        try {
          localStorage.setItem('tosAgreed', 'true');
        } catch (e) {
          // Ignore localStorage errors
        }
      } catch (e) {
        // On error, be safe and show ToS
        openTermsModal();
        return;
      }

      // ToS already agreed
      window.location.href = '/auth/quickbooks';
      return;
    }
    
    console.log('✅ Connected to Quickbooks successfully');
    console.log('📊 Fetching transaction report...');
    
    // Get transaction report (server will use defaults)
    const transactionResponse = await fetch('/api/quickbooks/transactions', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const transactionResult = await transactionResponse.json();
    
    if (transactionResponse.ok) {
      console.log('📈 Transaction Report Results:');
      console.log('==============================');
      console.log('Message:', transactionResult.message);
      console.log('Parameters used:', transactionResult.params);
      console.log('Transaction Data:', transactionResult.data);
      console.log('Extracted Transactions:', transactionResult.transactions);
      console.log('Valid Transactions:', transactionResult.validTransactions);
      
      if (transactionResult.databaseResults) {
        console.log('💾 Database Results:');
        console.log('===================');
        console.log(`Total transactions: ${transactionResult.databaseResults.total}`);
        console.log(`Successfully added: ${transactionResult.databaseResults.added}`);
        console.log(`Skipped (duplicates): ${transactionResult.databaseResults.skipped}`);
        if (transactionResult.databaseResults.errors.length > 0) {
          console.log(`Errors: ${transactionResult.databaseResults.errors.length}`);
          console.log('Error details:', transactionResult.databaseResults.errors);
        }
      }
      
      // Show success message
      setButtonState('Connected to QuickBooks', { success: true, disabled: true });
      
      // Show success notification with database results
      let notificationMessage = 'Successfully connected to Quickbooks and fetched transaction report!';
      if (transactionResult.databaseResults) {
        notificationMessage += ` Added ${transactionResult.databaseResults.added} transactions to database.`;
        if (transactionResult.databaseResults.skipped > 0) {
          notificationMessage += ` Skipped ${transactionResult.databaseResults.skipped} duplicates.`;
        }
      }
      showNotification(notificationMessage, 'success');
      
      // Refresh the page to show updated transaction list with donor names/emails
      setTimeout(() => {
        window.location.reload();
      }, 2000); // Wait 2 seconds to show the success message
    } else {
      throw new Error(transactionResult.error || 'Failed to fetch transaction report');
    }
    
  } catch (error) {
    console.error('❌ Quickbooks connection error:', error);
    
    // Show error state
    setButtonState('Error connecting to QuickBooks', { error: true, disabled: false });
    
    showNotification(`Quickbooks connection failed: ${error.message}`, 'error');
    
    // Reset button after 3 seconds
    setTimeout(() => {
      resetButtonState();
    }, 3000);
  }
}

// Function to refresh QuickBooks data
async function refreshQuickbooksData() {
  console.log('Refresh QuickBooks data button clicked');
  
  const button = document.querySelector('.qb-refresh-btn');
  if (!button) {
    console.error('Refresh button not found');
    return;
  }
  
  const originalLabel = button.getAttribute('aria-label') || 'Refresh QuickBooks Data';
  const originalHTML = button.innerHTML;
  
  const setButtonState = (label, options = {}) => {
    button.setAttribute('aria-label', label);
    button.disabled = !!options.disabled;
    button.classList.remove('loading', 'success', 'error');
    if (options.loading) {
      button.classList.add('loading');
      button.innerHTML = '<i class="fas fa-sync-alt fa-spin" aria-hidden="true"></i><span>Refreshing...</span>';
    } else if (options.success) {
      button.classList.add('success');
      button.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i><span>Refreshed!</span>';
    } else if (options.error) {
      button.classList.add('error');
      button.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i><span>Error</span>';
    } else {
      button.innerHTML = originalHTML;
    }
  };
  
  const resetButtonState = () => {
    setButtonState(originalLabel, { disabled: false });
  };
  
  try {
    setButtonState('Refreshing QuickBooks Data...', { loading: true, disabled: true });
    
    // Check Quickbooks connection status first
    const statusResponse = await fetch('/api/quickbooks/status');
    const status = await statusResponse.json();
    
    if (!status.isAuthenticated) {
      throw new Error('Not connected to QuickBooks. Please connect first.');
    }
    
    console.log('✅ Connected to Quickbooks, fetching transaction report...');
    
    // Get transaction report (server will use defaults)
    const transactionResponse = await fetch('/api/quickbooks/transactions', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const transactionResult = await transactionResponse.json();
    
    if (transactionResponse.ok) {
      console.log('📈 Transaction Report Results:');
      console.log('==============================');
      console.log('Message:', transactionResult.message);
      console.log('Parameters used:', transactionResult.params);
      
      if (transactionResult.databaseResults) {
        console.log('💾 Database Results:');
        console.log('===================');
        console.log(`Total transactions: ${transactionResult.databaseResults.total}`);
        console.log(`Successfully added: ${transactionResult.databaseResults.added}`);
        console.log(`Skipped (duplicates): ${transactionResult.databaseResults.skipped}`);
        if (transactionResult.databaseResults.errors.length > 0) {
          console.log(`Errors: ${transactionResult.databaseResults.errors.length}`);
          console.log('Error details:', transactionResult.databaseResults.errors);
        }
      }
      
      // Show success message
      setButtonState('Refreshed!', { success: true, disabled: false });
      
      // Show success notification with database results
      let notificationMessage = 'QuickBooks data refreshed successfully!';
      if (transactionResult.databaseResults) {
        notificationMessage += ` Added ${transactionResult.databaseResults.added} new transactions.`;
        if (transactionResult.databaseResults.skipped > 0) {
          notificationMessage += ` Skipped ${transactionResult.databaseResults.skipped} duplicates.`;
        }
      }
      showNotification(notificationMessage, 'success');
      
      // Refresh the page to show updated transaction list
      setTimeout(() => {
        window.location.reload();
      }, 2000); // Wait 2 seconds to show the success message
    } else {
      throw new Error(transactionResult.error || 'Failed to refresh QuickBooks data');
    }
    
  } catch (error) {
    console.error('❌ QuickBooks refresh error:', error);
    
    // Show error state
    setButtonState('Error refreshing data', { error: true, disabled: false });
    
    showNotification(`QuickBooks refresh failed: ${error.message}`, 'error');
    
    // Reset button after 3 seconds
    setTimeout(() => {
      resetButtonState();
    }, 3000);
  }
}

// Function to generate all receipts
async function generateAllReceipts() {
  console.log('Generating receipts for all transactions');
  
  const button = document.querySelector('.receipt-button');
  const originalText = button.innerHTML;
  
  try {
    // Show loading state
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    button.disabled = true;
    
    // Call the generate all receipts API
    const response = await fetch('/api/receipts/generate-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    
    if (response.ok) {
      // Success
      button.innerHTML = '<i class="fas fa-check"></i> Generated!';
      button.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
      
      showNotification(`Receipt generation completed! Generated: ${result.results.generated}, Skipped: ${result.results.skipped}`, 'success');
      
      // Reset button after 5 seconds
      setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
        button.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
      }, 5000);
      
    } else {
      throw new Error(result.error || 'Failed to generate receipts');
    }
    
  } catch (error) {
    console.error('❌ Error generating all receipts:', error);
    
    // Show error state
    button.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
    button.style.background = 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)';
    
    showNotification(`Failed to generate receipts: ${error.message}`, 'error');
    
    // Reset button after 3 seconds
    setTimeout(() => {
      button.innerHTML = originalText;
      button.disabled = false;
      button.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
    }, 3000);
  }
}

// Email Receipt Functions
let currentEmailTransactionId = null;

function openEmailDialog(transactionId) {
  currentEmailTransactionId = transactionId;
  
  // Get donor email from the table row data attribute
  const emailIcon = document.querySelector(`i[onclick*="openEmailDialog('${transactionId}')"]`);
  const row = emailIcon ? emailIcon.closest('tr') : null;
  
  if (row) {
    const donorEmail = row.getAttribute('data-donor-email') || '';
    document.getElementById('emailAddress').value = donorEmail;
    console.log('📧 Email field populated with donor email:', donorEmail);
  } else {
    console.warn('⚠️ Could not find row for transaction:', transactionId);
    document.getElementById('emailAddress').value = '';
  }
  
  // Reset subject and message with default intro
  const msgEl = document.getElementById('emailMessage');
  const defaultOrgName = 'your organization';
  const defaultIntro = `Thank you for your generous donation to ${defaultOrgName}.`;
  document.getElementById('emailSubject').value = 'Your Donation Receipt';
  msgEl.value = defaultIntro;
  
  // Try to populate real organization name and update message if user hasn't edited it
  if (typeof isLoggedInToQuickbooks !== 'undefined' && isLoggedInToQuickbooks) {
    const initialValue = msgEl.value;
    fetch('/api/organizations/current')
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(org => {
        if (org && org.name) {
          const updated = `Thank you for your generous donation to ${org.name}.`;
          if (msgEl.value === initialValue || msgEl.value === defaultIntro) {
            msgEl.value = updated;
          }
        }
      })
      .catch(() => {
        // If current org not available, optionally try list
        fetch('/api/organizations')
          .then(r => r.ok ? r.json() : Promise.reject(r))
          .then(list => {
            if (Array.isArray(list) && list.length > 0 && list[0].name) {
              const updated = `Thank you for your generous donation to ${list[0].name}.`;
              if (msgEl.value === defaultIntro) {
                msgEl.value = updated;
              }
            }
          })
          .catch(() => {/* keep default */});
      });
  }
  
  // Show modal
  document.getElementById('emailModal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeEmailModal() {
  document.getElementById('emailModal').style.display = 'none';
  document.body.style.overflow = 'auto';
  currentEmailTransactionId = null;
}

async function sendReceiptEmail() {
  if (!currentEmailTransactionId) {
    showNotification('No transaction selected for email', 'error');
    return;
  }
  
  const emailAddress = document.getElementById('emailAddress').value;
  const subject = document.getElementById('emailSubject').value;
  const message = document.getElementById('emailMessage').value;
  
  if (!emailAddress) {
    showNotification('Email address is required', 'error');
    return;
  }
  
  try {
    // Show loading state
    const sendButton = document.querySelector('#emailModal .btn-primary');
    const originalText = sendButton.innerHTML;
    sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    sendButton.disabled = true;
    
    // Send email request
    const response = await fetch('/api/receipts/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transactionId: currentEmailTransactionId,
        email: emailAddress,
        subject: subject,
        message: message
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      showNotification('Receipt email sent successfully!', 'success');
      closeEmailModal();
    } else {
      throw new Error(result.error || 'Failed to send email');
    }
    
    // Reset button on success
    sendButton.innerHTML = 'Send Email';
    sendButton.disabled = false;
    
  } catch (error) {
    console.error('❌ Error sending email:', error);
    showNotification(`Failed to send email: ${error.message}`, 'error');
    
    // Reset button
    const sendButton = document.querySelector('#emailModal .btn-primary');
    sendButton.innerHTML = 'Send Email';
    sendButton.disabled = false;
  }
}

// Function to show notifications
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
      <span>${message}</span>
      <button onclick="this.parentElement.parentElement.remove()" class="notification-close">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  
  // Add to page
  document.body.appendChild(notification);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}

// Global variables for sorting
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Function to sort table
function sortTable(column) {
  const table = document.querySelector('table');
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  // Update sort direction
  if (currentSortColumn === column) {
    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortColumn = column;
    currentSortDirection = 'asc';
  }
  
  // Update sort icons
  updateSortIcons(column, currentSortDirection);
  
  // Sort the rows
  rows.sort((a, b) => {
    let aValue = getCellValue(a, column);
    let bValue = getCellValue(b, column);
    
    // Handle different data types
    if (column === 'date') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
    } else if (column === 'amount') {
      // Remove currency symbols and convert to number
      aValue = parseFloat(aValue.replace(/[$,]/g, '')) || 0;
      bValue = parseFloat(bValue.replace(/[$,]/g, '')) || 0;
    } else {
      // String comparison (case-insensitive)
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }
    
    // Compare values
    if (aValue < bValue) {
      return currentSortDirection === 'asc' ? -1 : 1;
    }
    if (aValue > bValue) {
      return currentSortDirection === 'asc' ? 1 : -1;
    }
    return 0;
  });
  
  // Reorder the table
  rows.forEach(row => tbody.appendChild(row));
}

// Function to get cell value
function getCellValue(row, column) {
  const columnIndex = getColumnIndex(column);
  const cell = row.cells[columnIndex];
  return cell ? cell.textContent.trim() : '';
}

// Function to get column index
function getColumnIndex(column) {
  const headers = document.querySelectorAll('th[data-column]');
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].getAttribute('data-column') === column) {
      return i;
    }
  }
  return 0;
}

// Smart search functionality
let allTableData = []; // Store original data for filtering
let currentFilter = null;

// Initialize search functionality
function initializeSearch() {
  // Store original table data
  const rows = document.querySelectorAll('tbody tr');
  allTableData = Array.from(rows).map(row => {
    const cells = row.cells;
    return {
      element: row,
      date: cells[0] ? cells[0].textContent.trim() : '',
      donor_name: cells[1] ? cells[1].textContent.trim() : '',
      donor_email: cells[2] ? cells[2].textContent.trim() : '',
      amount: cells[3] ? cells[3].textContent.trim() : '',
      qb_docnum: cells[4] ? cells[4].textContent.trim() : ''
    };
  });
  
  // Add search input event listeners
  const searchInput = document.getElementById('tableSearch');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('focus', showSearchSuggestions);
    searchInput.addEventListener('blur', hideSearchSuggestions);
  }
}

// Handle search input with suggestions
function handleSearchInput(event) {
  const query = event.target.value.toLowerCase().trim();
  
  if (query.length === 0) {
    clearFilter();
    return;
  }
  
  // Check for time period filters
  const timeFilter = parseTimePeriod(query);
  if (timeFilter) {
    applyTimeFilter(timeFilter);
    showSearchSuggestions(); // Show suggestions even after time filter
    return;
  }
  
  // Regular text search
  filterTableByText(query);
  showSearchSuggestions();
}

// Parse time period expressions
function parseTimePeriod(query) {
  const now = new Date();
  const timeExpressions = {
    'today': () => {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return { start: today, end: new Date(now) };
    },
    'yesterday': () => {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const end = new Date(yesterday);
      end.setHours(23, 59, 59, 999);
      return { start: yesterday, end: end };
    },
    'this week': () => {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      return { start: start, end: new Date(now) };
    },
    'last week': () => {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay() - 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start: start, end: end };
    },
    'this month': () => {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start, end: new Date(now) };
    },
    'last month': () => {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      return { start: start, end: end };
    },
    'this year': () => {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start: start, end: new Date(now) };
    },
    'last year': () => {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31);
      end.setHours(23, 59, 59, 999);
      return { start: start, end: end };
    }
  };
  
  // Check for exact matches first
  for (const [key, func] of Object.entries(timeExpressions)) {
    if (query === key) {
      return { type: 'time', period: key, ...func() };
    }
  }
  
  // Check for partial matches only if query is substantial enough
  if (query.length >= 3) {
    for (const [key, func] of Object.entries(timeExpressions)) {
      if (key.includes(query) || query.includes(key.split(' ')[0])) {
        return { type: 'time', period: key, ...func() };
      }
    }
  }
  
  return null;
}

// Apply time period filter
function applyTimeFilter(timeFilter) {
  currentFilter = timeFilter;
  
  allTableData.forEach(rowData => {
    const rowDate = parseTableDate(rowData.date);
    const isVisible = rowDate && rowDate >= timeFilter.start && rowDate <= timeFilter.end;
    
    rowData.element.style.display = isVisible ? '' : 'none';
  });
  
  // Don't update the search input - let user continue typing
}

// Parse date from table format (MM-DD-YY)
function parseTableDate(dateStr) {
  if (!dateStr || dateStr === '-') return null;
  
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  
  const month = parseInt(parts[0]) - 1; // JavaScript months are 0-based
  const day = parseInt(parts[1]);
  const year = 2000 + parseInt(parts[2]); // Convert YY to YYYY
  
  return new Date(year, month, day);
}

// Filter table by text search
function filterTableByText(query) {
  currentFilter = { type: 'text', query: query };
  
  allTableData.forEach(rowData => {
    const searchText = `${rowData.date} ${rowData.donor_name} ${rowData.donor_email} ${rowData.amount} ${rowData.qb_docnum}`.toLowerCase();
    const isVisible = searchText.includes(query);
    
    rowData.element.style.display = isVisible ? '' : 'none';
  });
}

// Clear all filters
function clearFilter() {
  currentFilter = null;
  allTableData.forEach(rowData => {
    rowData.element.style.display = '';
  });
  hideSearchSuggestions();
}

// Update search input with filter info
function updateSearchInput(value) {
  const searchInput = document.getElementById('tableSearch');
  if (searchInput) {
    searchInput.value = value;
  }
}

// Show search suggestions
function showSearchSuggestions() {
  const suggestions = document.getElementById('searchSuggestions');
  if (!suggestions) return;
  
  const query = document.getElementById('tableSearch').value.toLowerCase().trim();
  
  // Don't show suggestions if query is empty
  if (query.length === 0) {
    suggestions.style.display = 'none';
    return;
  }
  
  const timeSuggestions = [
    'today', 'yesterday', 'this week', 'last week', 
    'this month', 'last month', 'this year', 'last year'
  ];
  
  const filteredSuggestions = timeSuggestions.filter(suggestion => 
    suggestion.includes(query) && suggestion !== query
  );
  
  if (filteredSuggestions.length > 0) {
    // Sanitize suggestions to prevent XSS
    const sanitize = window.sanitizeForHTML || ((s) => s.replace(/[&<>"']/g, (m) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
      return map[m];
    }));
    suggestions.innerHTML = filteredSuggestions.map(suggestion => {
      const safeSuggestion = sanitize(suggestion);
      return `
      <div class="search-suggestion" onclick="selectSuggestion('${safeSuggestion.replace(/'/g, "\\'")}')">
        <div class="suggestion-type">Time Period</div>
        <div class="suggestion-text">${safeSuggestion}</div>
      </div>
    `;
    }).join('');
    suggestions.style.display = 'block';
  } else {
    suggestions.style.display = 'none';
  }
}

// Hide search suggestions
function hideSearchSuggestions() {
  setTimeout(() => {
    const suggestions = document.getElementById('searchSuggestions');
    if (suggestions) {
      suggestions.style.display = 'none';
    }
  }, 200);
}

// Select a search suggestion
function selectSuggestion(suggestion) {
  const searchInput = document.getElementById('tableSearch');
  if (searchInput) {
    searchInput.value = suggestion;
    handleSearchInput({ target: searchInput });
  }
  hideSearchSuggestions();
}

// Legacy function for backward compatibility
function filterTable() {
  // This function is called by the onkeyup event in the HTML
  // The actual filtering is handled by handleSearchInput
}

// Function to update receipt buttons after generation
function updateReceiptButtons(transactionId) {
  // Find the table row for this transaction by looking for the generate receipt button with matching onclick
  const generateButtons = document.querySelectorAll('i[onclick*="generateReceipt"]');
  let targetRow = null;
  
  for (let button of generateButtons) {
    const onclickAttr = button.getAttribute('onclick');
    if (onclickAttr && onclickAttr.includes(`generateReceipt('${transactionId}')`)) {
      // Found the button for this transaction, get its parent row
      targetRow = button.closest('tr');
      break;
    }
  }
  
  if (targetRow) {
    // Find the action cell (last cell in the row)
    const actionCell = targetRow.cells[targetRow.cells.length - 1];
    
    if (actionCell) {
      // Create the new action buttons HTML (View, Generate, Email)
      const newActionHTML = `
        <i class="fas fa-file-pdf icon" 
           title="View Receipt" 
           onclick="openReceipt('${transactionId}')"></i>
        <i class="fa-solid fa-receipt icon" 
           title="Generate Receipt" 
           onclick="generateReceipt('${transactionId}')"
           style="margin-left: 10px;"></i>
        <i class="fas fa-envelope icon" 
           title="Email Receipt" 
           onclick="openEmailDialog('${transactionId}')"
           style="margin-left: 10px; color: #007bff;"></i>
      `;
      
      // Update the action cell content
      actionCell.innerHTML = newActionHTML;
      
      console.log(`✅ Updated receipt buttons for transaction ${transactionId}`);
    }
  } else {
    console.warn(`⚠️ Could not find row for transaction ${transactionId}`);
  }
}

// Function to update sort icons
function updateSortIcons(activeColumn, direction) {
  const headers = document.querySelectorAll('th[data-column]');
  
  headers.forEach(header => {
    const icon = header.querySelector('i');
    const column = header.getAttribute('data-column');
    
    if (column === activeColumn) {
      icon.className = direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
    } else {
      icon.className = 'fas fa-sort';
    }
  });
}

// Function to toggle menu (legacy - replaced by hamburger menu functionality)

// Add some interactive features
document.addEventListener('DOMContentLoaded', function() {
  // Initialize search functionality
  initializeSearch();
  
  // Add click event listeners to table rows for better UX
  const tableRows = document.querySelectorAll('tbody tr');
  
  tableRows.forEach(row => {
    row.addEventListener('click', function(e) {
      // Don't trigger if clicking on the PDF icon (it has its own handler)
      if (!e.target.classList.contains('icon')) {
        this.style.backgroundColor = '#e8f5e8';
        setTimeout(() => {
          this.style.backgroundColor = '';
        }, 200);
      }
    });
  });
  
  // Add keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      // Close any open modals or reset table state
      tableRows.forEach(row => {
        row.style.backgroundColor = '';
      });
    }
  });
  
  // Initialize column resizing
  initializeColumnResizing();
});

// Column resizing functionality
function initializeColumnResizing() {
  const table = document.querySelector('table');
  if (!table) return;
  
  const headers = table.querySelectorAll('th');
  let isResizing = false;
  let currentHeader = null;
  let startX = 0;
  let startWidth = 0;
  
  headers.forEach(header => {
    header.addEventListener('mousedown', function(e) {
      const rect = header.getBoundingClientRect();
      const isNearRightEdge = e.clientX > rect.right - 8;
      
      if (isNearRightEdge) {
        isResizing = true;
        currentHeader = header;
        startX = e.clientX;
        startWidth = header.offsetWidth;
        
        header.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        e.preventDefault();
      }
    });
  });
  
  document.addEventListener('mousemove', function(e) {
    if (!isResizing || !currentHeader) return;
    
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + deltaX); // Minimum width of 50px
    
    currentHeader.style.width = newWidth + 'px';
    
    // Update all cells in the same column
    const columnIndex = Array.from(currentHeader.parentElement.children).indexOf(currentHeader);
    const rows = table.querySelectorAll('tbody tr');
    
    rows.forEach(row => {
      const cell = row.children[columnIndex];
      if (cell) {
        cell.style.width = newWidth + 'px';
      }
    });
  });
  
  document.addEventListener('mouseup', function() {
    if (isResizing && currentHeader) {
      isResizing = false;
      currentHeader.classList.remove('resizing');
      currentHeader = null;
      
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Auto-sync with QuickBooks if redirected from successful connection
document.addEventListener('DOMContentLoaded', async function() {
  // Check if we have the quickbooks_connected parameter in the URL
  const urlParams = new URLSearchParams(window.location.search);
  const quickbooksConnected = urlParams.get('quickbooks_connected');
  
  if (quickbooksConnected === 'true') {
    console.log('🔄 Auto-syncing with QuickBooks after successful connection...');
    
    // Show a notification that we're syncing
    showNotification('QuickBooks connected! Syncing transactions...', 'info');
    
    // Flush any pending welcome preference now that we're logged in
    await flushPendingWelcomePreference();
    
    // Automatically trigger the QuickBooks sync
    setTimeout(() => {
      syncWithQuickbooks();
    }, 1000); // Small delay to let the page fully load
    
    // Clean up the URL parameter
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }
});

// Transaction Items Modal Functions
async function showTransactionItems(transactionId) {
  console.log('Showing items for transaction:', transactionId);
  
  try {
    // Fetch transaction items
    const response = await fetch(`/api/transaction-items/transaction/${transactionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const items = await response.json();
    
    // Populate the items modal
    const itemsList = document.getElementById('itemsList');
    
    if (items.length === 0) {
      itemsList.innerHTML = '<p>No items found for this transaction.</p>';
    } else {
      // Create table HTML
      let tableHTML = `
        <table class="items-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Quantity</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      items.forEach(item => {
        tableHTML += `
          <tr>
            <td class="description">
              <span class="editable-description" 
                    contenteditable="true" 
                    data-item-id="${item.id}"
                    data-original-description="${escapeHtml(item.description)}"
                    onblur="saveModalDescription(this)"
                    onkeydown="handleDescriptionKeydown(event, this)">${escapeHtml(item.description)}</span>
            </td>
            <td class="quantity">${item.quantity}</td>
            <td class="amount">${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(item.amount) || 0)}</td>
          </tr>
        `;
      });
      
      tableHTML += `
          </tbody>
        </table>
      `;
      
      itemsList.innerHTML = tableHTML;
    }
    
    // Show the modal
    const modal = document.getElementById('itemsModal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
  } catch (error) {
    console.error('❌ Error fetching transaction items:', error);
    showNotification(`Failed to load transaction items: ${error.message}`, 'error');
  }
}

function closeItemsModal() {
  const modal = document.getElementById('itemsModal');
  modal.style.display = 'none';
  document.body.style.overflow = 'auto';
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close modal when clicking outside of it
window.addEventListener('click', function(event) {
  const itemsModal = document.getElementById('itemsModal');
  if (event.target === itemsModal) {
    closeItemsModal();
  }
});

// ===== EDITABLE DESCRIPTION FUNCTIONS =====

/**
 * Saves the edited description to the transaction_items table
 * @param {HTMLElement} element - The contenteditable span element
 */
async function saveDescription(element) {
  const transactionId = element.getAttribute('data-transaction-id');
  const itemId = element.getAttribute('data-item-id');
  const newDescription = element.textContent.trim();
  const originalDescription = element.getAttribute('data-original-description') || '';
  
  // If description hasn't changed, don't save
  if (newDescription === originalDescription) {
    return;
  }
  
  // Store original description for future comparisons
  element.setAttribute('data-original-description', newDescription);
  
  console.log('💾 Saving description:', {
    transactionId,
    itemId,
    newDescription
  });
  
  try {
    // Show saving indicator
    const originalText = element.textContent;
    element.style.opacity = '0.6';
    
    // If we have an itemId, update the existing transaction item
    if (itemId) {
      const response = await fetch(`/api/transaction-items/${itemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: newDescription
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update description');
      }
      
      const result = await response.json();
      console.log('✅ Description updated successfully:', result);
    } else {
      // If no itemId, we need to get the transaction items for this transaction
      // and update the first one (single item case)
      const itemsResponse = await fetch(`/api/transaction-items/transaction/${transactionId}`);
      
      if (!itemsResponse.ok) {
        throw new Error('Failed to fetch transaction items');
      }
      
      const items = await itemsResponse.json();
      
      if (items && items.length > 0) {
        // Update the first item
        const firstItem = items[0];
        const updateResponse = await fetch(`/api/transaction-items/${firstItem.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            description: newDescription,
            quantity: firstItem.quantity,
            amount: firstItem.amount,
            lineNum: firstItem.lineNum,
            unitPrice: firstItem.unitPrice
          })
        });
        
        if (!updateResponse.ok) {
          throw new Error('Failed to update description');
        }
        
        const result = await updateResponse.json();
        console.log('✅ Description updated successfully:', result);
        
        // Store the itemId for future updates
        element.setAttribute('data-item-id', firstItem.id);
      } else {
        console.error('❌ No transaction items found for transaction:', transactionId);
        alert('Error: No transaction items found to update');
        element.textContent = originalText;
      }
    }
    
    // Remove saving indicator
    element.style.opacity = '1';
    
    // Show success feedback
    element.style.backgroundColor = '#d4edda';
    setTimeout(() => {
      element.style.backgroundColor = '';
    }, 1000);
    
  } catch (error) {
    console.error('❌ Error saving description:', error);
    alert('Failed to save description. Please try again.');
    
    // Restore original text
    element.textContent = originalDescription;
    element.style.opacity = '1';
  }
}

/**
 * Saves the edited description from the modal to the transaction_items table
 * @param {HTMLElement} element - The contenteditable span element in the modal
 */
async function saveModalDescription(element) {
  const itemId = element.getAttribute('data-item-id');
  const newDescription = element.textContent.trim();
  const originalDescription = element.getAttribute('data-original-description') || '';
  
  console.log('🔍 Modal save triggered:', {
    itemId,
    newDescription,
    originalDescription,
    hasChanged: newDescription !== originalDescription
  });
  
  // If description hasn't changed, don't save
  if (newDescription === originalDescription) {
    console.log('⏭️ No change detected, skipping save');
    return;
  }
  
  // Update the data attribute for future comparisons
  element.setAttribute('data-original-description', newDescription);
  
  console.log('💾 Saving modal description:', {
    itemId,
    newDescription
  });
  
  try {
    // Show saving indicator
    element.style.opacity = '0.6';
    
    // Fetch the existing item to get all fields
    console.log('📥 Fetching existing item:', itemId);
    const itemResponse = await fetch(`/api/transaction-items/${itemId}`);
    
    console.log('📊 Item fetch response status:', itemResponse.status);
    
    if (!itemResponse.ok) {
      const errorText = await itemResponse.text();
      console.error('❌ Failed to fetch item:', errorText);
      throw new Error(`Failed to fetch transaction item: ${itemResponse.status} ${errorText}`);
    }
    
    const existingItem = await itemResponse.json();
    console.log('✅ Existing item fetched:', existingItem);
    
    // Update the item with new description
    const updateData = {
      description: newDescription,
      quantity: existingItem.quantity,
      amount: existingItem.amount,
      lineNum: existingItem.lineNum,
      unitPrice: existingItem.unitPrice
    };
    
    console.log('📤 Sending update request:', updateData);
    
    const response = await fetch(`/api/transaction-items/${itemId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });
    
    console.log('📊 Update response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to update:', errorText);
      throw new Error(`Failed to update description: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ Modal description updated successfully:', result);
    
    // Remove saving indicator
    element.style.opacity = '1';
    
    // Show success feedback
    element.style.backgroundColor = '#d4edda';
    setTimeout(() => {
      element.style.backgroundColor = '';
    }, 1000);
    
    // Update the main table if needed (reload the page or update the specific row)
    // For now, we'll just show success in the modal
    
  } catch (error) {
    console.error('❌ Error saving modal description:', error);
    console.error('❌ Error details:', {
      message: error.message,
      itemId: itemId,
      newDescription: newDescription
    });
    alert(`Failed to save description. Error: ${error.message}`);
    
    // Restore original text
    element.textContent = originalDescription;
    element.style.opacity = '1';
  }
}

/**
 * Handles keydown events in the editable description field
 * @param {KeyboardEvent} event - The keyboard event
 * @param {HTMLElement} element - The contenteditable span element
 */
function handleDescriptionKeydown(event, element) {
  // Save on Enter key
  if (event.key === 'Enter') {
    event.preventDefault();
    element.blur(); // Trigger the onblur event which saves the description
  }
  
  // Cancel on Escape key
  if (event.key === 'Escape') {
    event.preventDefault();
    const originalDescription = element.getAttribute('data-original-description') || '';
    element.textContent = originalDescription;
    element.blur();
  }
}

// ===== PHONE NUMBER FORMATTING FUNCTIONS =====

/**
 * Formats a phone number to (xxx) xxx-xxxx format
 * @param {string} phone - Raw phone number
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Format as (xxx) xxx-xxxx
  if (digits.length >= 10) {
    return '(' + digits.substring(0, 3) + ') ' + digits.substring(3, 6) + '-' + digits.substring(6, 10);
  } else if (digits.length >= 6) {
    return '(' + digits.substring(0, 3) + ') ' + digits.substring(3, 6) + '-' + digits.substring(6);
  } else if (digits.length >= 3) {
    return '(' + digits.substring(0, 3) + ') ' + digits.substring(3);
  } else if (digits.length > 0) {
    return '(' + digits;
  }
  
  return '';
}

/**
 * Sets up phone number formatting for the organization phone input
 */
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
  });
}

// ===== EIN FORMATTING FUNCTIONS =====

/**
 * Formats an EIN to XX-XXXXXXX format
 * @param {string} ein - Raw EIN
 * @returns {string} Formatted EIN
 */
function formatEin(ein) {
  if (!ein) return '';
  
  // Remove all non-digit characters
  const digits = ein.replace(/\D/g, '');
  
  // Format as XX-XXXXXXX
  if (digits.length >= 2) {
    return digits.substring(0, 2) + '-' + digits.substring(2, 9);
  }
  
  return digits;
}

/**
 * Sets up EIN formatting for the organization EIN input
 */
function setupEinFormatting() {
  const einInput = document.getElementById('orgEin');
  if (!einInput) {
    console.warn('EIN input field not found');
    return;
  }

  // EIN format validation and formatting XX-XXXXXXX
  einInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    
    // Limit to 9 digits
    if (value.length > 9) {
      value = value.substring(0, 9);
    }
    
    // Format as XX-XXXXXXX
    let formattedValue = '';
    if (value.length >= 2) {
      formattedValue = value.substring(0, 2) + '-' + value.substring(2);
    } else {
      formattedValue = value;
    }
    
    // Only update if the formatted value is different to avoid cursor jumping
    if (e.target.value !== formattedValue) {
      e.target.value = formattedValue;
    }
  });
}

// ===== Welcome / Opening Screen helpers =====
const LOCAL_WELCOME_PREF_KEY = 'showOpeningScreenPreference';
const LOCAL_WELCOME_PENDING_KEY = 'showOpeningScreenPreferencePending';
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function shouldUseDatabaseWelcomePreference() {
  return typeof isLoggedInToQuickbooks !== 'undefined' && isLoggedInToQuickbooks;
}

function setLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`⚠️  Unable to persist ${key} in localStorage, using cookie fallback.`, error);
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_IN_SECONDS}`;
  }
}

function getLocalValue(key) {
  try {
    const storedValue = localStorage.getItem(key);
    if (storedValue !== null) {
      return storedValue;
    }
  } catch (error) {
    console.warn(`⚠️  Unable to read ${key} from localStorage, falling back to cookie.`, error);
  }
  
  const cookieMatch = document.cookie.match(new RegExp(`${key}=([^;]+)`));
  return cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
}

function clearLocalValue(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`⚠️  Unable to clear ${key} from localStorage, clearing cookie fallback.`, error);
  }
  document.cookie = `${key}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function persistLocalWelcomePreference(showOpeningScreen, markPending = false) {
  const value = showOpeningScreen ? 'true' : 'false';
  setLocalValue(LOCAL_WELCOME_PREF_KEY, value);
  
  if (markPending) {
    setLocalValue(LOCAL_WELCOME_PENDING_KEY, value);
  }
}

function getLocalWelcomePreference() {
  const value = getLocalValue(LOCAL_WELCOME_PREF_KEY);
  if (value === null) {
    return true; // Default to showing when no preference exists
  }
  return value !== 'false';
}

function getPendingWelcomePreference() {
  return getLocalValue(LOCAL_WELCOME_PENDING_KEY);
}

function clearPendingWelcomePreference() {
  clearLocalValue(LOCAL_WELCOME_PENDING_KEY);
}

async function fetchDatabaseWelcomePreference() {
  try {
    const response = await fetch('/api/options/ShowOpeningScreen');
    if (response.ok) {
      const option = await response.json();
      if (option && typeof option.value !== 'undefined') {
        return option.value !== 'false';
      }
    } else if (response.status === 404) {
      // No preference stored yet - default to showing
      return true;
    } else {
      console.warn('⚠️  Unexpected response fetching ShowOpeningScreen option:', response.status);
    }
  } catch (error) {
    console.error('❌ Error fetching ShowOpeningScreen option from database:', error);
  }
  
  return true;
}

async function persistWelcomePreferenceToDatabase(showOpeningScreen) {
  try {
    const response = await fetch('/api/options/ShowOpeningScreen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: showOpeningScreen ? 'true' : 'false' })
    });
    
    if (response.ok) {
      console.log('✅ Opening screen preference saved to database');
      return true;
    }
    
    if (response.status === 400) {
      console.log('⏳ No QuickBooks session available, storing preference locally');
    } else {
      console.error('❌ Failed to save opening screen preference:', response.status);
    }
  } catch (error) {
    console.error('❌ Error saving opening screen preference:', error);
  }
  
  return false;
}

// Welcome Modal Functions
function showWelcomeModal() {
  const welcomeModal = document.getElementById('welcomeModal');
  if (welcomeModal) {
    welcomeModal.style.display = 'block';
  }
}

function closeWelcomeModal() {
  const welcomeModal = document.getElementById('welcomeModal');
  if (welcomeModal) {
    welcomeModal.style.display = 'none';
  }
}

async function updateWelcomePreference() {
  const dontShowAgain = document.getElementById('dontShowAgain');
  if (dontShowAgain && dontShowAgain.checked) {
    const canUseDatabase = shouldUseDatabaseWelcomePreference();
    
    if (canUseDatabase) {
      const saved = await persistWelcomePreferenceToDatabase(false);
      if (!saved) {
        persistLocalWelcomePreference(false, true);
      }
    } else {
      // Not logged in yet – store locally and sync once QuickBooks session exists
      persistLocalWelcomePreference(false, true);
      console.log('💾 Stored opening screen preference locally until QuickBooks login');
    }
  }
}

// Check if we should show the welcome dialog on page load
async function checkWelcomeDialog() {
  const canUseDatabase = shouldUseDatabaseWelcomePreference();
  
  if (canUseDatabase) {
    // Make sure any locally queued preference is saved before checking the DB
    await flushPendingWelcomePreference();
  }
  
  // Check if welcome dialog has been shown in this session
  const welcomeShown = sessionStorage.getItem('welcomeDialogShown');
  
  // If already shown this session, don't show again
  if (welcomeShown === 'true') {
    console.log('ℹ️  Welcome dialog already shown this session - skipping');
    return;
  }
  
  // Don't show if just connected to QuickBooks
  const urlParams = new URLSearchParams(window.location.search);
  const justConnected = urlParams.get('quickbooks_connected') === 'true';
  
  if (justConnected) {
    console.log('✅ Just connected to QuickBooks - skipping welcome dialog');
    return;
  }
  
  const shouldShowOpeningScreen = canUseDatabase
    ? await fetchDatabaseWelcomePreference()
    : getLocalWelcomePreference();
  
  if (!shouldShowOpeningScreen) {
    console.log('ℹ️  Opening screen disabled by preference - skipping welcome dialog');
    return;
  }
  
  console.log('👋 First page load this session - showing welcome dialog');
  setTimeout(() => {
    showWelcomeModal();
    // Mark that we've shown the welcome dialog this session
    sessionStorage.setItem('welcomeDialogShown', 'true');
  }, 500); // Small delay for better UX
}

// Flush pending welcome preference to database after QuickBooks login
async function flushPendingWelcomePreference() {
  const pendingPreference = getPendingWelcomePreference();
  
  if (pendingPreference && shouldUseDatabaseWelcomePreference()) {
    console.log('🔄 Flushing pending welcome preference to database...');
    const saved = await persistWelcomePreferenceToDatabase(pendingPreference !== 'false');
    if (saved) {
      console.log('✅ Pending welcome preference saved to database');
      clearPendingWelcomePreference();
    } else {
      console.warn('⚠️  Unable to flush welcome preference - keeping it queued locally');
    }
  }
}

// Initialize welcome dialog check on page load
document.addEventListener('DOMContentLoaded', function() {
  checkWelcomeDialog();
  
  // Close modal when clicking outside
  const welcomeModal = document.getElementById('welcomeModal');
  if (welcomeModal) {
    window.addEventListener('click', function(event) {
      if (event.target === welcomeModal) {
        closeWelcomeModal();
      }
    });
  }
  
  // Close modal with Escape key
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      const welcomeModal = document.getElementById('welcomeModal');
      if (welcomeModal && welcomeModal.style.display === 'block') {
        closeWelcomeModal();
      }
    }
  });
});

// ===== Terms of Service helpers =====
function openTermsModal() {
  const modal = document.getElementById('termsModal');
  if (modal) {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }
}

function closeTermsModal() {
  const modal = document.getElementById('termsModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

async function agreeToTermsAndConnect() {
  // Store ToS agreement in localStorage so it won't show again
  try {
    localStorage.setItem('tosAgreed', 'true');
  } catch (e) {
    // Ignore localStorage errors (e.g., in private browsing mode)
  }
  
  // Try to persist to server (may fail if not yet connected)
  try {
    await fetch('/api/options/showtermsofservice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'false' })
    });
  } catch (e) {
    // Ignore errors here; still proceed to connect
  }
  
  closeTermsModal();
  window.location.href = '/auth/quickbooks';
}

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('[data-open-modal="terms"]').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openTermsModal();
    });
  });

  document.querySelectorAll('[data-open-modal="privacy"]').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openPrivacyModal();
    });
  });
});

// Feedback Modal Functions
function openFeedbackDialog() {
  const feedbackModal = document.getElementById('feedbackModal');
  if (feedbackModal) {
    feedbackModal.style.display = 'block';
    // Reset form
    document.getElementById('feedbackForm').reset();
    document.getElementById('ratingValue').textContent = '5';
  }
  // Close hamburger menu using the class toggle (same way it opens)
  const dropdownMenu = document.getElementById('dropdownMenu');
  if (dropdownMenu && dropdownMenu.classList.contains('show')) {
    dropdownMenu.classList.remove('show');
  }
}

function closeFeedbackModal() {
  const feedbackModal = document.getElementById('feedbackModal');
  if (feedbackModal) {
    feedbackModal.style.display = 'none';
  }
}

function updateRatingValue(value) {
  const ratingValue = document.getElementById('ratingValue');
  if (ratingValue) {
    ratingValue.textContent = value;
  }
}

async function submitFeedback() {
  const feedbackText = document.getElementById('feedbackText').value.trim();
  const feedbackEmail = document.getElementById('feedbackEmail').value.trim();
  const rating = parseInt(document.getElementById('feedbackRating').value);
  
  // Validate feedback text
  if (!feedbackText) {
    showNotification('Please enter your feedback', 'error');
    return;
  }
  
  // Get organization ID if logged into QuickBooks
  let organizationId = null;
  // You can add logic here to get the current organization ID if needed
  
  const feedbackData = {
    feedback: feedbackText,
    email: feedbackEmail || null,
    rating: rating,
    organizationId: organizationId
  };
  
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(feedbackData)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      closeFeedbackModal();
    } else {
      showNotification(data.error || 'Failed to submit feedback', 'error');
    }
  } catch (error) {
    console.error('Error submitting feedback:', error);
    showNotification('Failed to submit feedback', 'error');
  }
}

// Close modals when clicking outside their content
window.addEventListener('click', function(event) {
  const feedbackModal = document.getElementById('feedbackModal');
  if (feedbackModal && event.target === feedbackModal) {
    closeFeedbackModal();
  }

  const termsModal = document.getElementById('termsModal');
  if (termsModal && event.target === termsModal) {
    closeTermsModal();
  }

  const privacyModal = document.getElementById('privacyModal');
  if (privacyModal && event.target === privacyModal) {
    closePrivacyModal();
  }
});

// Expose modal helpers globally for inline handlers
window.openTermsModal = openTermsModal;
window.closeTermsModal = closeTermsModal;
window.openPrivacyModal = openPrivacyModal;
window.closePrivacyModal = closePrivacyModal;

function openPrivacyModal() {
  const modal = document.getElementById('privacyModal');
  if (modal) {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }
}

function closePrivacyModal() {
  const modal = document.getElementById('privacyModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

window.openPrivacyModal = openPrivacyModal;
window.closePrivacyModal = closePrivacyModal;
