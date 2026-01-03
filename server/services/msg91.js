/**
 * MSG91 SMS & OTP Service
 * 
 * Environment Variables Required:
 * - MSG91_AUTH_KEY: Your MSG91 authentication key
 * - MSG91_SENDER_ID: Your MSG91 sender ID (6 characters)
 * - MSG91_TEMPLATE_ID_OTP: Template ID for OTP messages
 * - MSG91_TEMPLATE_ID_SMS: Template ID for regular SMS messages (optional)
 * 
 * Documentation: https://docs.msg91.com/
 */

const MSG91_API_URL = 'https://control.msg91.com/api/v5/flow/';

/**
 * Send OTP via MSG91
 * @param {string} phone - Phone number (with country code, e.g., 919876543210)
 * @param {string} otp - OTP code to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendOTPViaMSG91 = async (phone, otp) => {
  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    // Use MSG91 default sender ID if not specified (works for testing)
    const senderId = process.env.MSG91_SENDER_ID || 'MSG91';
    const templateId = process.env.MSG91_TEMPLATE_ID_OTP;

    // Log configuration for debugging
    console.log(`🔧 MSG91 Config:`, {
      authKey: authKey ? 'Set' : 'Missing',
      senderId: senderId,
      templateId: templateId || 'Not Set'
    });

    if (!authKey) {
      console.warn('⚠️ MSG91_AUTH_KEY not set. OTP will not be sent via SMS.');
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    // Format phone number (remove + and spaces, ensure it starts with country code)
    let formattedPhone = phone.replace(/[\s\+]/g, '');
    
    // If phone doesn't start with country code, add 91 (India)
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = '91' + formattedPhone;
    }
    
    // MSG91 SendOTP API (v5) - Recommended for OTP
    // Documentation: https://msg91.com/help/sendotp/step-by-step-process-to-configure-otp
    let url = 'https://control.msg91.com/api/v5/otp';
    let requestBody = {
      authkey: authKey,
      mobile: formattedPhone,
      otp: otp,
      sender: senderId,
      message: `Your OTP for ACE Home Solutions is ${otp}. Valid for 5 minutes. Do not share this OTP with anyone.`,
      // Enable real-time response to get immediate error feedback
      realTimeResponse: 1
    };

    // Add template ID only if provided AND using custom sender ID (not MSG91 default)
    // MSG91 default sender doesn't need DLT template
    if (templateId && senderId !== 'MSG91') {
      requestBody.template_id = templateId;
      // For SendOTP with template, message might not be needed
      // But keeping it for backward compatibility
    } else if (senderId !== 'MSG91' && formattedPhone.startsWith('91')) {
      // Using custom sender ID for India without template - warn but still try
      console.warn(`⚠️ Using custom sender ID "${senderId}" for India without DLT template. SMS may fail. Consider using MSG91_SENDER_ID=MSG91 for testing.`);
    }

    // Log the request being sent (hide auth key)
    console.log(`📤 MSG91 v5 API Request:`, JSON.stringify({
      ...requestBody,
      authkey: 'HIDDEN',
      mobile: formattedPhone
    }, null, 2));

    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    let responseText = await response.text();
    let data;
    
    // Log the raw response for debugging
    console.log(`📤 MSG91 v5 API Response (${response.status}):`, responseText);
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      // If v5 fails to parse, try v1 API (simpler, more reliable)
      console.log('⚠️ MSG91 v5 API response not JSON, trying v1 API...');
      console.log('📤 Raw v5 response:', responseText);
      
      // MSG91 v1 API - simpler GET request
      // Only add DLT_TE_ID if using custom sender (not MSG91 default)
      const dltParam1 = (templateId && senderId !== 'MSG91') ? `&DLT_TE_ID=${templateId}` : '';
      const v1Url = `https://control.msg91.com/api/sendotp.php?authkey=${authKey}&mobile=${formattedPhone}&message=${encodeURIComponent(`Your OTP for ACE Home Solutions is ${otp}. Valid for 5 minutes.`)}&sender=${senderId}&otp=${otp}${dltParam1}`;
      
      console.log(`📤 MSG91 v1 API URL: ${v1Url.replace(authKey, 'AUTH_KEY_HIDDEN')}`);
      
      response = await fetch(v1Url, {
        method: 'GET',
      });
      
      responseText = await response.text();
      console.log(`📤 MSG91 v1 API Response (${response.status}):`, responseText);
      
      // v1 API returns request ID as plain text if successful
      if (response.ok && /^\d+$/.test(responseText.trim())) {
        console.log(`✅ MSG91 OTP sent to ${formattedPhone} (v1 API) - Request ID: ${responseText.trim()}`);
        return { success: true, messageId: responseText.trim() };
      } else {
        console.error('❌ MSG91 OTP error (v1):', responseText);
        return { success: false, error: responseText || 'Failed to send OTP' };
      }
    }

    // Log parsed data for debugging
    console.log('📤 MSG91 v5 API Parsed Data:', JSON.stringify(data, null, 2));

    // Check v5 API response - MSG91 v5 API returns { type: 'success', request_id: '...' } on success
    // Or { type: 'error', message: '...' } on failure
    if (data.type === 'success' && data.request_id) {
      console.log(`✅ MSG91 OTP sent to ${formattedPhone} (v5 API) - Request ID: ${data.request_id}`);
      return { success: true, messageId: data.request_id };
    } else if (data.type === 'error' || data.message) {
      // v5 API returned an error
      const errorMsg = data.message || data.error || JSON.stringify(data);
      console.error('❌ MSG91 OTP error (v5):', errorMsg);
      console.error('📤 Full v5 response:', JSON.stringify(data, null, 2));
      
      // Fallback to v1 API
      console.log('⚠️ MSG91 v5 API failed, trying v1 API fallback...');
      // Only add DLT_TE_ID if using custom sender (not MSG91 default)
      const dltParam = (templateId && senderId !== 'MSG91') ? `&DLT_TE_ID=${templateId}` : '';
      const v1Url = `https://control.msg91.com/api/sendotp.php?authkey=${authKey}&mobile=${formattedPhone}&message=${encodeURIComponent(`Your OTP for ACE Home Solutions is ${otp}. Valid for 5 minutes.`)}&sender=${senderId}&otp=${otp}${dltParam}`;
      
      const v1Response = await fetch(v1Url, {
        method: 'GET',
      });
      
      const v1ResponseText = await v1Response.text();
      console.log(`📤 MSG91 v1 API Fallback Response (${v1Response.status}):`, v1ResponseText);
      
      if (v1Response.ok && /^\d+$/.test(v1ResponseText.trim())) {
        console.log(`✅ MSG91 OTP sent to ${formattedPhone} (v1 API fallback) - Request ID: ${v1ResponseText.trim()}`);
        return { success: true, messageId: v1ResponseText.trim() };
      }
      
      return { success: false, error: errorMsg };
    } else {
      // Unknown response format
      console.error('❌ MSG91 OTP unknown response format:', JSON.stringify(data, null, 2));
      return { success: false, error: 'Unknown response format from MSG91: ' + JSON.stringify(data) };
    }
  } catch (error) {
    console.error('MSG91 OTP error:', error);
    return { success: false, error: error.message || 'Failed to send OTP' };
  }
};

/**
 * Send SMS via MSG91
 * @param {string} phone - Phone number (with country code)
 * @param {string} message - SMS message to send
 * @param {string} templateId - Optional template ID for DLT compliance
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendSMSViaMSG91 = async (phone, message, templateId = null) => {
  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    // Use MSG91 default sender ID if not specified (works for testing)
    const senderId = process.env.MSG91_SENDER_ID || 'MSG91';
    const smsTemplateId = templateId || process.env.MSG91_TEMPLATE_ID_SMS;

    if (!authKey) {
      console.warn('⚠️ MSG91_AUTH_KEY not set. SMS will not be sent.');
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    // Format phone number (remove + and spaces, ensure it starts with country code)
    let formattedPhone = phone.replace(/[\s\+]/g, '');
    
    // If phone doesn't start with country code, add 91 (India)
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = '91' + formattedPhone;
    }
    
    // MSG91 SMS API endpoint
    // For India with custom sender ID, DLT template is required
    // If template ID is missing and using custom sender, warn but still try
    let dltParam = '';
    if (smsTemplateId) {
      dltParam = `&DLT_TE_ID=${smsTemplateId}`;
    } else if (senderId !== 'MSG91' && formattedPhone.startsWith('91')) {
      // Using custom sender ID for India without template - will likely fail
      console.warn(`⚠️ Using custom sender ID "${senderId}" for India without DLT template. SMS may fail. Consider using MSG91_SENDER_ID=MSG91 for testing or add MSG91_TEMPLATE_ID_SMS.`);
    }
    
    const url = `https://control.msg91.com/api/sendhttp.php?authkey=${authKey}&mobiles=${formattedPhone}&message=${encodeURIComponent(message)}&sender=${senderId}&route=4${dltParam}`;

    const response = await fetch(url, {
      method: 'GET',
    });

    const responseText = await response.text();
    
    // MSG91 returns a request ID if successful (numeric string)
    if (response.ok && /^\d+$/.test(responseText.trim())) {
      console.log(`✅ MSG91 SMS sent to ${phone}`);
      return { success: true, messageId: responseText.trim() };
    } else {
      console.error('❌ MSG91 SMS error:', responseText);
      return { success: false, error: responseText || 'Failed to send SMS' };
    }
  } catch (error) {
    console.error('MSG91 SMS error:', error);
    return { success: false, error: error.message || 'Failed to send SMS' };
  }
};

/**
 * Send OTP via MSG91 WhatsApp
 * @param {string} phone - Phone number (with country code, e.g., 919876543210)
 * @param {string} otp - OTP code to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
/**
 * Send OTP via MSG91 WhatsApp (Bulk API format - fallback)
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code
 * @param {string} authKey - MSG91 auth key
 * @param {string} whatsappNumber - WhatsApp number
 * @param {string} templateId - Template ID/name
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendOTPViaMSG91WhatsAppBulk = async (phone, otp, authKey, whatsappNumber, templateId) => {
  try {
    // Format phone number
    let formattedPhone = phone.replace(/[\s\+]/g, '');
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = '91' + formattedPhone;
    }

    // MSG91 WhatsApp Bulk API format (alternative format)
    const url = `https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`;
    const templateNamespace = process.env.MSG91_WHATSAPP_TEMPLATE_NAMESPACE || 'd665571e_4189_4728_9deb_e40e60213c3d';
    const templateLanguage = process.env.MSG91_WHATSAPP_TEMPLATE_LANGUAGE || 'en';

    // Build components object
    const components = {
      body_1: {
        type: 'text',
        value: otp
      }
    };

    // Add URL button parameter - template requires it
    // IMPORTANT: MSG91 has a 15-character limit for button parameter values
    const buttonText = process.env.MSG91_WHATSAPP_BUTTON_TEXT || process.env.MSG91_WHATSAPP_BUTTON_URL;
    
    // Check if this is an OTP template
    const isOTPTemplate = templateId && (
      templateId.toLowerCase().includes('otp') || 
      templateId.toLowerCase().includes('verification') ||
      templateId.toLowerCase().includes('code')
    );
    
    // If explicitly set to "none", don't include button parameter
    if (buttonText && buttonText.toLowerCase() === 'none') {
      // Don't add button parameter
    } else {
      let buttonValue;
      
      if (isOTPTemplate) {
        // For OTP templates, use the OTP code as button parameter value
        // MSG91 will use this in the OTP URL construction
        // Ensure OTP is within 15 character limit
        buttonValue = otp.length <= 15 ? otp : otp.substring(0, 15);
        console.log(`📝 OTP template detected (${templateId}), using OTP code as button parameter: ${buttonValue}`);
      } else {
        // For non-OTP templates, use configured text or default
        buttonValue = 'Click Here'; // Default text (10 chars, within limit)
        
        if (buttonText && buttonText.trim() !== '' && buttonText.toLowerCase() !== 'none') {
          let textValue = buttonText.trim();
          
          // If it looks like a URL, convert to simple text to avoid "contains url" error
          if (textValue.includes('http') || textValue.includes('://') || 
              (textValue.includes('.com') || textValue.includes('.in') || textValue.includes('.')) && 
              textValue.split('.').length > 1 && textValue.length > 8) {
            // Looks like a URL, extract domain name or use simple text
            console.warn(`⚠️ Button value looks like URL, converting to simple text to avoid "contains url" error`);
            try {
              // Try to extract just the domain name part
              let domain = textValue;
              if (domain.startsWith('https://')) domain = domain.substring(8);
              else if (domain.startsWith('http://')) domain = domain.substring(7);
              if (domain.startsWith('www.')) domain = domain.substring(4);
              // Remove TLD to make it less URL-like
              domain = domain.split('.')[0];
              if (domain.length > 0 && domain.length <= 15) {
                textValue = domain;
              } else {
                textValue = 'Click Here';
              }
            } catch (e) {
              textValue = 'Click Here';
            }
          }
          
          // Ensure it's within 15 character limit
          if (textValue.length > 15) {
            console.warn(`⚠️ Button text exceeds 15 character limit (${textValue.length} chars). Truncating.`);
            textValue = textValue.substring(0, 15);
          }
          
          buttonValue = textValue;
        }
      }
      
      // Always include button parameter (template requires it)
      components.button_1 = {
        subtype: 'url',
        type: 'text',
        value: buttonValue  // Use 'value' not 'text'
      };
      console.log(`📝 Using button parameter: ${buttonValue} (${buttonValue.length} chars)`);
    }

    const requestBody = {
      integrated_number: whatsappNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateId,
          language: {
            code: templateLanguage,
            policy: 'deterministic'
          },
          namespace: templateNamespace,
          to_and_components: [
            {
              to: [formattedPhone],
              components: components
            }
          ]
        }
      }
    };

    // Log the request (hide sensitive data)
    const logComponents = { ...components };
    if (logComponents.body_1) {
      logComponents.body_1 = { ...logComponents.body_1, value: 'HIDDEN' };
    }
    if (logComponents.button_1) {
      logComponents.button_1 = { ...logComponents.button_1, value: 'HIDDEN' };
    }
    console.log(`📤 MSG91 WhatsApp OTP Request (Bulk Format):`, JSON.stringify({
      integrated_number: whatsappNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateId,
          language: {
            code: templateLanguage,
            policy: 'deterministic'
          },
          namespace: templateNamespace,
          to_and_components: [{
            to: [formattedPhone],
            components: logComponents
          }]
        }
      }
    }, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'authkey': authKey,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return { success: false, error: responseText || 'Failed to send WhatsApp OTP' };
    }

    console.log(`📤 MSG91 WhatsApp OTP Response (${response.status}):`, JSON.stringify(data, null, 2));

    if (response.ok && (data.status === 'success' || data.type === 'success' || data.request_id || data.message_id)) {
      const messageId = data.request_id || data.message_id || data.data?.request_id || 'N/A';
      console.log(`✅ MSG91 WhatsApp OTP sent to ${formattedPhone} (bulk format) - Request ID: ${messageId}`);
      console.log(`💡 Check MSG91 Dashboard → WhatsApp → Logs for delivery status`);
      return { success: true, messageId: messageId };
    } else {
      const errorMsg = data.message || data.error || data.data?.message || JSON.stringify(data);
      console.error(`❌ MSG91 WhatsApp OTP error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Failed to send WhatsApp OTP' };
  }
};

/**
 * Send OTP via MSG91 WhatsApp (Official API format)
 * @param {string} phone - Phone number (with country code, e.g., 919876543210)
 * @param {string} otp - OTP code to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendOTPViaMSG91WhatsApp = async (phone, otp) => {
  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    const whatsappNumber = process.env.MSG91_WHATSAPP_NUMBER || '919044393026';

    if (!authKey) {
      console.warn('⚠️ MSG91_AUTH_KEY not set. WhatsApp OTP will not be sent.');
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    // Format phone number
    let formattedPhone = phone.replace(/[\s\+]/g, '');
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = '91' + formattedPhone;
    }

    // MSG91 WhatsApp API - Use bulk format directly (matches official documentation)
    // Documentation: https://docs.msg91.com/whatsapp
    // Endpoint: POST /api/v5/whatsapp/whatsapp-outbound-message/bulk/
    const templateId = process.env.MSG91_WHATSAPP_TEMPLATE_ID_OTP || process.env.MSG91_WHATSAPP_TEMPLATE_ID || 'otp_verify';
    const templateNamespace = process.env.MSG91_WHATSAPP_TEMPLATE_NAMESPACE || 'd665571e_4189_4728_9deb_e40e60213c3d';
    const templateLanguage = process.env.MSG91_WHATSAPP_TEMPLATE_LANGUAGE || 'en';

    // Use bulk format directly (this is what creates logs in MSG91 dashboard)
    return await sendOTPViaMSG91WhatsAppBulk(phone, otp, authKey, whatsappNumber, templateId);
  } catch (error) {
    console.error('MSG91 WhatsApp OTP error:', error);
    return { success: false, error: error.message || 'Failed to send WhatsApp OTP' };
  }
};

/**
 * Create WhatsApp Template via MSG91 API
 * Documentation: https://docs.msg91.com/whatsapp
 * Endpoint: POST /api/v5/whatsapp/client-panel-template/
 * 
 * @param {Object} templateData - Template configuration
 * @param {string} templateData.name - Template name
 * @param {string} templateData.language - Language code (e.g., 'en')
 * @param {string} templateData.category - Category ('UTILITY' or 'MARKETING')
 * @param {Array} templateData.components - Template components (HEADER, BODY, FOOTER, BUTTONS)
 * @returns {Promise<{success: boolean, templateId?: string, error?: string}>}
 */
