/**
 * WhatsApp Business API Service
 * 
 * Supports multiple providers:
 * 1. MSG91 WhatsApp API
 * 2. Twilio WhatsApp API
 * 3. Meta Business API (Facebook)
 * 
 * Environment Variables Required (MSG91):
 * - MSG91_AUTH_KEY: Your MSG91 authentication key
 * - MSG91_WHATSAPP_NUMBER: Your MSG91 WhatsApp number (e.g., 919044393026)
 * 
 * Environment Variables Required (Twilio):
 * - TWILIO_ACCOUNT_SID: Your Twilio Account SID
 * - TWILIO_AUTH_TOKEN: Your Twilio Auth Token
 * - TWILIO_WHATSAPP_FROM: Your Twilio WhatsApp number (format: whatsapp:+14155238886)
 * 
 * Environment Variables Required (Meta):
 * - META_WHATSAPP_ACCESS_TOKEN: Your Meta WhatsApp Business API access token
 * - META_WHATSAPP_PHONE_NUMBER_ID: Your Meta WhatsApp Business phone number ID
 * - META_WHATSAPP_BUSINESS_ACCOUNT_ID: Your Meta WhatsApp Business Account ID (optional)
 * 
 * Set WHATSAPP_PROVIDER to 'msg91', 'twilio', or 'meta' (default: 'twilio')
 */

/**
 * Send WhatsApp message via Twilio
 * @param {string} to - Recipient phone number (format: whatsapp:+919876543210)
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendViaTwilio = async (to, message) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      console.warn('⚠️ Twilio credentials not set. WhatsApp message will not be sent.');
      return { success: false, error: 'Twilio credentials not configured' };
    }

    // Format recipient number
    let formattedTo = to.replace(/[\s\+]/g, '');
    if (!formattedTo.startsWith('whatsapp:')) {
      formattedTo = `whatsapp:+${formattedTo.replace(/^\+/, '')}`;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        From: from,
        To: formattedTo,
        Body: message,
      }),
    });

    const data = await response.json();

    if (response.ok && data.sid) {
      console.log(`✅ WhatsApp (Twilio) sent to ${to}`);
      return { success: true, messageId: data.sid };
    } else {
      console.error('❌ Twilio WhatsApp error:', data);
      return { success: false, error: data.message || 'Failed to send WhatsApp message' };
    }
  } catch (error) {
    console.error('Twilio WhatsApp error:', error);
    return { success: false, error: error.message || 'Failed to send WhatsApp message' };
  }
};

/**
 * Send WhatsApp message via Meta Business API
 * @param {string} to - Recipient phone number (format: 919876543210)
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendViaMeta = async (to, message) => {
  try {
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      console.warn('⚠️ Meta WhatsApp credentials not set. WhatsApp message will not be sent.');
      return { success: false, error: 'Meta WhatsApp credentials not configured' };
    }

    // Format recipient number (remove + and spaces)
    const formattedTo = to.replace(/[\s\+]/g, '');

    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: formattedTo,
        type: 'text',
        text: {
          body: message,
        },
      }),
    });

    const data = await response.json();

    if (response.ok && data.messages && data.messages[0]?.id) {
      console.log(`✅ WhatsApp (Meta) sent to ${to}`);
      return { success: true, messageId: data.messages[0].id };
    } else {
      console.error('❌ Meta WhatsApp error:', data);
      return { success: false, error: data.error?.message || 'Failed to send WhatsApp message' };
    }
  } catch (error) {
    console.error('Meta WhatsApp error:', error);
    return { success: false, error: error.message || 'Failed to send WhatsApp message' };
  }
};

/**
 * Send WhatsApp message via MSG91 WhatsApp API
 * @param {string} to - Recipient phone number (format: 919876543210)
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
/**
 * Send WhatsApp via MSG91 (Bulk API format - fallback)
 */
