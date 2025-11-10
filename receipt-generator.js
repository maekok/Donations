const PDFDocument = require('pdfkit');
const TemplateManager = require('./template-manager');
const Encryption = require('./encryption');

class ReceiptGenerator {
  constructor() {
    this.templateManager = new TemplateManager();
  }

  /**
   * Main method to generate a receipt for a transaction
   * @param {Object} transaction - Transaction data
   * @param {Object} donor - Donor data
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   * @returns {Promise<Object>} Receipt generation result
   */
  async generateReceipt(transaction, donor, db, req = null) {
    try {
      this.validateInput(transaction, donor);
      
      const doc = this.createPDFDocument();

      const pdfBuffer = await this.buildPDFDocument(doc, transaction, donor, db, req);
      
      console.log(`✅ Receipt generated in memory for transaction ${transaction.id}`);
      
      return {
        pdfBuffer,
        downloadUrl: `/receipts/transaction-${transaction.id}`
      };

    } catch (error) {
      console.error('❌ Error generating receipt:', error);
      throw error;
    }
  }

  /**
   * Validates input parameters
   * @param {Object} transaction - Transaction data
   * @param {Object} donor - Donor data
   */
  validateInput(transaction, donor) {
    if (!transaction || !transaction.id) {
      throw new Error('Transaction ID is required');
    }
    
    if (!donor) {
      throw new Error('Donor information is required');
    }
  }

  /**
   * Creates a new PDF document with default settings
   * @returns {PDFDocument} PDF document instance
   */
  createPDFDocument() {
    return new PDFDocument({
      size: 'A4',
      margin: 50
    });
  }




