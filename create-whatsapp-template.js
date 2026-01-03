/**
 * Script to create WhatsApp OTP template via MSG91 API
 * 
 * Run: node create-whatsapp-template.js
 */

import { createMSG91WhatsAppTemplate } from './server/services/msg91.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function createOTPTemplate() {
  console.log('🚀 Creating WhatsApp OTP Template via MSG91 API...\n');

  // Template data based on official MSG91 API documentation
  // Documentation: https://docs.msg91.com/whatsapp
  const templateData = {
    name: 'otp_verification',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Your OTP for ACE Home Solutions is {{1}}. Valid for 5 minutes. Do not share this OTP with anyone.',
        example: {
          body_text: [['123456']] // Example OTP value for variable {{1}}
        }
      },
      {
        type: 'FOOTER',
        text: 'ACE Home Solutions'
      }
    ]
  };

  console.log('📝 Template Configuration:');
  console.log(JSON.stringify(templateData, null, 2));
  console.log('\n');

  try {
    const result = await createMSG91WhatsAppTemplate(templateData);

    if (result.success) {
      console.log('✅ Template created successfully!');
      console.log(`📋 Template ID: ${result.templateId}`);
      console.log('\n');
      console.log('⏳ Next Steps:');
      console.log('1. Wait for template approval (usually instant for UTILITY templates)');
      console.log('2. Go to MSG91 Dashboard → WhatsApp → Templates');
      console.log('3. Verify template status is "Enabled"');
      console.log('4. Click "Sync Template" if needed');
      console.log('5. Test OTP sending');
      console.log('\n');
      console.log('💡 Note: Template name is "otp_verification"');
      console.log('   Make sure MSG91_WHATSAPP_TEMPLATE_ID_OTP=otp_verification in .env');
    } else {
      console.error('❌ Failed to create template');
      console.error(`Error: ${result.error}`);
      console.log('\n');
      console.log('🔍 Troubleshooting:');
      console.log('1. Check MSG91_AUTH_KEY is set in .env');
      console.log('2. Check MSG91_WHATSAPP_NUMBER is set in .env');
      console.log('3. Verify your WhatsApp number is active in MSG91 dashboard');
      console.log('4. Check MSG91 dashboard for any account restrictions');
    }
  } catch (error) {
    console.error('❌ Error creating template:', error);
    console.error(error.stack);
  }
}

// Run the script
createOTPTemplate();

