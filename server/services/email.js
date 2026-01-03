/**
 * Email Service
 * 
 * Supports multiple providers:
 * 1. Resend (recommended - modern, simple API)
 * 2. SendGrid
 * 3. Nodemailer (SMTP - Gmail, Outlook, custom SMTP)
 * 
 * Environment Variables Required (Resend):
 * - RESEND_API_KEY: Your Resend API key
 * - EMAIL_FROM: Sender email address (e.g., noreply@acehomesolutions.in)
 * 
 * Environment Variables Required (SendGrid):
 * - SENDGRID_API_KEY: Your SendGrid API key
 * - EMAIL_FROM: Sender email address
 * 
 * Environment Variables Required (Nodemailer/SMTP):
 * - SMTP_HOST: SMTP server host
 * - SMTP_PORT: SMTP server port
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - EMAIL_FROM: Sender email address
 * 
 * Set EMAIL_PROVIDER to 'resend', 'sendgrid', or 'smtp' (default: 'resend')
 */

/**
 * Send email via Resend
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {string} text - Email plain text content (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendViaResend = async (to, subject, html, text = null) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || 'noreply@acehomesolutions.in';

    if (!apiKey) {
      console.warn('⚠️ RESEND_API_KEY not set. Email will not be sent.');
      return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML if no text provided
      }),
    });

    const data = await response.json();

    if (response.ok && data.id) {
      console.log(`✅ Email (Resend) sent to ${to}`);
      return { success: true, messageId: data.id };
    } else {
      console.error('❌ Resend email error:', data);
      return { success: false, error: data.message || 'Failed to send email' };
    }
  } catch (error) {
    console.error('Resend email error:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
};

/**
 * Send email via SendGrid
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {string} text - Email plain text content (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendViaSendGrid = async (to, subject, html, text = null) => {
  try {
    const apiKey = process.env.SENDGRID_API_KEY;
    const from = process.env.EMAIL_FROM || 'noreply@acehomesolutions.in';

    if (!apiKey) {
      console.warn('⚠️ SENDGRID_API_KEY not set. Email will not be sent.');
      return { success: false, error: 'SENDGRID_API_KEY not configured' };
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
          },
        ],
        from: { email: from },
        subject,
        content: [
          {
            type: 'text/html',
            value: html,
          },
          ...(text ? [{ type: 'text/plain', value: text }] : []),
        ],
      }),
    });

    if (response.ok) {
      const messageId = response.headers.get('x-message-id');
      console.log(`✅ Email (SendGrid) sent to ${to}`);
      return { success: true, messageId: messageId || `sg_${Date.now()}` };
    } else {
      const errorData = await response.json();
      console.error('❌ SendGrid email error:', errorData);
      return { success: false, error: errorData.errors?.[0]?.message || 'Failed to send email' };
    }
  } catch (error) {
    console.error('SendGrid email error:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
};

/**
 * Send email via SMTP (Nodemailer)
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {string} text - Email plain text content (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendViaSMTP = async (to, subject, html, text = null) => {
  try {
    const nodemailer = (await import('nodemailer')).default;
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || user;

    if (!host || !user || !pass) {
      console.warn('⚠️ SMTP credentials not set. Email will not be sent.');
      return { success: false, error: 'SMTP credentials not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });

    console.log(`✅ Email (SMTP) sent to ${to}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('SMTP email error:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
};

/**
 * Send email (auto-selects provider based on env)
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {string} text - Email plain text content (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendEmail = async (to, subject, html, text = null) => {
  const provider = process.env.EMAIL_PROVIDER || 'resend';

  if (provider === 'sendgrid') {
    return await sendViaSendGrid(to, subject, html, text);
  } else if (provider === 'smtp') {
    return await sendViaSMTP(to, subject, html, text);
  } else {
    return await sendViaResend(to, subject, html, text);
  }
};