const sendViaMSG91Bulk = async (to, message, authKey, whatsappNumber, templateName, templateNamespace) => {
  try {
    let formattedTo = to.replace(/[\s\+]/g, '');
    if (!formattedTo.startsWith('91') && formattedTo.length === 10) {
      formattedTo = '91' + formattedTo;
    }

    const url = `https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`;
    const templateLanguage = process.env.MSG91_WHATSAPP_TEMPLATE_LANGUAGE || 'en';

    // Parse message for booking_updates template
    // Template format: "Hello! {{1}}\n\n{{2}}\n\nThank you for choosing ACE Home Solutions!"
    // Extract name and message from the formatted message
    let name = 'Customer';
    let messageText = message;
    
    // Check if this is a booking update message (has "Hello!" and structured format)
    const isBookingUpdate = templateName === 'booking_updates' || 
                           templateName.includes('booking') ||
                           (message.includes('Hello!') && message.includes('\n\n'));
    
    if (isBookingUpdate && message.includes('Hello!') && message.includes('\n\n')) {
      const parts = message.split('\n\n');
      if (parts.length >= 2) {
        // Extract name from "Hello! Name"
        const namePart = parts[0].replace('Hello!', '').trim();
        name = namePart || 'Customer';
        // Get the main message (skip "Thank you..." part)
        messageText = parts[1] || message;
        // Remove "Thank you for choosing ACE Home Solutions!" if present
        if (messageText.includes('Thank you for choosing ACE Home Solutions!')) {
          messageText = messageText.replace('Thank you for choosing ACE Home Solutions!', '').trim();
        }
      }
    }

    const components = {};
    
    // For booking_updates template, use body_1 and body_2
    if (isBookingUpdate) {
      components.body_1 = {
        type: 'text',
        value: name
      };
      components.body_2 = {
        type: 'text',
        value: messageText
      };
    } else {
      // For OTP template, use body_1 only
      components.body_1 = {
        type: 'text',
        value: message
      };
    }

    const requestBody = {
      integrated_number: whatsappNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: templateLanguage,
            policy: 'deterministic'
          },
          namespace: templateNamespace,
          to_and_components: [
            {
              to: [formattedTo],
              components: components
            }
          ]
        }
      }
    };

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
      return { success: false, error: responseText || 'Failed to send WhatsApp message' };
    }

    if (response.ok && (data.status === 'success' || data.type === 'success' || data.request_id || data.message_id)) {
      const messageId = data.request_id || data.message_id || 'N/A';
      console.log(`✅ MSG91 WhatsApp sent to ${formattedTo} (bulk format) - Request ID: ${messageId}`);
      return { success: true, messageId: messageId };
    } else {
      const errorMsg = data.message || data.error || data.data?.message || JSON.stringify(data);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Failed to send WhatsApp message' };
  }
};

