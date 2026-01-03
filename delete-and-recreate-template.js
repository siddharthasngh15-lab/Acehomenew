/**
 * Script to delete and recreate WhatsApp OTP template
 * 
 * Note: MSG91 doesn't have a delete API, so you'll need to delete manually in dashboard first.
 * Then run this script to recreate it.
 * 
 * Run: node delete-and-recreate-template.js
 */

import { createMSG91WhatsAppTemplate } from './server/services/msg91.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function recreateTemplate() {
  console.log('🚀 Recreating WhatsApp OTP Template via MSG91 API...\n');

  console.log('⚠️  IMPORTANT:');
  console.log('1. First, delete the existing "otp_verification" template in MSG91 Dashboard');
  console.log('2. Go to: MSG91 Dashboard → WhatsApp → Templates');
  console.log('3. Find "otp_verification", click three dots (⋮) → Delete');
  console.log('4. Then run this script again\n');

  // Check if user wants to proceed
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise((resolve) => {
    rl.question('Have you deleted the template in the dashboard? (yes/no): ', resolve);
  });

  rl.close();

  if (answer.toLowerCase() !== 'yes') {
    console.log('\n❌ Please delete the template in the dashboard first, then run this script again.');
    process.exit(0);
  }

  // Template data based on official MSG91 API documentation
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

  console.log('\n📝 Template Configuration:');
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
      console.log('4. Verify category is "UTILITY"');
      console.log('5. Verify language "En" has green checkmark (not red X)');
      console.log('6. Click "Sync Template" if needed');
      console.log('7. Restart backend server');
      console.log('8. Test OTP sending');
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
      console.log('5. Make sure you deleted the old template in dashboard');
    }
  } catch (error) {
    console.error('❌ Error creating template:', error);
    console.error(error.stack);
  }
}

// Run the script
recreateTemplate();

