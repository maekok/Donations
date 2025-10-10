const fs = require('fs');
const path = require('path');

class TemplateManager {
  constructor() {
    this.templateConfigPath = path.join(__dirname, 'config', 'receipt-template.json');
    this.assetsPath = path.join(__dirname, 'public', 'assets');
    this.defaultConfig = {
      organization: {
        name: "Your Organization Name",
        ein: "12-3456789",
        address: "123 Main Street",
        city: "Anytown",
        state: "ST",
        zip: "12345",
        phone: "(555) 123-4567",
        email: "info@yourorg.org",
        website: "www.yourorg.org"
      },
      receipt: {
        subtitle: "Thank you for your generous contribution",
        footer: "This receipt serves as documentation for your tax-deductible donation.",
        logo: {
          enabled: true,
          filename: "logo.png",
          width: 150,
          height: 80,
          position: "top-right"
        },
        styling: {
          primaryColor: "#2E86AB",
          secondaryColor: "#A23B72",
          fontFamily: "Helvetica",
          fontSize: 12
        }
      },
      branding: {
        showLogo: true,
        showEin: true,
        showAddress: true,
        showContact: true
      }
    };
    
    this.ensureDirectories();
    this.loadConfig();
  }

  ensureDirectories() {
    // Ensure config directory exists
    const configDir = path.dirname(this.templateConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Ensure assets directory exists
    if (!fs.existsSync(this.assetsPath)) {
      fs.mkdirSync(this.assetsPath, { recursive: true });
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.templateConfigPath)) {
        const configData = fs.readFileSync(this.templateConfigPath, 'utf8');
        this.config = JSON.parse(configData);
        console.log('✅ Template configuration loaded');
      } else {
        this.config = this.defaultConfig;
        this.saveConfig();
        console.log('✅ Default template configuration created');
      }
    } catch (error) {
      console.error('❌ Error loading template config:', error);
      this.config = this.defaultConfig;
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.templateConfigPath, JSON.stringify(this.config, null, 2));
      console.log('✅ Template configuration saved');
    } catch (error) {
      console.error('❌ Error saving template config:', error);
      throw error;
    }
  }

  getConfig() {
    return this.config;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    return this.config;
  }

  updateOrganization(orgData) {
    this.config.organization = { ...this.config.organization, ...orgData };
    this.saveConfig();
    return this.config.organization;
  }

  updateReceiptSettings(receiptData) {
    this.config.receipt = { ...this.config.receipt, ...receiptData };
    this.saveConfig();
    return this.config.receipt;
  }

  updateBranding(brandingData) {
    this.config.branding = { ...this.config.branding, ...brandingData };
    this.saveConfig();
    return this.config.branding;
  }

  getLogoPath() {
    if (!this.config.receipt.logo.enabled) {
      return null;
    }
    
    const logoPath = path.join(this.assetsPath, this.config.receipt.logo.filename);
    return fs.existsSync(logoPath) ? logoPath : null;
  }

  uploadLogo(fileBuffer, filename) {
    try {
      // Validate file type
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
      const fileExtension = path.extname(filename).toLowerCase();
      
      if (!['.png', '.jpg', '.jpeg', '.gif'].includes(fileExtension)) {
        throw new Error('Invalid file type. Only PNG, JPG, JPEG, and GIF are allowed.');
      }

      // Save the file
      const logoPath = path.join(this.assetsPath, filename);
      fs.writeFileSync(logoPath, fileBuffer);
      
      // Update config
      this.config.receipt.logo.filename = filename;
      this.saveConfig();
      
      console.log(`✅ Logo uploaded: ${filename}`);
      return { success: true, filename };
    } catch (error) {
      console.error('❌ Error uploading logo:', error);
      throw error;
    }
  }

  deleteLogo() {
    try {
      const logoPath = this.getLogoPath();
      if (logoPath && fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
        this.config.receipt.logo.enabled = false;
        this.saveConfig();
        console.log('✅ Logo deleted');
        return { success: true };
      }
      return { success: false, message: 'No logo found' };
    } catch (error) {
      console.error('❌ Error deleting logo:', error);
      throw error;
    }
  }

  validateConfig() {
    const errors = [];
    
    // Validate organization data
    if (!this.config.organization.name) {
      errors.push('Organization name is required');
    }
    
    if (!this.config.organization.ein) {
      errors.push('EIN is required');
    }
    
    // Validate EIN format (basic validation)
    const einRegex = /^\d{2}-\d{7}$/;
    if (!einRegex.test(this.config.organization.ein)) {
      errors.push('EIN must be in format XX-XXXXXXX');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  getTemplateData() {
    const validation = this.validateConfig();
    return {
      config: this.config,
      validation,
      logoPath: this.getLogoPath()
    };
  }
}

module.exports = TemplateManager; 