  /**
   * Builds the complete PDF document
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} transaction - Transaction data
   * @param {Object} donor - Donor data
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   * @returns {Promise<Buffer>} PDF buffer
   */
  buildPDFDocument(doc, transaction, donor, db, req = null) {
    return new Promise(async (resolve, reject) => {
      const chunks = [];
      
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      try {
        await this.addHeader(doc, transaction.date, donor, db, req, transaction);
        await this.addDonorInfo(doc, donor, transaction, db, req);
        await this.addTransactionDetails(doc, transaction, db, req);
        this.addFooter(doc);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Adds the header section to the PDF
   * @param {PDFDocument} doc - PDF document instance
   * @param {string} date - Transaction date
   * @param {Object} donor - Donor data
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   */
  async addHeader(doc, date, donor, db, req = null, transaction = null) {
    const config = this.templateManager.getConfig();
    const { branding } = config;

    const logoHeight = await this.addHeaderImageFromDatabase(doc, db, req);
    
    // Get organization information for the receipt
    let organization = null;
    if (req && req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      organization = await db.getOrganizationByQbId(realmId);
    }
    
    // Fallback to first organization if no realmId or organization not found
    if (!organization) {
      const organizations = await db.getAllOrganizations();
      if (organizations && organizations.length > 0) {
        organization = organizations[0];
      }
    }
    
    this.addDonorHeaderInfo(doc, date, donor, logoHeight);    
  }

  /**
   * Adds header image to the PDF from database if available
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   * @returns {Promise<number>} Logo height in pixels, or 0 if no logo
   */
  async addHeaderImageFromDatabase(doc, db, req = null) {
    try {
      let organization;
      
      // Try to get organization from realmId cookie if request object is available
      if (req && req.cookies && req.cookies.quickbooks_realmId) {
        const realmId = req.cookies.quickbooks_realmId;
        console.log('🔍 Getting organization by realmId from cookie:', realmId);
        organization = await db.getOrganizationByQbId(realmId);
        
        if (organization) {
          console.log('✅ Found organization by realmId:', organization.name);
        }
      }
      
      // Fallback to first organization if no realmId or organization not found
      if (!organization) {
        console.log('⚠️ No organization found by realmId, using first organization as fallback');
        const organizations = await db.getAllOrganizations();
        if (!organizations || organizations.length === 0) {
          console.log('⚠️ No organizations found for logo');
          return 0;
        }
        organization = organizations[0];
      }

      const logo = await db.getLogoByOrganizationId(organization.id);
      
      if (!logo || !logo.Logo) {
        console.log('⚠️ No logo found in database for organization:', organization.name);
        return 0;
      }

      // Convert BLOB data to buffer
      let logoBuffer;
      if (Buffer.isBuffer(logo.Logo)) {
        logoBuffer = logo.Logo;
      } else if (Array.isArray(logo.Logo)) {
        logoBuffer = Buffer.from(logo.Logo);
      } else {
        console.warn('⚠️ Unknown logo data format:', typeof logo.Logo);
        return 0;
      }

      // Use logo settings from database
      const logoWidth = logo.width || 150;
      const logoHeight = logo.height || 80;
      const logoX = this.calculateLogoPosition(logoWidth, logo.logoposition || 'top-right');
      
      // Add logo to PDF using buffer
      doc.image(logoBuffer, logoX, 50, { width: logoWidth, height: logoHeight });
      
      console.log(`✅ Logo added to receipt: ${logo.logofilename} (${logoWidth}x${logoHeight}) at ${logo.logoposition}`);
      
      return logoHeight;
      
    } catch (error) {
      console.warn('⚠️ Could not load header image from database:', error.message);
      return 0;
    }
  }

  /**
   * Adds header image to the PDF if available (legacy method for template system)
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} receipt - Receipt configuration
   * @param {Object} branding - Branding configuration
   */
  addHeaderImage(doc, receipt, branding) {
    if (!branding.showLogo || !receipt.logo?.enabled) {
      return;
    }

    const logoPath = this.templateManager.getLogoPath();
    if (!logoPath) {
      return;
    }

    try {
      const logoWidth = receipt.logo.width || 150;
      const logoHeight = receipt.logo.height || 80;
      const logoX = this.calculateLogoPosition(logoWidth, receipt.logo.position);
      
      doc.image(logoPath, logoX, 50, { width: logoWidth, height: logoHeight });
      doc.moveDown(2);
    } catch (error) {
      console.warn('⚠️ Could not load header image:', error.message);
    }
  }

  /**
   * Adds donor header information in the specified format
   * @param {PDFDocument} doc - PDF document instance
   * @param {string} date - Transaction date
   * @param {Object} donor - Donor data
   * @param {number} logoHeight - Height of the logo in pixels (0 if no logo)
   */
  addDonorHeaderInfo(doc, date, donor, logoHeight = 0) {
    // Debug: Log donor data to see what we're working with
    console.log('🔍 Donor data for receipt header:', {
      name: donor.name,
      address: donor.address,
      city: donor.city,
      state: donor.state,
      zip: donor.zip,
      email: donor.email,
      phone: donor.phone
    });

    // Calculate starting Y position for text based on logo height
    const logoStartY = 50; // Logo starts at Y=50
    const logoPadding = 20; // Extra padding below logo
    const textStartY = logoHeight > 0 ? logoStartY + logoHeight + logoPadding : logoStartY;
    
    // Move to the calculated position
    doc.y = textStartY;

    // Today's Date
    const today = new Date();
    doc.fontSize(12)
       .font('Helvetica')
       .text(this.formatDate(today))
       .moveDown(2); // 2 new lines as requested

    // First and Last Name
    const fullName = this.formatDonorName(donor);
    doc.fontSize(12)
       .font('Helvetica')
       .text(fullName);

    // Address
    if (donor.address) {
      doc.fontSize(12)
         .font('Helvetica')
         .text(donor.address);       
    } else {
      console.log('⚠️ No address found for donor:', donor.name);
    }

    // City, State, Zip
    const cityStateZip = this.formatCityStateZip(donor);
    if (cityStateZip) {
      doc.text(cityStateZip);
         
    } else {
      console.log('⚠️ No city/state/zip found for donor:', donor.name);
    }
    
    // Add newline after address before "Dear donor name"
    doc.moveDown(1);
  }

  /**
   * Formats donor name (first and last name)
   * @param {Object} donor - Donor data
   * @returns {string} Formatted donor name
   */
  formatDonorName(donor) {
    if (!donor.name) {
      return 'Unknown Donor';
    }
    
    // If name is already formatted, use it as is
    if (donor.name.includes(' ')) {
      return donor.name;
    }
    
    // If we have separate first and last name fields, combine them
    const firstName = donor.firstName || donor.first_name || '';
    const lastName = donor.lastName || donor.last_name || '';
    
    if (firstName || lastName) {
      return `${firstName} ${lastName}`.trim();
    }
    
    return donor.name;
  }

  /**
   * Extracts first name from donor data for personalized greeting
   * @param {Object} donor - Donor data
   * @returns {string} First name only
   */
  getDonorFirstName(donor) {
    if (!donor.name) {
      return 'Friend';
    }
    
    // If we have separate first name field, use it
    const firstName = donor.firstName || donor.first_name;
    if (firstName) {
      return firstName;
    }
    
    // Extract first name from full name
    const nameParts = donor.name.trim().split(' ');
    if (nameParts.length > 0) {
      return nameParts[0];
    }
    
    return 'Friend';
  }

  /**
   * Formats city, state, and zip code
   * @param {Object} donor - Donor data
   * @returns {string} Formatted city, state, zip
   */
  formatCityStateZip(donor) {
    const parts = [];
    
    if (donor.city) parts.push(donor.city);
    if (donor.state) parts.push(donor.state);
    if (donor.zip) parts.push(donor.zip);
    
    return parts.join(', ');
  }

  /**
   * Calculates logo position based on configuration
   * @param {number} logoWidth - Logo width
   * @param {string} position - Logo position
   * @returns {number} X coordinate for logo
   */
  calculateLogoPosition(logoWidth, position) {
    const pageWidth = 550;
    
    switch (position) {
      case 'top-right':
        return pageWidth - logoWidth;
      case 'top-center':
        return (pageWidth - logoWidth) / 2;
      default: // top-left
        return 50;
    }
  }


  /**
   * Formats organization address
   * @param {Object} org - Organization data
   * @returns {string} Formatted address
   */
  formatAddress(org) {
    const parts = [org.address, org.city, org.state, org.zip].filter(Boolean);
    return parts.join(', ');
  }

  /**
   * Formats organization contact information
   * @param {Object} org - Organization data
   * @returns {string} Formatted contact info
   */
  formatContactInfo(org) {
    const parts = [];
    if (org.phone) parts.push(`Phone: ${org.phone}`);
    if (org.email) parts.push(`Email: ${org.email}`);
    return parts.join(' | ');
  }

  /**
   * Adds a separator line
   * @param {PDFDocument} doc - PDF document instance
   */

  addSeparator(doc) {
    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .stroke()
       .moveDown(1);
  }

  /**
   * Adds personalized donor message and donation summary
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} donor - Donor data
   * @param {Object} transaction - Transaction data
   */
  async addDonorInfo(doc, donor, transaction, db, req) {
    await this.addPersonalizedMessage(doc, donor, db, req);
    await this.addDonationSummary(doc, donor, transaction, db, req);
  }

  /**
   * Adds personalized message to donor
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} donor - Donor data
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   */
  async addPersonalizedMessage(doc, donor, db, req) {
    const donorName = this.formatDonorName(donor);
    const donorFirstName = this.getDonorFirstName(donor);
    
    // Get organization from database instead of config
    let orgName = 'our organization';
    if (req && req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      const organization = await db.getOrganizationByQbId(realmId);
      if (organization) {
        orgName = organization.name;
      }
    } else {
      // Fallback to first organization if no realmId
      const organizations = await db.getAllOrganizations();
      if (organizations && organizations.length > 0) {
        orgName = organizations[0].name;
      }
    }
    
    // Dear (first name only)
    doc.fontSize(12)
       .font('Helvetica')
       .text(`Dear ${donorFirstName}`)
       .moveDown(1); // new line
    
    // Here is your receipt for your generous donation to (organization name). Thank you so much for donating.
    doc.text(`Here is your receipt for your generous donation to ${orgName}. Thank you so much for donating.`)
       .moveDown(2); // (new line) new line
    
    // Here is a summary of your donation
    doc.text('Here is a summary of your donation');
  }

  /**
   * Adds donation summary section
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} donor - Donor data
   * @param {Object} transaction - Transaction data
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   */
  async addDonationSummary(doc, donor, transaction, db, req) {
    const donorName = this.formatDonorName(donor);
    
    // Get organization from database instead of config
    let orgName = 'our organization';
    if (req && req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      const organization = await db.getOrganizationByQbId(realmId);
      if (organization) {
        orgName = organization.name;
      }
    } else {
      // Fallback to first organization if no realmId
      const organizations = await db.getAllOrganizations();
      if (organizations && organizations.length > 0) {
        orgName = organizations[0].name;
      }
    }
    
    // Horizontal line
    this.addSeparator(doc);
    
    // Organization (organization name)
    doc.fontSize(12)
       .font('Helvetica')
       .text(`Organization: ${orgName}`)
       .moveDown(1); // new line
    
    // Donor Name: (Donor Name)
    doc.text(`Donor Name: ${donorName}`)
       .moveDown(1); // new line
    
    // Description: (transaction items descriptions)
    let description = 'N/A';
    try {
      // Fetch transaction items from database
      const items = await db.getTransactionItemsByTransactionId(transaction.id);
      
      if (items && items.length > 0) {
        // Format descriptions based on quantity
        const descriptions = items.map(item => {
          const qty = parseInt(item.quantity) || 1;
          const desc = item.description || 'Unknown';
          
          // If quantity is 1 or null, just show description
          if (qty === 1 || !item.quantity) {
            return desc;
          }
          
          // Otherwise show [quantity] [Description]
          return `${qty} ${desc}`;
        });
        
        description = descriptions.join(', ');
      } else {
        // Fallback to transaction description if no items
        description = transaction.description || 'N/A';
      }
    } catch (error) {
      console.error('Error fetching transaction items for receipt:', error);
      description = transaction.description || 'N/A';
    }
    
    doc.text(`Description: ${description}`)
       .moveDown(1); // new line
    
    // Amount: (transaction amount)
    const amount = parseFloat(transaction.amount || 0);
    const amountText = amount === 0 ? 'N/A' : `$${amount.toFixed(2)}`;
    doc.text(`Amount: ${amountText}`)
       .moveDown(1); // new line
    
    // Donated on: (donation date)
    doc.text(`Donated on: ${this.formatDate(transaction.date)}`)
       .moveDown(1); // new line
    
    // Horizontal line
    this.addSeparator(doc);
    
    // new line new line
    doc.moveDown(1);
    
    // Best Regards, Primary Contact, Company Name, Phone
    doc.text('Best Regards,')
       .moveDown(0.5);
    
    // Get organization details for signature
    let primaryContact = 'Primary Contact';
    let companyName = orgName;
    let companyPhone = 'Phone Number';
    
    if (req && req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      const organization = await db.getOrganizationByQbId(realmId);
      if (organization) {
        primaryContact = organization.contact || 'Primary Contact';
        companyName = organization.name || orgName;
        companyPhone = organization.phone || 'Phone Number';
      }
    } else {
      // Fallback to first organization if no realmId
      const organizations = await db.getAllOrganizations();
      if (organizations && organizations.length > 0) {
        primaryContact = organizations[0].contact || 'Primary Contact';
        companyName = organizations[0].name || orgName;
        companyPhone = organizations[0].phone || 'Phone Number';
      }
    }
    
    doc.text(primaryContact)
       .moveDown(0.2)
       .text(companyName)
       .moveDown(0.2)
       .text(companyPhone)
       .moveDown(.2);
  }

  /**
   * Adds final section with tax records and 501(c)(3) information
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} transaction - Transaction data
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   */
  async addTransactionDetails(doc, transaction, db, req) {
    // 2 new lines from previous section
    doc.moveDown(2);
    
    await this.addTaxRecordsMessage(doc, db, req);
    await this.add501c3Information(doc, db, req);
  }

  /**
   * Adds tax records retention message
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   */
  async addTaxRecordsMessage(doc, db, req) {
    // Get organization from database instead of config
    let orgName = 'our organization';
    let orgEmail = 'our contact email';
    if (req && req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      const organization = await db.getOrganizationByQbId(realmId);
      if (organization) {
        orgName = organization.name;
        orgEmail = organization.email || 'our contact email';
      }
    } else {
      // Fallback to first organization if no realmId
      const organizations = await db.getAllOrganizations();
      if (organizations && organizations.length > 0) {
        orgName = organizations[0].name;
        orgEmail = organizations[0].email || 'our contact email';
      }
    }
    
    doc.fontSize(12)
       .font('Helvetica')
       .text(`Please retain for your tax records. Should you have any questions regarding this donation, please contact ${orgName} at ${orgEmail}.`)
       .moveDown(1); // 1 new line
       
  }

  /**
   * Adds 501(c)(3) status and EIN information
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   */
  async add501c3Information(doc, db, req) {
    // Get organization from database instead of config
    let orgName = 'our organization';
    let ein = 'N/A';
    let orgType = 'Non-Profit'; // Default to Non-Profit
    let organization = null;
    
    if (req && req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      organization = await db.getOrganizationByQbId(realmId);
      if (organization) {
        orgName = organization.name;
        orgType = organization.type || 'Non-Profit';
        // EIN is already decrypted by getOrganizationByQbId
        if (organization.ein) {
          ein = organization.ein;
        } else {
          ein = 'N/A';
        }
      }
    } else {
      // Fallback to first organization if no realmId
      const organizations = await db.getAllOrganizations();
      if (organizations && organizations.length > 0) {
        organization = organizations[0];
        orgName = organization.name;
        orgType = organization.type || 'Non-Profit';
        // EIN is already decrypted by getAllOrganizations
        if (organization.ein) {
          ein = organization.ein;
        } else {
          ein = 'N/A';
        }
      }
    }
    
    // Format EIN for display (XX-XXXXXXX)
    let formattedEin = ein;
    if (ein && ein !== 'N/A') {
      // Remove any existing formatting
      const digits = ein.replace(/\D/g, '');
      if (digits.length === 9) {
        formattedEin = `${digits.substring(0, 2)}-${digits.substring(2)}`;
      }
    }
    
    // Check if organization is Non-Profit
    const isNonProfit = orgType === 'Non-Profit';
    
    doc.fontSize(10)
       .font('Helvetica');
    
    if (isNonProfit) {
      // Non-Profit: Show 501(c)(3) message
      doc.text(`${orgName} is a registered 501(c)(3) non-profit organization with an EIN of ${formattedEin}. No goods or services were provided in return for this contribution.`);
    } else {
      // For-Profit: Show EIN and no goods/services message
      doc.text(`${orgName}'s EIN is ${formattedEin}. No goods or services were provided in return for this donation.`);
    }
  }


  /**
   * Adds footer section
   * @param {PDFDocument} doc - PDF document instance
   */
  addFooter(doc) {
    // Footer elements removed as requested
  }

  /**
   * Adds footer text
   * @param {PDFDocument} doc - PDF document instance
   * @param {Object} receipt - Receipt configuration
   */
  addFooterText(doc, receipt) {
    doc.fontSize(10)
       .font('Helvetica')
       .text(receipt.subtitle || 'Thank you for your generous donation!', { align: 'center' })
       .moveDown(0.5)
       .text(receipt.footer || 'Your support makes a difference in our community.', { align: 'center' })
       .moveDown(1);
  }

  /**
   * Adds signature lines
   * @param {PDFDocument} doc - PDF document instance
   * @param {number} footerY - Y coordinate for footer
   */
  addSignatureLines(doc, footerY) {
    doc.fontSize(12)
       .font('Helvetica')
       .text('Authorized Signature:', 100, footerY)
       .moveTo(100, footerY + 20)
       .lineTo(300, footerY + 20)
       .stroke();

    doc.fontSize(10)
       .text('Date:', 350, footerY)
       .moveTo(350, footerY + 20)
       .lineTo(450, footerY + 20)
       .stroke();
  }

  /**
   * Adds page number
   * @param {PDFDocument} doc - PDF document instance
   */
  addPageNumber(doc) {
    doc.fontSize(8)
       .text('Page 1 of 1', { align: 'center' });
  }

  /**
   * Formats date for display
   * @param {string} dateString - Date string
   * @returns {string} Formatted date
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Formats amount for display
   * @param {string|number} amount - Amount to format
   * @returns {string} Formatted amount
   */
  formatAmount(amount) {
    const cleanAmount = amount.toString().replace(/[$,]/g, '');
    const numAmount = parseFloat(cleanAmount);
    return numAmount.toFixed(2);
  }

  /**
   * Generates receipt for a transaction by ID
   * @param {number} transactionId - Transaction ID
   * @param {Object} db - Database instance
   * @param {Object} req - Express request object (for getting realmId cookie)
   * @returns {Promise<Object>} Receipt generation result
   */
  async generateReceiptForTransaction(transactionId, db, req = null) {
    try {
      const transaction = await this.getTransactionWithValidation(transactionId, db);
      const existingReceipt = await this.checkExistingReceipt(transactionId, db);
      
      if (existingReceipt) {
        console.log(`🗑️ Deleting existing receipt for transaction ${transactionId} before generating new one`);
        await db.deleteReceipt(existingReceipt.id);
      }

      const donor = await this.getDonorInfo(transaction, db);
      const receipt = await this.generateReceipt(transaction, donor, db, req);
      const savedReceipt = await this.saveReceiptToDatabase(receipt, transactionId, db);

      return this.createSuccessResult(savedReceipt, receipt);

    } catch (error) {
      console.error(`❌ Error generating receipt for transaction ${transactionId}:`, error);
      throw error;
    }
  }

  /**
   * Gets and validates transaction
   * @param {number} transactionId - Transaction ID
   * @param {Object} db - Database instance
   * @returns {Promise<Object>} Transaction data
   */
  async getTransactionWithValidation(transactionId, db) {
    const transaction = await db.getTransactionById(transactionId);
    if (!transaction) {
      throw new Error(`Transaction with ID ${transactionId} not found`);
    }
    return transaction;
  }

  /**
   * Checks if receipt already exists
   * @param {number} transactionId - Transaction ID
   * @param {Object} db - Database instance
   * @returns {Promise<Object|null>} Existing receipt or null
   */
  async checkExistingReceipt(transactionId, db) {
    const existingReceipt = await db.getReceiptByTransactionId(transactionId);
    if (existingReceipt) {
      console.log(`⏭️  Receipt already exists for transaction ${transactionId}`);
    }
    return existingReceipt;
  }

  /**
   * Creates skipped result object
   * @param {Object} existingReceipt - Existing receipt data
   * @returns {Object} Skipped result
   */
  createSkippedResult(existingReceipt) {
    return {
      action: 'skipped',
      reason: 'receipt_exists',
      receipt: existingReceipt
    };
  }

  /**
   * Gets donor information
   * @param {Object} transaction - Transaction data
   * @param {Object} db - Database instance
   * @returns {Promise<Object>} Donor data
   */
  async getDonorInfo(transaction, db) {
    let donor = null;
    
    console.log('🔍 Getting donor info for transaction:', {
      transactionId: transaction.id,
      donorId: transaction.donor_id
    });
    
    if (transaction.donor_id) {
      donor = await db.getDonorById(transaction.donor_id);
      console.log('📋 Retrieved donor from database:', {
        id: donor?.id,
        name: donor?.name,
        address: donor?.address,
        city: donor?.city,
        state: donor?.state,
        zip: donor?.zip
      });
    } else {
      console.log('⚠️ No donor_id found in transaction, using default donor');
    }

    const finalDonor = donor || this.createDefaultDonor();
    console.log('✅ Final donor data for receipt:', {
      name: finalDonor.name,
      address: finalDonor.address,
      city: finalDonor.city,
      state: finalDonor.state,
      zip: finalDonor.zip
    });

    return finalDonor;
  }

  /**
   * Creates default donor object
   * @returns {Object} Default donor data
   */
  createDefaultDonor() {
    return {
      name: 'Anonymous Donor',
      email: 'Not provided',
      phone: 'Not provided',
      address: null,
      city: null,
      state: null,
      zip: null,
      company: null
    };
  }

  /**
   * Saves receipt to database
   * @param {Object} receipt - Receipt data
   * @param {number} transactionId - Transaction ID
   * @param {Object} db - Database instance
   * @returns {Promise<Object>} Saved receipt
   */
  async saveReceiptToDatabase(receipt, transactionId, db) {
    const receiptData = {
      companyid: null,
      donorid: null, // Will be set from transaction
      receipt_blob: receipt.pdfBuffer,
      transaction_id: transactionId
    };

    const savedReceipt = await db.addReceipt(receiptData);
    console.log(`💾 Receipt saved to database with ID: ${savedReceipt.id}`);
    return savedReceipt;
  }

  /**
   * Creates success result object
   * @param {Object} savedReceipt - Saved receipt data
   * @param {Object} receipt - Generated receipt data
   * @returns {Object} Success result
   */
  createSuccessResult(savedReceipt, receipt) {
    return {
      action: 'created',
      receipt: {
        id: savedReceipt.id,
        downloadUrl: receipt.downloadUrl,
        dategenerated: new Date().toISOString()
      }
    };
  }


}

module.exports = ReceiptGenerator; 