const axios = require('axios');
const crypto = require('crypto');

class QuickbooksAPI {
  constructor() {
    // Configuration - you'll add these values later
    this.clientId = process.env.QUICKBOOKS_CLIENT_ID || 'AB49HusgskKkwaaShObSYMj8Xm13YfDAonES4BUbFnY4TNQhV5';
    this.clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || 'pL9VvzSYOyCZ1wXoWQZWsuKSh1oKmhUPZOL53Jq7';
    this.redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:3000/auth/quickbooks/callback';
    this.environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox'; // 'sandbox' or 'production'
    
    // API endpoints based on environment
    this.baseURL = this.environment === 'production' 
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-accounts.platform.intuit.com';
    
    this.apiURL = this.environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company';
    
    // OAuth endpoints
    this.authURL = this.environment === 'production'
      ? 'https://appcenter.intuit.com/connect/oauth2'
      : 'https://appcenter.intuit.com/connect/oauth2';
    
    this.tokenURL = this.environment === 'production'
      ? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
      : 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    
    // Store tokens (in production, use a secure database)
    this.accessToken = null;
    this.refreshToken = null;
    this.realmId = null;
    this.tokenExpiry = null;
  }

  // Generate OAuth2 authorization URL
  generateAuthURL() {
    const state = crypto.randomBytes(32).toString('hex');
    const scope = 'com.intuit.quickbooks.accounting';
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: scope,
      redirect_uri: this.redirectUri,
      state: state
    });
    
    return {
      url: `${this.authURL}?${params.toString()}`,
      state: state
    };
  }

  // Exchange authorization code for access token
  async exchangeCodeForToken(code, realmId) {
    try {
      const response = await axios.post(this.tokenURL, {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: this.redirectUri
      }, {
        auth: {
          username: this.clientId,
          password: this.clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;
      
      this.accessToken = access_token;
      this.refreshToken = refresh_token;
      this.realmId = realmId;
      this.tokenExpiry = Date.now() + (expires_in * 1000);
      
      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        realmId: realmId,
        expiresIn: expires_in
      };
    } catch (error) {
      console.error('Error exchanging code for token:', error.response?.data || error.message);
      throw new Error('Failed to exchange authorization code for token');
    }
  }

  // Refresh access token
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(this.tokenURL, {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      }, {
        auth: {
          username: this.clientId,
          password: this.clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;
      
      this.accessToken = access_token;
      this.refreshToken = refresh_token || this.refreshToken;
      this.tokenExpiry = Date.now() + (expires_in * 1000);
      
      return {
        accessToken: access_token,
        refreshToken: this.refreshToken,
        expiresIn: expires_in
      };
    } catch (error) {
      console.error('Error refreshing token:', error.response?.data || error.message);
      throw new Error('Failed to refresh access token');
    }
  }

  // Check if token is expired and refresh if needed
  async ensureValidToken() {
    if (!this.accessToken) {
      throw new Error('No access token available. Please authenticate first.');
    }

    // Check if token expires in the next 5 minutes
    if (this.tokenExpiry && Date.now() > (this.tokenExpiry - 300000)) {
      console.log('Token expiring soon, refreshing...');
      await this.refreshAccessToken();
    }
  }

  // Make authenticated API request
  async makeRequest(endpoint, method = 'GET', data = null) {
    await this.ensureValidToken();
    
    const config = {
      method: method,
      url: `${this.apiURL}/${this.realmId}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    console.log('🔍 Making Quickbooks API request:');
    console.log('  URL:', config.url);
    console.log('  Method:', config.method);
    console.log('  Headers:', {
      'Authorization': 'Bearer [HIDDEN]',
      'Accept': config.headers.Accept,
      'Content-Type': config.headers['Content-Type']
    });
    if (data) {
      console.log('  Data:', JSON.stringify(data, null, 2));
    }

    try {
      const response = await axios(config);
      console.log('✅ Quickbooks API request successful');
      console.log('  Status:', response.status);
      console.log('  Response size:', JSON.stringify(response.data).length, 'characters');
      return response.data;
    } catch (error) {
      console.error('❌ Quickbooks API request failed - DETAILED ERROR:');
      console.error('  Error type:', error.constructor.name);
      console.error('  Error message:', error.message);
      console.error('  Error code:', error.code);
      console.error('  Error status:', error.response?.status);
      console.error('  Error status text:', error.response?.statusText);
      console.error('  Error URL:', error.config?.url);
      console.error('  Error method:', error.config?.method);
      
      if (error.response) {
        console.error('  Response headers:', error.response.headers);
        console.error('  Response data:', JSON.stringify(error.response.data, null, 2));
      }
      
      if (error.request) {
        console.error('  Request made but no response received');
        console.error('  Request config:', error.request.config ? JSON.stringify(error.request.config, null, 2) : 'No config available');
      }
      
      // Log the full error object for debugging (without circular references)
      console.error('  Full error object:', JSON.stringify({
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method
      }, null, 2));
      
      throw new Error(`Quickbooks API request failed: ${error.response?.status || 'Unknown error'} - ${error.message}`);
    }
  }

  // Get customers from Quickbooks
  async getCustomers() {
    try {
      const response = await this.makeRequest('/query?query=SELECT * FROM Customer MAXRESULTS 1000');
      return response.QueryResponse.Customer || [];
    } catch (error) {
      console.error('Error fetching customers:', error);
      throw error;
    }
  }

  // Get customer by ID from Quickbooks
  async getCustomerById(customerId) {
    try {
      console.log(`🔍 Fetching customer with ID: ${customerId}`);
      const response = await this.makeRequest(`/customer/${customerId}`);
      
      if (response.Customer) {
        console.log(`✅ Found customer: ${response.Customer.DisplayName || response.Customer.Name}`);
        return response.Customer;
      } else {
        throw new Error(`Customer with ID ${customerId} not found`);
      }
    } catch (error) {
      console.error(`❌ Error fetching customer ${customerId}:`, error);
      throw error;
    }
  }

  // Get company info from Quickbooks
  async getCompanyInfo() {
    try {
      console.log(`🔍 Fetching company info for realm ID: ${this.realmId}`);
      const response = await this.makeRequest('/companyinfo/1');
      
      if (response.CompanyInfo) {
        console.log(`✅ Found company info: ${response.CompanyInfo.CompanyName}`);
        return response.CompanyInfo;
      } else {
        throw new Error('Company info not found');
      }
    } catch (error) {
      console.error(`❌ Error fetching company info:`, error);
      throw error;
    }
  }

  // Get invoices from Quickbooks
  async getInvoices() {
    try {
      const response = await this.makeRequest('/query?query=SELECT * FROM Invoice MAXRESULTS 1000');
      return response.QueryResponse.Invoice || [];
    } catch (error) {
      console.error('Error fetching invoices:', error);
      throw error;
    }
  }

  // Get payments from Quickbooks
  async getPayments() {
    try {
      const response = await this.makeRequest('/query?query=SELECT * FROM Payment MAXRESULTS 1000');
      return response.QueryResponse.Payment || [];
    } catch (error) {
      console.error('Error fetching payments:', error);
      throw error;
    }
  }

  // Get transaction report with custom query parameters
  async getTransactionReport(queryParams = {}) {
    try {
      // Default parameters
      const defaults = {
        start_date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days ago
        end_date: new Date().toISOString().split('T')[0], // today
        report_type: 'TransactionList',
        columns: 'tx_date,doc_num,name,subt_nat_amount,customer',
        sort_by: 'tx_date',
        sort_order: 'desc',
        max_results: 1000
      };

      // Merge defaults with provided parameters
      const params = { ...defaults, ...queryParams };

      // Build query string
      const queryString = new URLSearchParams({
        start_date: params.start_date,
        end_date: params.end_date,
        report_type: params.report_type,
        transaction_type: 'SalesReceipt',
        columns: params.columns,
        sort_by: params.sort_by,
        sort_order: params.sort_order,
        max_results: params.max_results
      }).toString();

      console.log('📊 Fetching transaction report with params:', params);
      console.log('🔗 Full URL will be:', `${this.apiURL}/${this.realmId}/reports/TransactionList?${queryString}`);

      const response = await this.makeRequest(`/reports/TransactionList?${queryString}`);
      
      console.log('✅ Transaction report fetched successfully');
      console.log('📋 Response structure:');
      console.log('  Response keys:', Object.keys(response));
      console.log('  Response type:', typeof response);
      console.log('  Full response:', JSON.stringify(response, null, 2));
      
      return response;
    } catch (error) {
      console.error('❌ Error fetching transaction report:', error);
      console.error('❌ Error stack trace:', error.stack);
      throw error;
    }
  }

  // Get SalesReceipt details by ID
  async getSalesReceiptById(salesReceiptId) {
    try {
      if (!salesReceiptId) {
        throw new Error('SalesReceipt ID is required');
      }

      console.log(`📄 Fetching SalesReceipt details for ID: ${salesReceiptId}`);
      
      const response = await this.makeRequest(`/salesreceipt/${salesReceiptId}`);
      
      console.log('✅ SalesReceipt fetched successfully');
      console.log('📋 SalesReceipt response:', JSON.stringify(response, null, 2));
      
      return response;
    } catch (error) {
      console.error(`❌ Error fetching SalesReceipt ${salesReceiptId}:`, error);
      throw error;
    }
  }

  // Create customer in Quickbooks
  async createCustomer(customerData) {
    try {
      const customer = {
        Name: customerData.name,
        PrimaryEmailAddr: {
          Address: customerData.email
        },
        BillAddr: {
          Line1: customerData.address || '',
          City: customerData.city || '',
          CountrySubDivisionCode: customerData.state || '',
          PostalCode: customerData.zip || '',
          Country: customerData.country || 'US'
        }
      };

      const response = await this.makeRequest('/customer', 'POST', customer);
      return response.Customer;
    } catch (error) {
      console.error('Error creating customer:', error);
      throw error;
    }
  }

  // Create invoice in Quickbooks
  async createInvoice(invoiceData) {
    try {
      const invoice = {
        Line: invoiceData.items.map(item => ({
          Amount: item.amount,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            ItemRef: {
              value: item.itemId
            },
            Qty: item.quantity || 1
          }
        })),
        CustomerRef: {
          value: invoiceData.customerId
        }
      };

      const response = await this.makeRequest('/invoice', 'POST', invoice);
      return response.Invoice;
    } catch (error) {
      console.error('Error creating invoice:', error);
      throw error;
    }
  }

  // Sync data from your database to Quickbooks
  async syncToQuickbooks(localData) {
    try {
      console.log('Starting sync to Quickbooks...');
      
      const results = {
        customersCreated: 0,
        customersUpdated: 0,
        invoicesCreated: 0,
        errors: []
      };

      for (const record of localData) {
        try {
          // Check if customer exists
          const existingCustomers = await this.getCustomers();
          const existingCustomer = existingCustomers.find(c => 
            c.PrimaryEmailAddr?.Address === record.email
          );

          let customerId;
          if (existingCustomer) {
            customerId = existingCustomer.Id;
            results.customersUpdated++;
          } else {
            const newCustomer = await this.createCustomer({
              name: record.name,
              email: record.email
            });
            customerId = newCustomer.Id;
            results.customersCreated++;
          }

          // Create invoice for the customer
          const invoice = await this.createInvoice({
            customerId: customerId,
            items: [{
              itemId: '1', // Default item ID - you might want to create items first
              amount: parseFloat(record.amount.replace(/[$,]/g, '')),
              quantity: 1
            }]
          });
          
          results.invoicesCreated++;
          
        } catch (error) {
          results.errors.push({
            record: record,
            error: error.message
          });
        }
      }

      console.log('Sync completed:', results);
      return results;
      
    } catch (error) {
      console.error('Error during sync:', error);
      throw error;
    }
  }

  // Get sync status
  getSyncStatus() {
    return {
      isAuthenticated: !!this.accessToken,
      tokenExpiry: this.tokenExpiry,
      realmId: this.realmId,
      environment: this.environment
    };
  }

  // Revoke access token with QuickBooks
  async revokeToken() {
    if (!this.accessToken) {
      throw new Error('No access token to revoke');
    }

    try {
      const revokeURL = this.environment === 'production'
        ? 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
        : 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

      const response = await axios.post(revokeURL, {
        token: this.accessToken
      }, {
        auth: {
          username: this.clientId,
          password: this.clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log('✅ Token revoked successfully with QuickBooks');
      return true;
    } catch (error) {
      console.error('❌ Error revoking token:', error.response?.data || error.message);
      throw new Error('Failed to revoke token with QuickBooks');
    }
  }

  // Disconnect from Quickbooks (local cleanup)
  disconnect() {
    this.accessToken = null;
    this.refreshToken = null;
    this.realmId = null;
    this.tokenExpiry = null;
    console.log('Disconnected from Quickbooks');
  }

  // Full disconnect (revoke + cleanup)
  async fullDisconnect() {
    try {
      if (this.accessToken) {
        await this.revokeToken();
      }
      this.disconnect();
      console.log('✅ Fully disconnected from QuickBooks');
    } catch (error) {
      // Even if revoke fails, clean up locally
      this.disconnect();
      console.log('⚠️ Token revoked locally (QuickBooks revoke failed)');
    }
  }
}

// Create singleton instance
const quickbooksAPI = new QuickbooksAPI();

module.exports = quickbooksAPI; 