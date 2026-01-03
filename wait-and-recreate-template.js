/**
 * Script to wait for template deletion and then recreate WhatsApp OTP template
 * 
 * Run: node wait-and-recreate-template.js
 */

import { createMSG91WhatsAppTemplate } from './server/services/msg91.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Wait function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitAndRecreateTemplate() {
  console.log('⏳ Waiting for template deletion to complete...\n');
  console.log('MSG91 is processing the deletion. This usually takes 1-2 minutes.\n');

  // Wait 90 seconds (1.5 minutes) for deletion to complete
  const waitTime = 90 * 1000; // 90 seconds in milliseconds
  const waitSeconds = waitTime / 1000;

  console.log(`⏱️  Waiting ${waitSeconds} seconds for deletion to complete...`);
  
  // Show countdown
  for (let i = waitSeconds; i > 0; i--) {
    process.stdout.write(`\r⏱️  Waiting ${i} seconds...`);
    await wait(1000);
  }
  console.log('\n✅ Wait complete!\n');

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

  console.log('🚀 Attempting to create template...\n');
  console.log('📝 Template Configuration:');
  console.log(JSON.stringify(templateData, null, 2));
  console.log('\n');

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`🔄 Attempt ${attempts} of ${maxAttempts}...\n`);

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
        return; // Success, exit
      } else {
        const errorMsg = result.error || 'Unknown error';
        console.error(`❌ Attempt ${attempts} failed: ${errorMsg}\n`);

        // Check if it's a deletion-in-progress error
        if (errorMsg.includes('being deleted') || errorMsg.includes('Try again in less than 1 minute')) {
          if (attempts < maxAttempts) {
            console.log('⏳ Deletion still in progress. Waiting 30 more seconds...\n');
            await wait(30 * 1000); // Wait 30 more seconds
            continue; // Try again
          }
        } else if (errorMsg.includes('already English content')) {
          console.log('⚠️  Template already exists. You may need to delete it in the dashboard first.\n');
          console.log('💡 Go to MSG91 Dashboard → WhatsApp → Templates');
          console.log('   Find "otp_verification", click three dots (⋮) → Delete');
          console.log('   Then run this script again.\n');
          return; // Exit, user needs to delete manually
        } else {
          // Other error, don't retry
          console.error('❌ Failed to create template');
          console.error(`Error: ${errorMsg}`);
          console.log('\n');
          console.log('🔍 Troubleshooting:');
          console.log('1. Check MSG91_AUTH_KEY is set in .env');
          console.log('2. Check MSG91_WHATSAPP_NUMBER is set in .env');
          console.log('3. Verify your WhatsApp number is active in MSG91 dashboard');
          console.log('4. Check MSG91 dashboard for any account restrictions');
          return; // Exit on other errors
        }
      }
    } catch (error) {
      console.error(`❌ Error on attempt ${attempts}:`, error.message);
      if (attempts < maxAttempts) {
        console.log('⏳ Waiting 30 seconds before retry...\n');
        await wait(30 * 1000);
      }
    }
  }

  console.error('\n❌ Failed to create template after all attempts.');
  console.log('\n💡 Manual Steps:');
  console.log('1. Go to MSG91 Dashboard → WhatsApp → Templates');
  console.log('2. Check if "otp_verification" still exists');
  console.log('3. If it exists, delete it manually');
  console.log('4. Wait 2-3 minutes');
  console.log('5. Run this script again or create template in dashboard');
}

// Run the script
waitAndRecreateTemplate();

