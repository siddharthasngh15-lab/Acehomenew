import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the backend directory or root
dotenv.config({ path: join(__dirname, '../../.env') });
dotenv.config({ path: join(__dirname, '../../../.env') });

// Import Profile model (same structure as index.js)
const baseOptions = { timestamps: true };

const ProfileSchema = new mongoose.Schema(
  {
    phone: { type: String, unique: true, required: true },
    full_name: { type: String, required: true },
    email: { type: String },
    role: { type: String, default: 'customer' },
    password_hash: { type: String },
    wallet_balance: { type: Number, default: 0 },
    phone_verified: { type: Boolean, default: false },
    email_verified: { type: Boolean, default: false },
    id_verified: { type: Boolean, default: false },
    background_check_status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    background_check_note: { type: String },
    skills_verified: { type: Boolean, default: false },
    payout_verified: { type: Boolean, default: false },
    verification_docs: [
      {
        doc_type: { type: String },
        url: { type: String },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        note: { type: String },
        uploaded_at: { type: Date, default: Date.now },
      },
    ],
    skills: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    location: { type: String },
    address: { type: String },
    is_available: { type: Boolean, default: true },
    max_capacity: { type: Number, default: 5 },
    current_jobs: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    experience_years: { type: Number, default: 0 },
  },
  baseOptions
);

const Profile = mongoose.model('Profile', ProfileSchema);

const setAdminPassword = async () => {
  try {
    console.log('🔐 Setting password for admin account...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Admin phone number from seed.js
    const adminPhone = '8707615444';
    
    // Default password (you can change this)
    const password = process.argv[2] || 'admin123';
    
    // Find admin profile
    const admin = await Profile.findOne({ phone: adminPhone });
    
    if (!admin) {
      console.log('❌ Admin account not found. Please run seed script first: npm run seed');
      process.exit(1);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Update admin with password and ensure email is verified
    admin.password_hash = password_hash;
    admin.email_verified = true; // Required for password login
    admin.phone_verified = true;
    await admin.save();

    console.log('✅ Admin password set successfully!');
    console.log('\n📋 Admin Credentials:');
    console.log(`   Phone: ${adminPhone}`);
    console.log(`   Email: ${admin.email || 'admin@acehomesolutions.com'}`);
    console.log(`   Password: ${password}`);
    console.log('\n💡 You can now login with these credentials at http://localhost:5173/login');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting admin password:', error);
    process.exit(1);
  }
};

// Run script
setAdminPassword();

