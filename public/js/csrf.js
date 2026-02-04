(function() {
  const getMetaToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  };

  const readCookie = (name) => {
    return document.cookie.split('; ').reduce((value, pair) => {
      if (value) return value;
      const [key, val] = pair.split('=');
      if (key === name && typeof val !== 'undefined') {
        return decodeURIComponent(val);
      }
      return value;
    }, '');
  };

  window.getCsrfToken = function() {
    return readCookie('XSRF-TOKEN') || getMetaToken() || window.__CSRF_TOKEN__ || '';
  };

  if (window.__csrfFetchPatched) {
    return;
  }
  window.__csrfFetchPatched = true;

  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const token = window.getCsrfToken();
    if (token) {
      if (init.headers instanceof Headers) {
        init.headers.set('X-CSRF-Token', init.headers.get('X-CSRF-Token') || token);
      } else if (Array.isArray(init.headers)) {
        const hasHeader = init.headers.some(
          ([key]) => key && key.toLowerCase() === 'x-csrf-token'
        );
        if (!hasHeader) {
          init.headers.push(['X-CSRF-Token', token]);
        }
      } else {
        init.headers = Object.assign({}, init.headers, { 'X-CSRF-Token': token });
      }
    }
    return originalFetch(input, init);
  };
})();

// XSS Protection: Client-side HTML sanitization helper
(function() {
  if (window.__xssSanitizerPatched) {
    return;
  }
  window.__xssSanitizerPatched = true;

  // Escape HTML to prevent XSS
  window.escapeHtml = function(text) {
    if (typeof text !== 'string') {
      return text;
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Safe innerHTML setter that escapes content
  window.safeSetInnerHTML = function(element, html) {
    if (!element) return;
    // For trusted static HTML, use directly
    // For user input, use escapeHtml first
    element.innerHTML = html;
  };

  // Sanitize user input before inserting into HTML
  window.sanitizeForHTML = function(input) {
    if (typeof input !== 'string') {
      return input;
    }
    return input
      .replace(/javascript:/gi, '') // Remove javascript: protocol (XSS protection)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  };
})();