export const createMSG91WhatsAppTemplate = async (templateData) => {
  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    const whatsappNumber = process.env.MSG91_WHATSAPP_NUMBER || '919044393026';

    if (!authKey) {
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    const url = `https://api.msg91.com/api/v5/whatsapp/client-panel-template/`;

    const requestBody = {
      integrated_number: whatsappNumber,
      template_name: templateData.name,
      language: templateData.language || 'en',
      category: templateData.category || 'UTILITY',
      components: templateData.components,
    };

    console.log(`📤 MSG91 Create Template Request:`, JSON.stringify({
      ...requestBody,
      integrated_number: whatsappNumber
    }, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authkey': authKey,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ MSG91 Create Template response not JSON:', responseText);
      return { success: false, error: responseText || 'Failed to create template' };
    }

    console.log(`📤 MSG91 Create Template Response (${response.status}):`, JSON.stringify(data, null, 2));

    if (response.ok && (data.status === 'success' || data.template_id || data.data?.template_id)) {
      const templateId = data.template_id || data.data?.template_id || templateData.name;
      console.log(`✅ MSG91 WhatsApp template created: ${templateData.name} - Template ID: ${templateId}`);
      return { success: true, templateId: templateId };
    } else {
      const errorMsg = data.message || data.error || data.data?.message || JSON.stringify(data);
      console.error('❌ MSG91 Create Template error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('MSG91 Create Template error:', error);
    return { success: false, error: error.message || 'Failed to create template' };
  }
};

/**
 * Verify OTP via MSG91 (if using MSG91's OTP verification)
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code to verify
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const verifyOTPViaMSG91 = async (phone, otp) => {
  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    
    if (!authKey) {
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    const formattedPhone = phone.replace(/[\s\+]/g, '');
    const url = `https://control.msg91.com/api/v5/otp/verify?authkey=${authKey}&mobile=${formattedPhone}&otp=${otp}`;

    const response = await fetch(url, {
      method: 'GET',
    });

    const data = await response.json();

    if (data.type === 'success') {
      return { success: true };
    } else {
      return { success: false, error: data.message || 'Invalid OTP' };
    }
  } catch (error) {
    console.error('MSG91 OTP verification error:', error);
    return { success: false, error: error.message || 'Failed to verify OTP' };
  }
};

