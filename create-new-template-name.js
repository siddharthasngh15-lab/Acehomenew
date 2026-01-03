/**
 * Script to create WhatsApp OTP template with a NEW name
 * This works around the deletion-in-progress issue
 * 
 * Run: node create-new-template-name.js
 */

import { createMSG91WhatsAppTemplate } from './server/services/msg91.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function createNewTemplate() {
  console.log('🚀 Creating NEW WhatsApp OTP Template (with different name)...\n');

  // Use a new template name to avoid the deletion conflict
  const newTemplateName = 'otp_ace_home';
  
  console.log(`📝 Using new template name: "${newTemplateName}"`);
  console.log('   This avoids the deletion-in-progress issue.\n');

  // Template data based on official MSG91 API documentation
  const templateData = {
    name: newTemplateName,
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
      console.log('4. Verify category is "UTILITY"');
      console.log('5. Verify language "En" has green checkmark (not red X)');
      console.log('6. Click "Sync Template" if needed');
      console.log('\n');
      console.log('🔧 IMPORTANT: Update your .env file:');
      console.log(`   MSG91_WHATSAPP_TEMPLATE_ID_OTP=${newTemplateName}`);
      console.log('\n');
      console.log('7. Restart backend server');
      console.log('8. Test OTP sending');
      console.log('\n');
      console.log('💡 Note: New template name is "' + newTemplateName + '"');
      console.log('   Make sure to update MSG91_WHATSAPP_TEMPLATE_ID_OTP in .env');
    } else {
      console.error('❌ Failed to create template');
      console.error(`Error: ${result.error}`);
      console.log('\n');
      console.log('🔍 Troubleshooting:');
      console.log('1. Check MSG91_AUTH_KEY is set in .env');
      console.log('2. Check MSG91_WHATSAPP_NUMBER is set in .env');
      console.log('3. Verify your WhatsApp number is active in MSG91 dashboard');
      console.log('4. Check MSG91 dashboard for any account restrictions');
      console.log('5. Try a different template name if this one conflicts');
    }
  } catch (error) {
    console.error('❌ Error creating template:', error);
    console.error(error.stack);
  }
}

// Run the script
createNewTemplate();

