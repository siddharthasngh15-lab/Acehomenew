/**
 * Unified Notification Service
 * 
 * This service coordinates all notification channels:
 * - WhatsApp via MSG91 (primary - all SMS requests are converted to WhatsApp)
 * - Email via Resend, SendGrid, or SMTP (optional)
 * 
 * All notifications are stored in the database for tracking.
 * 
 * Note: All SMS and WhatsApp requests are sent via WhatsApp through MSG91.
 */

import { sendOTPViaMSG91, sendSMSViaMSG91 } from './msg91.js';
import { sendWhatsApp } from './whatsapp.js';
import { sendEmail } from './email.js';
import mongoose from 'mongoose';

// Notification model (will be passed from index.js or defined here)
let NotificationModel = null;

export const setNotificationModel = (model) => {
  NotificationModel = model;
};

/**
 * Send notification via specified channel
 * @param {Object} options
 * @param {string} options.to - Recipient (phone or email)
 * @param {string} options.type - 'sms' | 'whatsapp' | 'email'
 * @param {string} options.subject - Subject (for email)
 * @param {string} options.message - Message content
 * @param {string} options.userId - User ID for database tracking
 * @param {string} options.bookingId - Booking ID (optional)
 * @param {Object} options.metadata - Additional metadata (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendNotification = async ({
  to,
  type,
  subject,
  message,
  userId,
  bookingId,
  metadata = {},
}) => {
  try {
    let result = { success: false, error: 'Unknown notification type' };

    // Send via appropriate channel
    // All SMS and WhatsApp requests now go through WhatsApp via MSG91
    if (type === 'sms' || type === 'whatsapp') {
      // Convert SMS requests to WhatsApp (MSG91)
      result = await sendWhatsApp(to, message);
    } else if (type === 'email') {
      // Convert message to HTML if it's plain text
      const html = message.includes('<') ? message : `<p>${message.replace(/\n/g, '<br>')}</p>`;
      result = await sendEmail(to, subject || 'ACE Home Solutions', html);
    }

    // Store notification in database
    const notificationStatus = result.success ? 'sent' : 'failed';
    
    try {
      if (NotificationModel) {
        await NotificationModel.create({
          user_id: userId,
          type,
          subject: subject || null,
          message,
          status: notificationStatus,
          metadata: {
            booking_id: bookingId,
            ...metadata,
            provider_result: result,
          },
        });
      }
    } catch (dbError) {
      console.error('Failed to store notification in database:', dbError);
      // Don't fail the whole operation if DB write fails
    }

    return result;
  } catch (error) {
    console.error('Notification service error:', error);
    return { success: false, error: error.message || 'Failed to send notification' };
  }
};

/**
 * Send OTP via WhatsApp (MSG91)
 * Note: This function is kept for backward compatibility but OTP is now sent via WhatsApp
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code
 * @param {string} userId - User ID (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendOTP = async (phone, otp, userId = null) => {
  // OTP is now sent via WhatsApp in the request-otp endpoint
  // This function is kept for backward compatibility
  const { sendOTPViaMSG91WhatsApp } = await import('./msg91.js');
  return await sendOTPViaMSG91WhatsApp(phone, otp);
};

/**
 * Send booking status update notifications
 * @param {Object} options
 * @param {Object} options.customer - Customer profile object
 * @param {string} options.status - Booking status
 * @param {string} options.serviceName - Service name
 * @param {string} options.employeeName - Employee name
 * @param {string} options.bookingId - Booking ID
 * @returns {Promise<void>}
 */
export const sendBookingStatusUpdate = async ({
  customer,
  status,
  serviceName,
  employeeName,
  bookingId,
}) => {
  const customerName = customer.full_name || 'Customer';
  
  const messages = {
    assigned: `Hello! ${customerName}\n\nGreat news! ${employeeName} has been assigned to your ${serviceName} booking. They will contact you soon.\n\nThank you for choosing ACE Home Solutions!`,
    accepted: `Hello! ${customerName}\n\n${employeeName} has accepted your ${serviceName} booking. They will reach your location soon.\n\nThank you for choosing ACE Home Solutions!`,
    reached: `Hello! ${customerName}\n\n${employeeName} has reached your location for your ${serviceName} service.\n\nThank you for choosing ACE Home Solutions!`,
    in_progress: `Hello! ${customerName}\n\n${employeeName} has started your ${serviceName} service. They are working on it now.\n\nThank you for choosing ACE Home Solutions!`,
    completed: `Hello! ${customerName}\n\nYour ${serviceName} service has been completed! Please rate your experience in your dashboard.\n\nThank you for choosing ACE Home Solutions!`,
    cancelled: `Hello! ${customerName}\n\nYour ${serviceName} booking has been cancelled. If you have any questions, please contact us.\n\nThank you for choosing ACE Home Solutions!`,
  };

  const subjects = {
    assigned: 'Worker Assigned to Your Booking',
    accepted: 'Worker Accepted Your Booking',
    reached: 'Worker Reached Your Location',
    in_progress: 'Service Started',
    completed: 'Service Completed',
    cancelled: 'Booking Cancelled',
  };

  const message = messages[status] || `Your booking status has been updated to ${status}.`;
  const subject = subjects[status] || 'Booking Status Updated';

  // Get customer ID (handle both populated and non-populated)
  const customerId = customer._id ? (customer._id.toString ? customer._id.toString() : customer._id) : customer;

  const promises = [];

  // Send WhatsApp via MSG91 (only - no SMS)
  if (customer.phone) {
    promises.push(
      sendNotification({
        to: customer.phone,
        type: 'whatsapp',
        message,
        userId: customerId,
        bookingId,
        metadata: { status },
      })
    );
  }

  // Send Email (only if email providers are configured)
  // To disable email, simply don't configure EMAIL_PROVIDER in .env
  if (customer.email && process.env.EMAIL_PROVIDER) {
    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4090C0;">ACE Home Solutions</h2>
        <p>${message}</p>
        <p style="color: #666; font-size: 14px;">Thank you for choosing ACE Home Solutions!</p>
      </div>
    `;
    
    promises.push(
      sendNotification({
        to: customer.email,
        type: 'email',
        subject,
        message: htmlMessage,
        userId: customerId,
        bookingId,
        metadata: { status },
      })
    );
  }

  // Send all notifications in parallel
  await Promise.allSettled(promises);
};