/**
 * Send WhatsApp message via MSG91 WhatsApp API
 * @param {string} to - Recipient phone number (format: 919876543210)
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendViaMSG91 = async (to, message) => {
  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    const whatsappNumber = process.env.MSG91_WHATSAPP_NUMBER || '919044393026'; // Your WhatsApp number
    // Use booking template for non-OTP messages, OTP template for OTP messages
    // Check if message looks like an OTP (6 digits) or booking update
    const isOTP = /^\d{6}$/.test(message.trim()) || message.includes('OTP') || message.includes('otp');
    const templateName = isOTP 
      ? (process.env.MSG91_WHATSAPP_TEMPLATE_ID_OTP || 'otp_verification')
      : (process.env.MSG91_WHATSAPP_TEMPLATE_ID_BOOKING || process.env.MSG91_WHATSAPP_TEMPLATE_ID || 'booking_updates');
    const templateNamespace = process.env.MSG91_WHATSAPP_TEMPLATE_NAMESPACE || 'd665571e_4189_4728_9deb_e40e60213c3d';

    if (!authKey) {
      console.warn('⚠️ MSG91_AUTH_KEY not set. WhatsApp message will not be sent.');
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    // Format recipient number (remove + and spaces)
    let formattedTo = to.replace(/[\s\+]/g, '');
    
    // If phone doesn't start with country code, add 91 (India)
    if (!formattedTo.startsWith('91') && formattedTo.length === 10) {
      formattedTo = '91' + formattedTo;
    }

    // For booking updates, use bulk format directly (it works better with template variables)
    // For OTP, we can try simple format first, but booking updates need bulk format
    if (!isOTP) {
      // Booking updates: Use bulk format directly
      console.log(`📤 MSG91 WhatsApp: Using bulk format for booking update to ${formattedTo}`);
      return await sendViaMSG91Bulk(to, message, authKey, whatsappNumber, templateName, templateNamespace);
    }

    // OTP: Try simple format first, fallback to bulk if needed
    const url = `https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/`;
    const requestBody = {
      template_id: templateName,
      recipient: formattedTo,
      variables: {
        '1': message // For OTP template, this would be the OTP value
      }
    };

    console.log(`📤 MSG91 WhatsApp API Request (OTP):`, JSON.stringify({
      template_id: requestBody.template_id,
      recipient: requestBody.recipient,
      variables: { '1': 'HIDDEN' } // Hide actual OTP value
    }, null, 2));

    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'authkey': authKey, // MSG91 uses authkey in header
      },
      body: JSON.stringify(requestBody),
    });

    let responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ MSG91 WhatsApp API response not JSON:', responseText);
      // Fallback to bulk format
      console.log('🔄 Falling back to bulk format...');
      return await sendViaMSG91Bulk(to, message, authKey, whatsappNumber, templateName, templateNamespace);
    }

    console.log(`📤 MSG91 WhatsApp API Response (${response.status}):`, JSON.stringify(data, null, 2));

    if (response.ok && (data.status === 'success' || data.type === 'success' || data.request_id || data.message_id)) {
      const messageId = data.request_id || data.message_id || data.data?.request_id || 'N/A';
      console.log(`✅ MSG91 WhatsApp sent to ${formattedTo} - Request ID: ${messageId}`);
      return { success: true, messageId: messageId };
    } else {
      // Fallback to bulk format
      const errorMsg = data.message || data.error || data.data?.message || JSON.stringify(data);
      console.warn(`⚠️ MSG91 WhatsApp error (simple format): ${errorMsg}. Trying bulk format...`);
      console.log('🔄 Falling back to bulk format...');
      return await sendViaMSG91Bulk(to, message, authKey, whatsappNumber, templateName, templateNamespace);
    }
  } catch (error) {
    console.error('MSG91 WhatsApp error:', error);
    return { success: false, error: error.message || 'Failed to send WhatsApp message' };
  }
};

/**
 * Send admin booking notification via MSG91 WhatsApp (uses dedicated template)
 * @param {string} to - Admin phone number (format: 919876543210)
 * @param {Object} bookingData - Booking data object
 * @param {string} bookingData.bookingId - Booking ID (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendAdminBookingNotification = async (to, bookingData) => {
  const provider = process.env.WHATSAPP_PROVIDER || 'twilio';
  
  // Only MSG91 supports templates, for other providers use plain message
  if (provider !== 'msg91') {
    // Fallback to plain message for Twilio/Meta
    const message = bookingData.bookingId 
      ? `🔔 You have received a new booking.\n\nBooking ID: ${bookingData.bookingId}\n\nPlease check the admin panel for details.`
      : `🔔 You have received a new booking.\n\nPlease check the admin panel for details.`;
    return await sendWhatsApp(to, message);
  }

  try {
    const authKey = process.env.MSG91_AUTH_KEY;
    const whatsappNumber = process.env.MSG91_WHATSAPP_NUMBER || '919044393026';
    const templateName = process.env.MSG91_WHATSAPP_TEMPLATE_ID_ADMIN_BOOKING || 'admin_booking_notification';
    const templateNamespace = process.env.MSG91_WHATSAPP_TEMPLATE_NAMESPACE || 'd665571e_4189_4728_9deb_e40e60213c3d';
    const templateLanguage = process.env.MSG91_WHATSAPP_TEMPLATE_LANGUAGE || 'en';

    if (!authKey) {
      console.warn('⚠️ MSG91_AUTH_KEY not set. Admin WhatsApp notification will not be sent.');
      return { success: false, error: 'MSG91_AUTH_KEY not configured' };
    }

    // Format recipient number
    let formattedTo = to.replace(/[\s\+]/g, '');
    if (!formattedTo.startsWith('91') && formattedTo.length === 10) {
      formattedTo = '91' + formattedTo;
    }

    // Build template components - simple notification with optional booking ID
    // Template can have 0 or 1 variable (booking ID is optional)
    // Check if template expects variables by checking env variable
    // Default to false (no variables) to match Option 1 template
    const templateHasVariables = process.env.MSG91_ADMIN_BOOKING_TEMPLATE_HAS_VARIABLES === 'true';
    
    const url = `https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`;
    
    // Build request body - MSG91 requires components object even if empty
    const toAndComponents = {
      to: [formattedTo],
      components: {} // Always include components, even if empty
    };
    
    // Only add component values if template has variables (for templates with variables)
    // If template has 0 variables (Option 1), components remains empty {}
    if (templateHasVariables && bookingData.bookingId) {
      toAndComponents.components = {
        body_1: { type: 'text', value: bookingData.bookingId }
      };
    }
    
    const requestBody = {
      integrated_number: whatsappNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: templateLanguage,
            policy: 'deterministic'
          },
          namespace: templateNamespace,
          to_and_components: [toAndComponents]
        }
      }
    };

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
      return { success: false, error: responseText || 'Failed to send admin WhatsApp notification' };
    }

    if (response.ok && (data.status === 'success' || data.type === 'success' || data.request_id || data.message_id)) {
      const messageId = data.request_id || data.message_id || 'N/A';
      console.log(`✅ MSG91 Admin WhatsApp notification sent to ${formattedTo} - Request ID: ${messageId}`);
      return { success: true, messageId: messageId };
    } else {
      const errorMsg = data.message || data.error || data.data?.message || JSON.stringify(data);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('MSG91 Admin WhatsApp notification error:', error);
    return { success: false, error: error.message || 'Failed to send admin WhatsApp notification' };
  }
};

/**
 * Send WhatsApp message (auto-selects provider based on env)
 * @param {string} to - Recipient phone number
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendWhatsApp = async (to, message) => {
  const provider = process.env.WHATSAPP_PROVIDER || 'twilio';

  if (provider === 'msg91') {
    return await sendViaMSG91(to, message);
  } else if (provider === 'meta') {
    return await sendViaMeta(to, message);
  } else {
    return await sendViaTwilio(to, message);
  }
};

