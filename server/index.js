import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { body, param, query, validationResult } from 'express-validator';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { sendOTP, sendNotification, sendBookingStatusUpdate, setNotificationModel } from './services/notifications.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the backend root directory (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();

// When running behind a proxy (e.g., Render, Vercel), trust the proxy so that
// express-rate-limit and other middleware see the correct client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration - Allow requests from Vercel, custom domain, and localhost
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    
    // Allow all Vercel domains
    if (origin.includes('.vercel.app') || origin.includes('vercel.app')) {
      return callback(null, true);
    }
    
    // Allow custom frontend domain
    if (origin === 'https://acehome.rareus.store' || origin.includes('rareus.store')) {
      return callback(null, true);
    }
    
    // Allow acehomesolutions.in domain
    if (origin === 'https://acehomesolutions.in' || 
        origin === 'https://www.acehomesolutions.in' ||
        origin.includes('acehomesolutions.in')) {
      return callback(null, true);
    }
    
    // For development, allow all origins (remove in production if needed)
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
}));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusIcon = res.statusCode >= 400 ? '❌' : res.statusCode >= 300 ? '⚠️' : '✅';
    console.log(`${statusIcon} ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.use(express.json({ limit: '10mb' }));

// Add cache headers for GET requests (except health and analytics)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.includes('/health') && !req.path.includes('/analytics')) {
    res.set('Cache-Control', 'public, max-age=60'); // Cache for 60 seconds
  }
  next();
});

// Define apiBase before using it
const apiBase = '/api';
const adminKey = process.env.ADMIN_KEY || '';

// Initialize Razorpay (only if keys are provided)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log('✅ Razorpay initialized');
} else {
  console.warn('⚠️  Razorpay keys not configured. Payment features will not work.');
}

// Rate limiting
// More lenient in development
const isDevelopment = process.env.NODE_ENV !== 'production';
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 500 : 100, // Much more lenient in development (500), normal in production (100)
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip general limiter for GET requests to profiles (they have their own readLimiter)
    if (req.method === 'GET' && req.path.startsWith('/profiles')) {
      return true;
    }
    return false;
  },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 100 : 10, // Much more lenient in development (100), strict in production (10)
  message: 'Too many requests, please try again later.',
});

// More lenient limiter for OTP endpoints (for development/testing)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 100 : 30, // Very lenient in development (100), stricter in production (30)
  message: 'Too many OTP requests. Please wait a few minutes before requesting again.',
  skipSuccessfulRequests: false, // Count all requests
  standardHeaders: true,
  legacyHeaders: false,
});

// More lenient limiter for GET requests (reading data)
const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: isDevelopment ? 500 : 100, // Much more lenient in development (500), normal in production (100)
  message: 'Too many requests, please try again later.',
  skip: (req) => req.method !== 'GET', // Only apply to GET requests
});

app.use(`${apiBase}/`, apiLimiter);
// Use more lenient limiter for OTP endpoints (must be before general auth limiter)
app.use(`${apiBase}/auth/request-otp`, otpLimiter);
app.use(`${apiBase}/auth/verify-otp`, otpLimiter);
// Use strict limiter for other auth endpoints
app.use(`${apiBase}/auth/`, strictLimiter);
// Apply strict limiter only to POST/PATCH/DELETE bookings, lenient for GET
app.use(`${apiBase}/bookings`, (req, res, next) => {
  if (req.method === 'GET') {
    return readLimiter(req, res, next);
  }
  return strictLimiter(req, res, next);
});
// Apply lenient limiter for profile GET requests (frequently accessed)
app.use(`${apiBase}/profiles`, (req, res, next) => {
  if (req.method === 'GET') {
    return readLimiter(req, res, next);
  }
  return strictLimiter(req, res, next);
});

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array(), error: 'validation_failed' });
  }
  next();
};

// Sanitization helper
const sanitizeInput = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 1000); // Limit length
};

// Environment variable validation
const requiredEnvVars = {
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_KEY: process.env.ADMIN_KEY,
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach((key) => console.error(`   - ${key}`));
  console.error('\nPlease set these in your .env file');
  process.exit(1);
}

const mongoUri = requiredEnvVars.MONGODB_URI;

const baseOptions = { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } };

const ProfileSchema = new mongoose.Schema(
  {
    phone: { type: String, unique: true, required: true },
    full_name: { type: String, required: true },
    email: { type: String },
    // Authentication fields
    password_hash: { type: String },
    email_verified: { type: Boolean, default: false },
    email_verification_token: { type: String },
    email_verification_expires_at: { type: Date },
    // Role & profile meta
    role: { type: String, default: 'customer' },
    wallet_balance: { type: Number, default: 0 },
    phone_verified: { type: Boolean, default: false },
    id_verified: { type: Boolean, default: false },
    background_check_status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    background_check_note: { type: String },
    skills_verified: { type: Boolean, default: false },
    payout_verified: { type: Boolean, default: false },
    verification_docs: [
      {
        doc_type: { type: String }, // e.g., id_proof, address_proof, certificate
        url: { type: String },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        note: { type: String },
        uploaded_at: { type: Date, default: Date.now },
      },
    ],
    // Worker-specific fields
    skills: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }], // Services they can perform
    other_skills: { type: String }, // Additional skills not in the services list
    location: { type: String }, // Worker's base location/pincode
    address: { type: String }, // Legacy full address
    is_available: { type: Boolean, default: true }, // Availability status
    max_capacity: { type: Number, default: 5 }, // Max concurrent jobs
    current_jobs: { type: Number, default: 0 }, // Current active jobs count
    rating: { type: Number, default: 0 }, // Worker rating
    experience_years: { type: Number, default: 0 }, // Years of experience
    // Technician onboarding workflow
    approval_status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    city: { type: String },
    application_message: { type: String },
    // KYC and extended details
    aadhaar_number: { type: String },
    aadhaar_image_url: { type: String },
    full_address: { type: String },
    alternate_phone: { type: String },
    service_areas: { type: String }, // comma-separated or free text
    preferred_work_hours: { type: String },
    bank_details: { type: String }, // free-text bank info
  },
  baseOptions
);

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, unique: true, required: true },
    description: { type: String },
    icon: { type: String },
    is_active: { type: Boolean, default: true },
    is_popular: { type: Boolean, default: false },
    sort_order: { type: Number, default: 0 },
  },
  baseOptions
);

const ServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, unique: true, required: true },
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    description: { type: String },
    base_price: { type: Number, default: 0 },
    average_rating: { type: Number, default: 0 },
    review_count: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    faqs: [{ question: String, answer: String }],
    image_url: { type: String },
    subcategory: { type: String },
  },
  baseOptions
);

const ServiceAddonSchema = new mongoose.Schema(
  {
    service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    name: String,
    description: String,
    price: Number,
    is_active: { type: Boolean, default: true },
  },
  baseOptions
);

const ReviewSchema = new mongoose.Schema(
  {
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }, // Worker rating
    booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }, // Link to booking
    rating: { type: Number, required: true, min: 1, max: 5 },
    worker_rating: { type: Number, min: 1, max: 5 }, // Separate worker rating
    comment: String,
    images: [{ type: String }], // Review photos
    is_verified: { type: Boolean, default: true },
  },
  baseOptions
);

const BookingSchema = new mongoose.Schema(
  {
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }, // Assigned worker
    status: { type: String, default: 'pending' }, // pending, assigned, accepted, reached, in_progress, completed, cancelled
    booking_date: { type: Date },
    booking_time: { type: String },
    total_price: { type: Number, default: 0 },
    // Store pricing breakdown so invoices and reports can use exact values
    base_price: { type: Number, default: 0 },
    addon_price: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    platform_fee: { type: Number, default: 0 },
    wallet_amount: { type: Number, default: 0 }, // Amount paid from wallet
    payment_status: { type: String, default: 'unpaid' },
    payment_method: { type: String, enum: ['online', 'cod', 'wallet'], default: 'online' },
    customer_address: { type: Object },
    customer_phone: { type: String },
    customer_name: { type: String },
    customer_pincode: { type: String }, // For serviceability check
    addons: [{ addon_id: String, quantity: Number }],
    notes: String,
    special_instructions: { type: String },
    assigned_at: { type: Date }, // When admin assigned to worker
    accepted_at: { type: Date }, // When employee accepted the job
    reached_at: { type: Date }, // When employee reached the location
    started_at: { type: Date }, // When employee started working
    completed_at: { type: Date },
    cancelled_at: { type: Date },
    cancellation_reason: { type: String },
    cancelled_by: { type: String, enum: ['customer', 'admin', 'worker'] },
    partner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }, // Partner/helper employee
    before_photos: [{ type: String }], // Before work photos
    after_photos: [{ type: String }], // After work photos
    job_photos: [{ type: String }], // Legacy field - kept for backward compatibility
    is_deleted: { type: Boolean, default: false }, // Soft delete flag
    deleted_at: { type: Date }, // When booking was deleted
    deleted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }, // Who deleted the booking
  },
  baseOptions
);

const PromoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, required: true },
    discount_type: { type: String, enum: ['percentage', 'flat'], default: 'flat' },
    discount_value: { type: Number, default: 0, required: true },
    max_discount: { type: Number },
    min_order_value: { type: Number, default: 0 },
    valid_from: { type: Date },
    valid_until: { type: Date },
    is_active: { type: Boolean, default: true },
    usage_count: { type: Number, default: 0 },
    max_usage: { type: Number },
  },
  baseOptions
);

const NotifyMeSchema = new mongoose.Schema(
  {
    service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    customer_name: String,
    customer_phone: String,
    customer_email: String,
    pincode: String,
  },
  baseOptions
);

const SlotSchema = new mongoose.Schema(
  {
    service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    date: { type: Date, required: true },
    time_slot: { type: String, required: true }, // e.g., "09:00-12:00", "12:00-15:00", "15:00-18:00"
    total_capacity: { type: Number, default: 1 }, // Max bookings for this slot
    booked_count: { type: Number, default: 0 }, // Current bookings
    is_available: { type: Boolean, default: true },
  },
  baseOptions
);

const NotificationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    type: { type: String, enum: ['email', 'sms', 'whatsapp', 'push'], required: true },
    subject: { type: String },
    message: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    metadata: { type: Object },
  },
  baseOptions
);

const WalletTransactionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    amount: { type: Number, required: true },
    transaction_type: { type: String, enum: ['credit', 'debit', 'refund'], required: true },
    description: { type: String, required: true },
    booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  },
  baseOptions
);

// Serviceability configuration - now uses database
// Legacy hardcoded values for fallback
const DEFAULT_SERVICEABLE_CITY = 'Gorakhpur';
const DEFAULT_SERVICEABLE_PINCODES = ['273001', '273002', '273003', '273004', '273005'];

// Check if pincode is serviceable using database
const isServiceable = async (pincode) => {
  if (!pincode) return false;
  const trimmedPincode = pincode.toString().trim();
  
  try {
    // Check database for active serviceability areas
    const areas = await ServiceabilityArea.find({ is_active: true });
    for (const area of areas) {
      if (area.pincodes && area.pincodes.includes(trimmedPincode)) {
        return true;
      }
    }
    // Fallback to default if no areas found in database
    if (areas.length === 0) {
      return DEFAULT_SERVICEABLE_PINCODES.includes(trimmedPincode);
    }
    return false;
  } catch (error) {
    console.error('Error checking serviceability:', error);
    // Fallback to default on error
    return DEFAULT_SERVICEABLE_PINCODES.includes(trimmedPincode);
  }
};

// OTP Schema for phone/email verification
const OTPSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    code_hash: { type: String, required: true },
    purpose: { type: String, default: 'login' },
    expires_at: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    last_sent_at: { type: Date, default: Date.now },
  },
  baseOptions
);

// Serviceability Area Schema
const ServiceabilityAreaSchema = new mongoose.Schema(
  {
    city: { type: String, required: true, unique: true },
    pincodes: [{ type: String, required: true }],
    is_active: { type: Boolean, default: true },
  },
  baseOptions
);

const Profile = mongoose.model('Profile', ProfileSchema);
const Category = mongoose.model('Category', CategorySchema);
const Service = mongoose.model('Service', ServiceSchema);
const ServiceAddon = mongoose.model('ServiceAddon', ServiceAddonSchema);
const Review = mongoose.model('Review', ReviewSchema);
const Booking = mongoose.model('Booking', BookingSchema);
const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);
const NotifyMe = mongoose.model('NotifyMe', NotifyMeSchema);
const Slot = mongoose.model('Slot', SlotSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const OTP = mongoose.model('OTP', OTPSchema);
const ServiceabilityArea = mongoose.model('ServiceabilityArea', ServiceabilityAreaSchema);
const WalletTransaction = mongoose.model('WalletTransaction', WalletTransactionSchema);

// Set Notification model in notification service
setNotificationModel(Notification);

// Create database indexes for performance
const createIndexes = async () => {
  try {
    // Profile indexes
    await Profile.collection.createIndex({ phone: 1 }, { unique: true });
    await Profile.collection.createIndex({ role: 1 });
    await Profile.collection.createIndex({ is_available: 1 });
    await Profile.collection.createIndex({ location: 1 });
    await Profile.collection.createIndex({ skills: 1 });
    await Profile.collection.createIndex({ phone_verified: 1 });
    await Profile.collection.createIndex({ background_check_status: 1 });
    
    // Category indexes
    await Category.collection.createIndex({ slug: 1 }, { unique: true });
    await Category.collection.createIndex({ is_active: 1 });
    await Category.collection.createIndex({ sort_order: 1 });
    
    // Service indexes
    await Service.collection.createIndex({ slug: 1 }, { unique: true });
    await Service.collection.createIndex({ category_id: 1 });
    await Service.collection.createIndex({ is_active: 1 });
    await Service.collection.createIndex({ name: 'text', description: 'text' }); // Text search
    
    // ServiceAddon indexes
    await ServiceAddon.collection.createIndex({ service_id: 1 });
    await ServiceAddon.collection.createIndex({ is_active: 1 });
    
    // Booking indexes
    await Booking.collection.createIndex({ customer_id: 1 });
    await Booking.collection.createIndex({ employee_id: 1 });
    await Booking.collection.createIndex({ service_id: 1 });
    await Booking.collection.createIndex({ status: 1 });
    await Booking.collection.createIndex({ booking_date: 1 });
    await Booking.collection.createIndex({ customer_pincode: 1 });
    await Booking.collection.createIndex({ created_at: -1 }); // For recent bookings
    
    // Review indexes
    await Review.collection.createIndex({ service_id: 1 });
    await Review.collection.createIndex({ customer_id: 1 });
    await Review.collection.createIndex({ employee_id: 1 });
    await Review.collection.createIndex({ booking_id: 1 });
    await Review.collection.createIndex({ is_verified: 1 });
    
    // PromoCode indexes
    await PromoCode.collection.createIndex({ code: 1 }, { unique: true });
    await PromoCode.collection.createIndex({ is_active: 1 });
    await PromoCode.collection.createIndex({ valid_until: 1 });
    
    // NotifyMe indexes
    await NotifyMe.collection.createIndex({ service_id: 1 });
    await NotifyMe.collection.createIndex({ pincode: 1 });

    // OTP indexes (expire documents when past expires_at)
    await OTP.collection.createIndex({ phone: 1 });
    await OTP.collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
    
    // Slot indexes
    await Slot.collection.createIndex({ service_id: 1, date: 1, time_slot: 1 });
    await Slot.collection.createIndex({ date: 1 });
    await Slot.collection.createIndex({ is_available: 1 });
    
    console.log('✅ Database indexes created successfully');
  } catch (err) {
    console.error('⚠️  Error creating indexes (may already exist):', err.message);
  }
};

// Connect to MongoDB after models are defined
mongoose
  .connect(mongoUri)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log(`📦 Database: ${mongoose.connection.db.databaseName}`);
    // Create indexes after connection
    await createIndexes();
  })
  .catch((err) => {
    console.error('❌ Mongo connection error', err);
    process.exit(1);
  });

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err);
});

const requireAdmin = (req, res, next) => {
  if (!adminKey) return res.status(500).json({ error: 'admin_key_not_configured' });
  const provided = req.headers['x-admin-key'];
  if (provided !== adminKey) return res.status(401).json({ error: 'unauthorized' });
  next();
};

// Root route - API information
app.get('/', (_req, res) => {
  res.json({
    message: 'ACE Home Solutions API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      api: '/api',
      documentation: 'See API_GUIDE.md for full API documentation',
    },
    timestamp: new Date().toISOString(),
  });
});

// API base route
app.get(`${apiBase}`, (_req, res) => {
  res.json({
    message: 'ACE Home Solutions API',
    version: '1.0.0',
    status: 'ok',
    endpoints: {
      health: `${apiBase}/health`,
      auth: `${apiBase}/auth`,
      categories: `${apiBase}/categories`,
      services: `${apiBase}/services`,
      bookings: `${apiBase}/bookings`,
      profiles: `${apiBase}/profiles`,
      reviews: `${apiBase}/reviews`,
      payments: `${apiBase}/payments`,
      notifications: `${apiBase}/notifications`,
      analytics: `${apiBase}/analytics`,
    },
    timestamp: new Date().toISOString(),
  });
});

// Enhanced health check endpoint
app.get(`${apiBase}/health`, async (_req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const razorpayStatus = process.env.RAZORPAY_KEY_ID ? 'configured' : 'not_configured';
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      razorpay: razorpayStatus,
      version: '1.0.0',
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Demo auth: creates/fetches profile by phone
app.post(
  `${apiBase}/auth/demo-login`,
  [
    body('phone').trim().isMobilePhone('en-IN').withMessage('Invalid phone number'),
    body('full_name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('email').optional().trim().isEmail().withMessage('Invalid email'),
  ],
  validate,
  async (req, res) => {
    try {
      const { phone, full_name, email } = req.body;
      const sanitizedPhone = sanitizeInput(phone);
      const sanitizedName = full_name ? sanitizeInput(full_name) : undefined;
      const sanitizedEmail = email ? sanitizeInput(email) : undefined;

      let profile = await Profile.findOne({ phone: sanitizedPhone });
      if (!profile && sanitizedName) {
        profile = await Profile.create({ phone: sanitizedPhone, full_name: sanitizedName, email: sanitizedEmail });
      }

      if (!profile) return res.status(404).json({ error: 'Profile not found; send details to create' });
      res.json({ user: { id: profile._id.toString(), phone: sanitizedPhone }, profile });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'auth_error' });
    }
  }
);

// Helpers for password-based auth
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

const verifyPassword = async (password, hash) => {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
};

const generateEmailVerificationToken = () => crypto.randomBytes(32).toString('hex');

// Email transport (uses SMTP env vars)
const createEmailTransport = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('📧 SMTP not fully configured. Emails will not be sent.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
};

// Generic email sender
const sendEmail = async ({ to, subject, html }) => {
  const transport = createEmailTransport();
  if (!transport) {
    console.warn('📧 SMTP not configured, skipping email to', to);
    return;
  }

  const from = process.env.SMTP_FROM || `ACE Home <${process.env.SMTP_USER}>`;

  try {
    await transport.sendMail({ from, to, subject, html });
    console.log(`📧 Email sent to ${to}`);
  } catch (err) {
    console.error('📧 Error sending email:', err.message);
  }
};

const sendVerificationEmail = async (profile) => {
  const transport = createEmailTransport();
  if (!transport || !profile.email || !profile.email_verification_token) return;

  const backendBase = process.env.BACKEND_PUBLIC_URL || 'https://acehome-backend.onrender.com';
  const verifyUrl = `${backendBase}/api/auth/verify-email?token=${profile.email_verification_token}&id=${profile._id.toString()}`;

  const from = process.env.SMTP_FROM || `ACE Home <${process.env.SMTP_USER}>`;

  const mailOptions = {
    from,
    to: profile.email,
    subject: 'Verify your email for ACE Home',
    html: `
      <p>Hi ${profile.full_name || 'there'},</p>
      <p>Thank you for registering with <strong>ACE Home</strong>.</p>
      <p>Please verify your email by clicking the link below:</p>
      <p><a href="${verifyUrl}" target="_blank" rel="noopener noreferrer">Verify Email</a></p>
      <p>If the button doesn't work, copy and paste this link in your browser:</p>
      <p>${verifyUrl}</p>
      <p>This link will expire in 24 hours.</p>
      <p>– ACE Home Team</p>
    `,
  };

  try {
    await transport.sendMail(mailOptions);
    console.log(`📧 Verification email sent to ${profile.email}`);
  } catch (err) {
    console.error('📧 Error sending verification email:', err.message);
  }
};

// Register with email, phone, password and send verification email
app.post(
  `${apiBase}/auth/register`,
  [
    body('full_name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('phone').trim().isMobilePhone('en-IN').withMessage('Valid phone number is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  async (req, res) => {
    try {
      const full_name = sanitizeInput(req.body.full_name);
      const email = sanitizeInput(req.body.email.toLowerCase());
      const phone = sanitizeInput(req.body.phone);
      const password = req.body.password;

      let profile = await Profile.findOne({ $or: [{ phone }, { email }] });

      const password_hash = await hashPassword(password);
      const email_verification_token = generateEmailVerificationToken();
      const email_verification_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      if (!profile) {
        // No existing profile: create a new customer account
        // Phone is verified via OTP before registration, so mark it as verified
        profile = await Profile.create({
          phone,
          full_name,
          email,
          role: 'customer',
          password_hash,
          phone_verified: true, // Phone verified via OTP before registration
          email_verified: false,
          email_verification_token,
          email_verification_expires_at,
        });
      } else if (!profile.password_hash) {
        // Existing profile with NO password yet (e.g., created from technician application or OTP):
        // allow setting the first password.
        profile.full_name = full_name || profile.full_name;
        profile.email = email || profile.email;
        profile.password_hash = password_hash;
        profile.phone_verified = true; // Phone verified via OTP before registration
        profile.email_verified = false;
        profile.email_verification_token = email_verification_token;
        profile.email_verification_expires_at = email_verification_expires_at;
        await profile.save();
      } else {
        // Profile already has a password -> do NOT overwrite it for security
        return res.status(400).json({
          error: 'account_exists',
          message: 'Account already exists. Please log in.',
        });
      }

      // Send verification email (if SMTP is configured)
      await sendVerificationEmail(profile);

      return res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account before logging in.',
      });
    } catch (err) {
      console.error('register error:', err);
      return res.status(500).json({ error: 'registration_failed', message: 'Failed to register account' });
    }
  }
);

// Technician application - public endpoint
app.post(
  `${apiBase}/technicians/apply`,
  [
    body('full_name').trim().isLength({ min: 2 }).withMessage('Full name is required'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        full_name,
        email,
        phone,
        role,
        skills,
        other_skills,
        location,
        address_street,
        address_city,
        address_state,
        address_pincode,
        experience_years,
        max_capacity,
        age,
        date_of_birth,
        gender,
        aadhaar_number,
        aadhaar_image_url,
        bank_account_name,
        bank_account_number,
        bank_ifsc,
        bank_name,
        bank_account_type,
        bank_other,
        application_message,
      } = req.body;

      // Combine address fields
      const addressParts = [address_street, address_city, address_state, address_pincode].filter(Boolean);
      const fullAddress = addressParts.join(', ');

      // Format bank details
      const bankDetailsParts = [
        bank_account_name && `Account Holder: ${bank_account_name}`,
        bank_account_number && `Account Number: ${bank_account_number}`,
        bank_ifsc && `IFSC: ${bank_ifsc}`,
        bank_name && `Bank: ${bank_name}`,
        bank_account_type && `Type: ${bank_account_type}`,
        bank_other && `Notes: ${bank_other}`,
      ].filter(Boolean);
      const bankDetailsFormatted = bankDetailsParts.join('\n');

      // Get service names if skills are provided
      let skillsText = 'All services';
      if (skills && Array.isArray(skills) && skills.length > 0) {
        const serviceDocs = await Service.find({ _id: { $in: skills } }).select('name');
        skillsText = serviceDocs.map(s => s.name).join(', ');
      }

      // Check if profile already exists with this phone number
      const existingProfile = await Profile.findOne({ phone: sanitizeInput(phone) });
      if (existingProfile) {
        console.log(`[Worker Application] Found existing profile for phone ${phone}, updating to worker with pending status`);
        // If profile exists, update it to worker role with pending status
        // BUT: If the profile is already approved as employee/worker, don't change their approval status
        // Only set to pending if they're not already approved
        const currentRole = existingProfile.role;
        const currentApprovalStatus = existingProfile.approval_status;
        const requestedRole = role || 'worker';
        
        // If already approved as employee/worker, preserve their approval status and role
        if ((currentRole === 'employee' || currentRole === 'worker') && 
            (currentApprovalStatus === 'approved' || currentApprovalStatus === undefined || currentApprovalStatus === null)) {
          console.log(`[Worker Application] Profile already approved as ${currentRole}, preserving approval status and role`);
          existingProfile.role = currentRole; // Keep existing role
          // Don't change approval_status - keep it as 'approved' or undefined
          // This prevents approved employees from disappearing when someone else applies with the same phone
        } else {
          // New application or rejected/pending - ALWAYS update to worker role and set to pending
          // CRITICAL: Even if they're currently a customer, set role to 'worker' when they apply as technician
          existingProfile.role = 'worker'; // Always set to 'worker' for technician applications
          existingProfile.approval_status = 'pending';
          console.log(`[Worker Application] Updated existing profile from role '${currentRole}' to 'worker' with pending status`);
        }
        existingProfile.full_name = sanitizeInput(full_name);
        existingProfile.email = sanitizeInput(email.toLowerCase());
        existingProfile.skills = skills && Array.isArray(skills) ? skills : [];
        existingProfile.other_skills = other_skills ? sanitizeInput(other_skills) : undefined;
        existingProfile.location = location ? sanitizeInput(location) : undefined;
        existingProfile.address_street = address_street ? sanitizeInput(address_street) : undefined;
        existingProfile.address_city = address_city ? sanitizeInput(address_city) : undefined;
        existingProfile.address_state = address_state ? sanitizeInput(address_state) : undefined;
        existingProfile.address_pincode = address_pincode ? sanitizeInput(address_pincode) : undefined;
        existingProfile.address = fullAddress || undefined;
        existingProfile.experience_years = experience_years ? Number(experience_years) : 0;
        existingProfile.max_capacity = max_capacity ? Number(max_capacity) : 5;
        existingProfile.age = age ? Number(age) : undefined;
        existingProfile.date_of_birth = date_of_birth || undefined;
        existingProfile.gender = gender || undefined;
        existingProfile.is_available = false;
        existingProfile.application_message = application_message ? sanitizeInput(application_message) : undefined;
        existingProfile.aadhaar_number = aadhaar_number ? sanitizeInput(aadhaar_number) : undefined;
        existingProfile.aadhaar_image_url = aadhaar_image_url ? sanitizeInput(aadhaar_image_url) : undefined;
        existingProfile.bank_details = bankDetailsFormatted || undefined;
        existingProfile.bank_account_name = bank_account_name ? sanitizeInput(bank_account_name) : undefined;
        existingProfile.bank_account_number = bank_account_number ? sanitizeInput(bank_account_number) : undefined;
        existingProfile.bank_ifsc = bank_ifsc ? sanitizeInput(bank_ifsc) : undefined;
        existingProfile.bank_name = bank_name ? sanitizeInput(bank_name) : undefined;
        existingProfile.bank_account_type = bank_account_type || undefined;
        existingProfile.bank_other = bank_other ? sanitizeInput(bank_other) : undefined;
        await existingProfile.save();
        var profile = existingProfile;
      } else {
        // Create new profile
        var profile = await Profile.create({
        full_name: sanitizeInput(full_name),
        email: sanitizeInput(email.toLowerCase()),
        phone: sanitizeInput(phone),
        role: role || 'worker',
        skills: skills && Array.isArray(skills) ? skills : [],
        other_skills: other_skills ? sanitizeInput(other_skills) : undefined,
        location: location ? sanitizeInput(location) : undefined,
        address_street: address_street ? sanitizeInput(address_street) : undefined,
        address_city: address_city ? sanitizeInput(address_city) : undefined,
        address_state: address_state ? sanitizeInput(address_state) : undefined,
        address_pincode: address_pincode ? sanitizeInput(address_pincode) : undefined,
        address: fullAddress || undefined,
        experience_years: experience_years ? Number(experience_years) : 0,
        max_capacity: max_capacity ? Number(max_capacity) : 5,
        age: age ? Number(age) : undefined,
        date_of_birth: date_of_birth || undefined,
        gender: gender || undefined,
        is_available: false,
        approval_status: 'pending',
        application_message: application_message ? sanitizeInput(application_message) : undefined,
        aadhaar_number: aadhaar_number ? sanitizeInput(aadhaar_number) : undefined,
        aadhaar_image_url: aadhaar_image_url ? sanitizeInput(aadhaar_image_url) : undefined,
        bank_details: bankDetailsFormatted || undefined,
        bank_account_name: bank_account_name ? sanitizeInput(bank_account_name) : undefined,
        bank_account_number: bank_account_number ? sanitizeInput(bank_account_number) : undefined,
        bank_ifsc: bank_ifsc ? sanitizeInput(bank_ifsc) : undefined,
        bank_name: bank_name ? sanitizeInput(bank_name) : undefined,
        bank_account_type: bank_account_type || undefined,
        bank_other: bank_other ? sanitizeInput(bank_other) : undefined,
      });
      }

      console.log(`[Worker Application] Created/Updated profile with ID: ${profile._id}, Role: ${profile.role}, Approval Status: ${profile.approval_status}`);

      // Send email notification to admin
      if (process.env.ADMIN_EMAIL) {
        await sendEmail({
          to: process.env.ADMIN_EMAIL,
          subject: `New Worker Application: ${profile.full_name}`,
          html: `
            <h2>New Worker/Employee Application</h2>
            <h3>Basic Information</h3>
            <p><strong>Name:</strong> ${profile.full_name}</p>
            <p><strong>Email:</strong> ${profile.email}</p>
            <p><strong>Phone:</strong> ${profile.phone}</p>
            <p><strong>Role:</strong> ${profile.role || 'worker'}</p>
            <p><strong>Age:</strong> ${age || '-'}</p>
            <p><strong>Date of Birth:</strong> ${date_of_birth || '-'}</p>
            <p><strong>Gender:</strong> ${gender || '-'}</p>
            
            <h3>Location & Address</h3>
            <p><strong>Location/Pincode:</strong> ${location || '-'}</p>
            <p><strong>Address:</strong> ${fullAddress || '-'}</p>
            
            <h3>Work Details</h3>
            <p><strong>Skills/Services:</strong> ${skillsText}</p>
            <p><strong>Experience:</strong> ${experience_years || 0} years</p>
            <p><strong>Max Capacity:</strong> ${max_capacity || 5} concurrent jobs</p>
            
            <h3>Aadhaar Details</h3>
            <p><strong>Aadhaar Number:</strong> ${aadhaar_number || '-'}</p>
            <p><strong>Aadhaar Image:</strong> ${aadhaar_image_url ? `<a href="${aadhaar_image_url}">View Image</a>` : '-'}</p>
            
            <h3>Bank Details</h3>
            <pre style="white-space: pre-wrap;">${bankDetailsFormatted || '-'}</pre>
            
            <h3>Additional Information</h3>
            <p>${application_message || '-'}</p>
            
            <hr>
            <p><strong>Application ID:</strong> ${profile._id}</p>
            <p>Please review this application in the admin panel.</p>
          `,
        });
      }

      // Send WhatsApp notification to applicant
      if (phone) {
        await sendNotification({
          to: phone,
          type: 'whatsapp',
          message: `Hello! ${full_name}\n\nThank you! We have received your application to join ACE Home Solutions as a technician. Our admin team will review your application and contact you within 24-48 hours. Application ID: ${profile._id.toString().slice(-8).toUpperCase()}\n\nThank you for choosing ACE Home Solutions!`,
          userId: profile._id,
          metadata: { 
            type: 'technician_application',
            application_id: profile._id.toString()
          },
        });
      }

      // Send confirmation email to applicant (optional - only if email provider configured)
      if (email && process.env.EMAIL_PROVIDER) {
        await sendEmail({
          to: email,
          subject: 'Application Received - ACE Home Solutions',
          html: `
            <h2>Thank You for Your Application!</h2>
            <p>Dear ${full_name},</p>
            <p>We have received your application to join ACE Home Solutions as a worker/employee.</p>
            <p>Our admin team will review your application and contact you via email within 24-48 hours.</p>
            <p>If you have any questions, please contact us at ${process.env.ADMIN_EMAIL || 'support@acehomesolutions.com'}.</p>
            <br>
            <p>Best regards,<br>ACE Home Solutions Team</p>
          `,
        });
      }

      return res.json({
        success: true,
        message: 'Application submitted successfully.',
      });
    } catch (err) {
      console.error('technicians/apply error:', err);
      return res.status(500).json({ error: 'application_failed', message: 'Failed to submit application' });
    }
  }
);

// Admin: create technician directly (approved)
app.post(`${apiBase}/admin/technicians`, requireAdmin, async (req, res) => {
  try {
    const {
      full_name,
      email,
      phone,
      city,
      experience_years,
      skills,
      message,
      aadhaar_number,
      aadhaar_image_url,
      full_address,
      alternate_phone,
      service_areas,
      preferred_work_hours,
      bank_details,
    } = req.body;

    if (!full_name || !phone || !email) {
      return res.status(400).json({ error: 'validation_failed', message: 'Name, email and phone are required' });
    }

    const existing = await Profile.findOne({ phone });
    let profile;

    if (existing) {
      profile = existing;
      profile.full_name = sanitizeInput(full_name);
      profile.email = sanitizeInput(email.toLowerCase());
      profile.location = city ? sanitizeInput(city) : profile.location;
      profile.experience_years = experience_years ? Number(experience_years) : profile.experience_years;
      profile.role = 'employee';
      profile.is_available = true;
      profile.approval_status = 'approved';
      profile.application_message = message ? sanitizeInput(message) : profile.application_message;
      profile.aadhaar_number = aadhaar_number ? sanitizeInput(aadhaar_number) : profile.aadhaar_number;
      profile.aadhaar_image_url = aadhaar_image_url ? sanitizeInput(aadhaar_image_url) : profile.aadhaar_image_url;
      profile.full_address = full_address ? sanitizeInput(full_address) : profile.full_address;
      profile.address = full_address ? sanitizeInput(full_address) : profile.address;
      profile.alternate_phone = alternate_phone ? sanitizeInput(alternate_phone) : profile.alternate_phone;
      profile.service_areas = service_areas ? sanitizeInput(service_areas) : profile.service_areas;
      profile.preferred_work_hours = preferred_work_hours ? sanitizeInput(preferred_work_hours) : profile.preferred_work_hours;
      profile.bank_details = bank_details ? sanitizeInput(bank_details) : profile.bank_details;
      await profile.save();
    } else {
      profile = await Profile.create({
        full_name: sanitizeInput(full_name),
        email: sanitizeInput(email.toLowerCase()),
        phone: sanitizeInput(phone),
        location: city ? sanitizeInput(city) : undefined,
        experience_years: experience_years ? Number(experience_years) : 0,
        role: 'employee',
        is_available: true,
        approval_status: 'approved',
        application_message: message ? sanitizeInput(message) : undefined,
        aadhaar_number: aadhaar_number ? sanitizeInput(aadhaar_number) : undefined,
        aadhaar_image_url: aadhaar_image_url ? sanitizeInput(aadhaar_image_url) : undefined,
        full_address: full_address ? sanitizeInput(full_address) : undefined,
        address: full_address ? sanitizeInput(full_address) : undefined,
        alternate_phone: alternate_phone ? sanitizeInput(alternate_phone) : undefined,
        service_areas: service_areas ? sanitizeInput(service_areas) : undefined,
        preferred_work_hours: preferred_work_hours ? sanitizeInput(preferred_work_hours) : undefined,
        bank_details: bank_details ? sanitizeInput(bank_details) : undefined,
      });
    }

    if (profile.email) {
      await sendEmail({
        to: profile.email,
        subject: 'Welcome to ACE Home as a technician',
        html: `
          <p>Hi ${profile.full_name || 'there'},</p>
          <p>You have been registered as a technician with <strong>ACE Home Solutions</strong>.</p>
          <p>Your account is approved and active. You can now log in and start working with us.</p>
          <p>– ACE Home Team</p>
        `,
      });
    }

    return res.json({ success: true, profile });
  } catch (err) {
    console.error('admin create technician error:', err);
    return res.status(500).json({ error: 'create_technician_failed', message: 'Failed to create technician' });
  }
});

// Login with email or phone + password (requires email verification)
app.post(
  `${apiBase}/auth/login`,
  [
    body('identifier').trim().notEmpty().withMessage('Email or phone is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  async (req, res) => {
    try {
      const identifierRaw = sanitizeInput(req.body.identifier);
      const password = req.body.password;

      const isEmail = identifierRaw.includes('@');
      const query = isEmail ? { email: identifierRaw.toLowerCase() } : { phone: identifierRaw };
      const profile = await Profile.findOne(query);

      if (!profile || !profile.password_hash) {
        return res.status(400).json({ error: 'invalid_credentials', message: 'Invalid email/phone or password' });
      }

      const ok = await verifyPassword(password, profile.password_hash);
      if (!ok) {
        return res.status(400).json({ error: 'invalid_credentials', message: 'Invalid email/phone or password' });
      }

      // Email verification requirement disabled so employees/technicians can log in
      // even if SMTP/email verification is not configured.

      return res.json({
        user: {
          id: profile._id.toString(),
          phone: profile.phone,
          email: profile.email,
        },
        profile,
      });
    } catch (err) {
      console.error('login error:', err);
      return res.status(500).json({ error: 'login_failed', message: 'Failed to log in' });
    }
  }
);

// Admin: reset a user's password (protected by admin key)
app.post(`${apiBase}/admin/profiles/:id/reset-password`, requireAdmin, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'invalid_password', message: 'Password must be at least 6 characters.' });
    }

    const profile = await Profile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: 'not_found', message: 'Profile not found.' });
    }

    profile.password_hash = await hashPassword(new_password);
    // Optionally mark email as verified when admin sets password
    profile.email_verified = true;
    await profile.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('reset-password error:', err);
    return res.status(500).json({ error: 'reset_password_failed', message: 'Failed to reset password.' });
  }
});

// Verify email token (via link)
app.get(`${apiBase}/auth/verify-email`, async (req, res) => {
  try {
    const { token, id } = req.query;
    if (!token || !id) {
      return res.status(400).send('<h2>Invalid verification link</h2>');
    }

    const profile = await Profile.findOne({
      _id: id,
      email_verification_token: token,
      email_verification_expires_at: { $gt: new Date() },
    });

    if (!profile) {
      return res.status(400).send('<h2>Verification link is invalid or has expired.</h2>');
    }

    profile.email_verified = true;
    profile.email_verification_token = undefined;
    profile.email_verification_expires_at = undefined;
    await profile.save();

    return res.send('<h2>Thank you! Your email has been verified. You can now log in.</h2>');
  } catch (err) {
    console.error('verify-email error:', err);
    return res.status(500).send('<h2>Failed to verify email. Please try again later.</h2>');
  }
});

// Admin: list pending technician applications
app.get(`${apiBase}/admin/technicians/pending`, requireAdmin, async (_req, res) => {
  try {
    // Find profiles with pending approval_status
    // Include profiles with:
    // 1. role 'worker' or 'employee' AND approval_status 'pending', OR
    // 2. approval_status 'pending' (regardless of role - for new applicants who haven't been assigned role yet)
    // This ensures all pending technician applications are shown, even if role hasn't been updated yet
    const technicians = await Profile.find({
      $or: [
        {
          role: { $in: ['employee', 'worker'] },
          approval_status: 'pending',
        },
        {
          approval_status: 'pending',
          // Exclude regular customers who haven't applied (they shouldn't have approval_status set)
          role: { $ne: 'customer' },
        },
        {
          // Also include profiles with pending status even if role is null/undefined (new applicants)
          approval_status: 'pending',
          $or: [
            { role: { $exists: false } },
            { role: null },
          ],
        },
      ],
    }).sort({ created_at: -1 });

    console.log(`[Pending Technicians] Found ${technicians.length} pending applications`);
    res.json(technicians);
  } catch (err) {
    console.error('get pending technicians error:', err);
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to load pending technicians' });
  }
});

// Admin: approve technician
app.post(`${apiBase}/admin/technicians/:id/approve`, requireAdmin, async (req, res) => {
  try {
    const profile = await Profile.findById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not_found' });

    console.log(`[Approve Technician] Before approval - ID: ${profile._id}, Role: ${profile.role}, Approval Status: ${profile.approval_status}`);
    
    // If this profile applied as a worker/technician, automatically convert to employee on approval
    // This ensures they immediately appear in the Employees section and are eligible for assignment
    if (!profile.role || profile.role === 'worker') {
      profile.role = 'employee';
      console.log(`[Approve Technician] Role auto-updated from '${profile.role || 'undefined'}' to 'employee' on approval`);
    }

    profile.approval_status = 'approved';
    profile.is_available = true;
    await profile.save();
    
    console.log(`[Approve Technician] After approval - ID: ${profile._id}, Role: ${profile.role}, Approval Status: ${profile.approval_status}`);
    
    // Verify the save worked
    const verifyProfile = await Profile.findById(req.params.id);
    console.log(`[Approve Technician] Verification - ID: ${verifyProfile._id}, Role: ${verifyProfile.role}, Approval Status: ${verifyProfile.approval_status}`);

    if (profile.email) {
      await sendEmail({
        to: profile.email,
        subject: 'Congratulations! Your Application Has Been Approved - ACE Home Solutions',
        html: `
          <h2>Congratulations!</h2>
          <p>Hi ${profile.full_name || 'there'},</p>
          <p>We are pleased to inform you that your application to join <strong>ACE Home Solutions</strong> as a worker/employee has been <strong>approved</strong>!</p>
          <p>You can now log in to your account and start accepting jobs.</p>
          <p><strong>Next Steps:</strong></p>
          <ul>
            <li>Log in to your account using your phone number</li>
            <li>Complete your profile if needed</li>
            <li>Start accepting job assignments</li>
          </ul>
          <p>If you have any questions, please contact us at ${process.env.ADMIN_EMAIL || 'support@acehomesolutions.com'}.</p>
          <br>
          <p>Welcome to the team!<br><strong>ACE Home Solutions</strong></p>
        `,
      });
    }

    // Send WhatsApp notification
    if (profile.phone) {
      try {
        await sendNotification({
          to: profile.phone,
          type: 'whatsapp',
          message: `Hello! ${profile.full_name || 'there'}\n\nCongratulations! Your application to join ACE Home Solutions as a technician has been approved. You can now log in to your account and start accepting jobs.\n\nThank you for choosing ACE Home Solutions!`,
          userId: profile._id,
          metadata: {
            type: 'technician_approval',
            technician_id: profile._id.toString()
          },
        });
        console.log(`✅ WhatsApp notification sent to technician ${profile._id}`);
      } catch (whatsappError) {
        console.error('⚠️ Failed to send WhatsApp notification:', whatsappError);
        // Don't fail the approval if WhatsApp fails
      }
    }

    res.json({ success: true, profile });
  } catch (err) {
    console.error('approve technician error:', err);
    res.status(500).json({ error: 'approve_failed', message: 'Failed to approve technician' });
  }
});

// Admin: reject technician
app.post(`${apiBase}/admin/technicians/:id/reject`, requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const profile = await Profile.findById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not_found' });

    console.log(`[Reject Technician] Rejecting profile ${profile._id} (${profile.full_name}), current status: ${profile.approval_status}`);
    
    profile.approval_status = 'rejected';
    profile.is_available = false;
    await profile.save();

    console.log(`[Reject Technician] Profile ${profile._id} rejected successfully, new status: ${profile.approval_status}`);

    if (profile.email) {
      await sendEmail({
        to: profile.email,
        subject: 'Update on your ACE Home technician application',
        html: `
          <p>Hi ${profile.full_name || 'there'},</p>
          <p>Thank you for applying to become a technician with <strong>ACE Home Solutions</strong>.</p>
          <p>At this time, we are unable to approve your application.</p>
          ${reason ? `<p><strong>Reason:</strong> ${sanitizeInput(reason)}</p>` : ''}
          <p>You may re-apply in the future if your situation changes.</p>
          <p>– ACE Home Team</p>
        `,
      });
    }

    res.json({ success: true, profile });
  } catch (err) {
    console.error('reject technician error:', err);
    res.status(500).json({ error: 'reject_failed', message: 'Failed to reject technician' });
  }
});

// OTP helpers
const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
const generateOtp = () => {
  // Generate random 6-digit OTP (100000 to 999999)
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Request OTP (SMS placeholder)
app.post(
  `${apiBase}/auth/request-otp`,
  [body('phone').trim().notEmpty().withMessage('Phone number is required')],
  validate,
  async (req, res) => {
    try {
      const phone = sanitizeInput(req.body.phone);
      const existing = await OTP.findOne({ phone }).sort({ created_at: -1 });
      if (existing && existing.last_sent_at && Date.now() - existing.last_sent_at.getTime() < 45_000) {
        return res.status(429).json({ error: 'otp_rate_limited', retry_in_ms: 45000 });
      }

      const code = generateOtp();
      const code_hash = hashCode(code);
      const expires_at = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      await OTP.findOneAndUpdate(
        { phone },
        { phone, code_hash, expires_at, attempts: 0, last_sent_at: new Date(), purpose: 'login' },
        { upsert: true, new: true }
      );

      // Send OTP via WhatsApp via MSG91 (only)
      let otpResult;
      const { sendOTPViaMSG91WhatsApp } = await import('./services/msg91.js');
      otpResult = await sendOTPViaMSG91WhatsApp(phone, code);
      if (otpResult.success) {
        console.log(`✅ OTP sent to ${phone} via MSG91 WhatsApp`);
      } else {
        console.error(`❌ OTP WhatsApp failed for ${phone}: ${otpResult.error}`);
      }
      
      if (!otpResult.success) {
        console.warn(`⚠️ OTP sending failed for ${phone}: ${otpResult.error}. OTP code: ${code}`);
        // Still return success - OTP is generated and stored, sending failure is logged
      }

      res.json({ success: true, message: 'OTP sent' });
    } catch (err) {
      console.error('request-otp error:', err);
      res.status(500).json({ error: 'otp_request_failed' });
    }
  }
);


// Verify OTP
app.post(
  `${apiBase}/auth/verify-otp`,
  [
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('code').trim().isLength({ min: 4, max: 6 }).withMessage('OTP code must be 4-6 digits'),
    body('full_name').optional().trim().isLength({ min: 2, max: 100 }),
    body('email').optional().isEmail(),
  ],
  validate,
  async (req, res) => {
    try {
      const phone = sanitizeInput(req.body.phone);
      const code = req.body.code.trim();
      const full_name = req.body.full_name ? sanitizeInput(req.body.full_name) : undefined;
      const email = req.body.email ? sanitizeInput(req.body.email) : undefined;
      const requestedRole = req.body.role || 'customer'; // Default to customer if not specified

      const otp = await OTP.findOne({ phone }).sort({ created_at: -1 });
      if (!otp) {
        return res.status(400).json({ 
          error: 'otp_not_found', 
          message: 'OTP not found. Please request a new OTP first.' 
        });
      }
      if (otp.expires_at < new Date()) {
        return res.status(400).json({ 
          error: 'otp_expired', 
          message: 'OTP has expired. Please request a new OTP.' 
        });
      }
      if (otp.attempts >= 5) {
        return res.status(429).json({ 
          error: 'otp_attempts_exceeded', 
          message: 'Too many failed attempts. Please request a new OTP.' 
        });
      }

      const code_hash = hashCode(code);
      if (code_hash !== otp.code_hash) {
        otp.attempts += 1;
        await otp.save();
        return res.status(400).json({ 
          error: 'otp_invalid', 
          message: `Invalid OTP. ${5 - otp.attempts} attempts remaining.` 
        });
      }

      // Success: delete OTP
      await OTP.deleteOne({ _id: otp._id });

      // Find or create profile
      let profile = await Profile.findOne({ phone });
      const isNewUser = !profile;
      
      if (!profile) {
        // New user - create profile with requested role (default customer)
        profile = await Profile.create({
          phone,
          full_name: full_name || 'Customer',
          email,
          role: requestedRole,
          phone_verified: true,
          email_verified: !!email,
        });
      } else {
        // Existing user - verify phone and update if needed
        profile.phone_verified = true;
        if (email) {
          profile.email = email;
          profile.email_verified = true;
        }
        if (full_name && full_name !== 'Customer') profile.full_name = full_name;
        await profile.save();
      }

      // Check if profile needs completion (only for new users)
      // Existing users should never be asked to complete profile again
      const needsProfileCompletion = isNewUser && (!profile.full_name || profile.full_name === 'Customer' || !profile.email);

      console.log(`🔐 OTP verified - User: ${profile.phone}, isNewUser: ${isNewUser}, needsProfileCompletion: ${needsProfileCompletion}`);

      res.json({
        success: true,
        user: { id: profile._id.toString(), phone: profile.phone },
        profile,
        needsProfileCompletion,
      });
    } catch (err) {
      console.error('verify-otp error:', err);
      res.status(500).json({ error: 'otp_verify_failed' });
    }
  }
);

// Reset password using OTP (phone-based)
app.post(
  `${apiBase}/auth/reset-password`,
  [
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('code').trim().isLength({ min: 4, max: 6 }).withMessage('OTP code must be 4-6 digits'),
    body('new_password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  async (req, res) => {
    try {
      const phone = sanitizeInput(req.body.phone);
      const code = req.body.code.trim();
      const newPassword = req.body.new_password;

      const otp = await OTP.findOne({ phone }).sort({ created_at: -1 });
      if (!otp) {
        return res.status(400).json({
          error: 'otp_not_found',
          message: 'OTP not found. Please request a new OTP first.',
        });
      }
      if (otp.expires_at < new Date()) {
        return res.status(400).json({
          error: 'otp_expired',
          message: 'OTP has expired. Please request a new OTP.',
        });
      }
      if (otp.attempts >= 5) {
        return res.status(429).json({
          error: 'otp_attempts_exceeded',
          message: 'Too many failed attempts. Please request a new OTP.',
        });
      }

      const code_hash = hashCode(code);
      if (code_hash !== otp.code_hash) {
        otp.attempts += 1;
        await otp.save();
        return res.status(400).json({
          error: 'otp_invalid',
          message: `Invalid OTP. ${5 - otp.attempts} attempts remaining.`,
        });
      }

      // Success: delete OTP
      await OTP.deleteOne({ _id: otp._id });

      // Find profile by phone
      const profile = await Profile.findOne({ phone });
      if (!profile) {
        return res.status(404).json({ error: 'not_found', message: 'Account not found for this phone number.' });
      }

      profile.password_hash = await hashPassword(newPassword);
      profile.phone_verified = true;
      await profile.save();

      return res.json({ success: true, message: 'Password has been reset successfully.' });
    } catch (err) {
      console.error('reset-password error:', err);
      return res.status(500).json({ error: 'reset_password_failed', message: 'Failed to reset password.' });
    }
  }
);

app.post(`${apiBase}/profiles`, requireAdmin, async (req, res) => {
  try {
    const {
      phone,
      full_name,
      email,
      role,
      skills,
      location,
      address,
      is_available,
      max_capacity,
      rating,
      experience_years,
      aadhaar_number,
      aadhaar_image_url,
      bank_details,
      age,
      date_of_birth,
      gender,
      other_skills,
    } = req.body;
    if (!phone || !full_name) return res.status(400).json({ error: 'phone and full_name required' });
    
    // Check if profile already exists
    const existing = await Profile.findOne({ phone });
    if (existing) {
      // Update existing profile with new data
      const updateData = {};
      if (full_name) updateData.full_name = full_name;
      if (email !== undefined) updateData.email = email;
      if (role) updateData.role = role;
      if (skills !== undefined) updateData.skills = skills;
      if (location !== undefined) updateData.location = location;
      if (address !== undefined) updateData.address = address;
      if (is_available !== undefined) updateData.is_available = is_available;
      if (max_capacity !== undefined) updateData.max_capacity = max_capacity;
      if (rating !== undefined) updateData.rating = rating;
      if (experience_years !== undefined) updateData.experience_years = experience_years;
      if (aadhaar_number !== undefined) updateData.aadhaar_number = aadhaar_number;
      if (aadhaar_image_url !== undefined) updateData.aadhaar_image_url = aadhaar_image_url;
      if (bank_details !== undefined) updateData.bank_details = bank_details;
      if (age !== undefined) updateData.age = age;
      if (date_of_birth !== undefined) updateData.date_of_birth = date_of_birth;
      if (gender !== undefined) updateData.gender = gender;
      if (other_skills !== undefined) updateData.other_skills = other_skills;
      // If admin is updating a worker/employee profile, ensure it's approved and fully verified
      if (role === 'worker' || role === 'employee') {
        updateData.approval_status = 'approved';
        updateData.id_verified = true;
        updateData.skills_verified = true;
        updateData.background_check_status = 'approved';
      }
      
      const updated = await Profile.findByIdAndUpdate(existing._id, updateData, { new: true });
      return res.json(updated);
    }
    
    // Create new profile with all fields
    // When admin creates a profile directly, it should be auto-approved and fully verified
    const created = await Profile.create({
      phone,
      full_name,
      email,
      role: role || 'employee',
      skills: skills || [],
      location,
      address,
      is_available: is_available !== undefined ? is_available : true,
      max_capacity: max_capacity || 5,
      rating: rating || 0,
      experience_years: experience_years || 0,
      aadhaar_number: aadhaar_number || undefined,
      aadhaar_image_url: aadhaar_image_url || undefined,
      bank_details: bank_details || undefined,
      age: age ? Number(age) : undefined,
      date_of_birth: date_of_birth || undefined,
      gender: gender || undefined,
      other_skills: other_skills || undefined,
      approval_status: 'approved', // Admin-created profiles are auto-approved
      id_verified: true, // Admin-created profiles are automatically ID verified
      skills_verified: true, // Admin-created profiles are automatically skills verified
      background_check_status: 'approved', // Admin-created profiles are automatically background checked
    });
    res.json(created);
  } catch (err) {
    console.error('Create profile error:', err);
    res.status(500).json({ error: 'create_profile_error', message: err.message });
  }
});

app.get(`${apiBase}/profiles/:id`, async (req, res) => {
  try {
    const profile = await Profile.findById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'profile_error' });
  }
});

app.get(`${apiBase}/profiles`, async (req, res) => {
  const { role } = req.query;
  console.log(`[Profiles API] GET /profiles called with role: ${role || 'none'}`);
  let filter = {};
  
  if (role) {
    // Strict role matching - only return profiles with exact role match
    if (role === 'worker' || role === 'employee') {
      // Only return worker or employee roles, never admin or customer
      // CRITICAL: Exclude pending AND rejected applications - they should not appear in the main list
      // STRICT FILTER: Only show approved profiles OR legacy profiles without approval_status
      filter = {
        $and: [
          { role: role },
          // EXCLUDE pending and rejected explicitly
          {
            $nor: [
              { approval_status: 'pending' },
              { approval_status: 'rejected' }
            ]
          },
          // Include only approved, null, or missing approval_status
          {
            $or: [
              // Legacy profiles without approval_status field (assume approved)
              { approval_status: { $exists: false } },
              // Profiles with null approval_status (assume approved)
              { approval_status: null },
              // Explicitly approved profiles
              { approval_status: 'approved' },
            ]
          }
        ]
      };
      
      console.log(`[Profiles API] Filtering ${role} profiles, excluding pending/rejected. Filter:`, JSON.stringify(filter));
    } else if (role === 'customer') {
      // For customers, include profiles with role='customer' OR profiles without a role (legacy customers)
      // Use $or to match customer role or missing/null role
      // Clear any existing filter properties and set up the customer filter
      filter = {
        $or: [
          { role: 'customer' },
          { role: { $exists: false } }, // Legacy profiles without role field
          { role: null }, // Profiles with null role
        ]
      };
      console.log(`[Profiles API] Filtering customer profiles. Filter:`, JSON.stringify(filter));
    } else {
      // For other roles (admin, etc.), use exact match
      filter.role = role;
      console.log(`[Profiles API] Filtering ${role} profiles. Filter:`, JSON.stringify(filter));
    }
  } else {
    // If no role specified, exclude admin and customer by default
    filter.role = { $nin: ['admin', 'customer'] };
  }
  
  let profiles = await Profile.find(filter);
  console.log(`[Profiles API] Found ${profiles.length} profiles matching filter for role: ${role || 'all'}`);
  
  // Post-filter for customers: exclude any profiles that have worker/employee/admin roles
  if (role === 'customer') {
    const beforeCount = profiles.length;
    
    // Debug: Check total profiles in database to understand the issue
    const totalProfiles = await Profile.countDocuments({});
    const customerProfiles = await Profile.countDocuments({ role: 'customer' });
    const noRoleProfiles = await Profile.countDocuments({ role: { $exists: false } });
    const nullRoleProfiles = await Profile.countDocuments({ role: null });
    const allRoles = await Profile.distinct('role');
    console.log(`[Profiles API] Database stats - Total: ${totalProfiles}, Customer role: ${customerProfiles}, No role: ${noRoleProfiles}, Null role: ${nullRoleProfiles}`);
    console.log(`[Profiles API] All distinct roles in database:`, allRoles);
    
    // If no profiles found with the $or query, try alternative queries
    if (profiles.length === 0) {
      console.log(`[Profiles API] No profiles matched the $or filter. Trying alternative queries...`);
      
      // Try querying just for customer role
      const customerOnly = await Profile.find({ role: 'customer' });
      console.log(`[Profiles API] Query with role='customer' found: ${customerOnly.length} profiles`);
      
      // Try querying for profiles without role
      const noRole = await Profile.find({ role: { $exists: false } });
      console.log(`[Profiles API] Query with no role field found: ${noRole.length} profiles`);
      
      // Try querying for null role
      const nullRole = await Profile.find({ role: null });
      console.log(`[Profiles API] Query with role=null found: ${nullRole.length} profiles`);
      
      // Combine all results
      const allPossibleCustomers = [...customerOnly, ...noRole, ...nullRole];
      // Remove duplicates by _id
      const uniqueCustomers = allPossibleCustomers.filter((p, index, self) => 
        index === self.findIndex((t) => t._id.toString() === p._id.toString())
      );
      console.log(`[Profiles API] Combined unique profiles: ${uniqueCustomers.length}`);
      profiles = uniqueCustomers;
    }
    
    // Debug: Log all profiles before filtering
    if (profiles.length > 0) {
      console.log(`[Profiles API] All profiles before post-filter:`, profiles.map(p => ({
        _id: p._id,
        name: p.full_name,
        role: p.role || 'no-role',
        phone: p.phone
      })));
    }
    
    profiles = profiles.filter(p => {
      const profileRole = p.role;
      // Exclude if role is explicitly worker, employee, or admin
      if (profileRole === 'worker' || profileRole === 'employee' || profileRole === 'admin') {
        return false;
      }
      // Include if role is 'customer' or undefined/null (legacy customer)
      return profileRole === 'customer' || !profileRole || profileRole === null;
    });
    const afterCount = profiles.length;
    if (beforeCount !== afterCount) {
      console.log(`[Profiles API] Post-filter: Removed ${beforeCount - afterCount} non-customer profiles`);
    }
    
    // Debug: Log role distribution
    const roleCounts = {};
    profiles.forEach(p => {
      const r = p.role || 'no-role';
      roleCounts[r] = (roleCounts[r] || 0) + 1;
    });
    console.log(`[Profiles API] Customer profiles role breakdown:`, roleCounts);
    console.log(`[Profiles API] Final customer count: ${profiles.length}`);
  }
  
  // POST-FILTER: Double-check to remove any pending or rejected profiles that slipped through
  // BUT: Only apply this filter for worker/employee roles, NOT for customers or admins
  if (role === 'worker' || role === 'employee') {
    const beforeCount = profiles.length;
    profiles = profiles.filter(p => {
      const status = p.approval_status;
      if (status === 'pending' || status === 'rejected') {
        console.log(`[Profiles API] POST-FILTER: Removing ${status} profile: ${p.full_name} (${p._id})`);
        return false;
      }
      return true;
    });
    const afterCount = profiles.length;
    if (beforeCount !== afterCount) {
      console.log(`[Profiles API] POST-FILTER: Removed ${beforeCount - afterCount} pending/rejected profiles`);
    }
  } else {
    console.log(`[Profiles API] POST-FILTER: Skipping for role: ${role} (only applies to worker/employee)`);
  }
  
  // Log approval statuses for debugging
  const statusCounts = {};
  profiles.forEach(p => {
    const status = p.approval_status || 'none';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  console.log(`[Profiles API] Final approval status breakdown:`, statusCounts);
  
  // Final log before sending response
  console.log(`[Profiles API] Sending ${profiles.length} profiles for role: ${role || 'all'}`);
  if (role === 'customer' && profiles.length === 0) {
    console.log(`[Profiles API] WARNING: No customers found! Check database stats above.`);
  }
  
  res.json(profiles);
});

// Diagnostic endpoint to check all profiles and their roles (admin only)
app.get(`${apiBase}/admin/debug/profiles`, requireAdmin, async (req, res) => {
  try {
    const allProfiles = await Profile.find({}).select('_id full_name phone email role approval_status').lean();
    const roleStats = {};
    allProfiles.forEach(p => {
      const r = p.role || 'no-role';
      roleStats[r] = (roleStats[r] || 0) + 1;
    });
    
    return res.json({
      total: allProfiles.length,
      roleStats,
      profiles: allProfiles.map(p => ({
        _id: p._id,
        name: p.full_name,
        phone: p.phone,
        email: p.email,
        role: p.role || 'no-role',
        approval_status: p.approval_status || 'none'
      }))
    });
  } catch (err) {
    console.error('[Debug Profiles] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

app.patch(`${apiBase}/profiles/:id/role`, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'role_required' });
  const profile = await Profile.findByIdAndUpdate(req.params.id, { role }, { new: true });
  if (!profile) return res.status(404).json({ error: 'not_found' });
  res.json(profile);
});

// Update verification flags (admin)
app.patch(`${apiBase}/profiles/:id/verification`, requireAdmin, async (req, res) => {
  const allowedFields = [
    'phone_verified',
    'email_verified',
    'id_verified',
    'background_check_status',
    'background_check_note',
    'skills_verified',
    'payout_verified',
    'verification_docs',
  ];
  const updateData = {};
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  });

  try {
    const profile = await Profile.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json(profile);
  } catch (err) {
    console.error('verification update error:', err);
    res.status(500).json({ error: 'verification_update_error' });
  }
});

// Complete profile for new users (after OTP verification)
app.post(`${apiBase}/profiles/complete`, async (req, res) => {
  try {
    const { full_name, email, date_of_birth, gender } = req.body;
    
    // Get user from session token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized', message: 'Please login first' });
    }
    
    // Extract session from token (format: base64 encoded JSON)
    let session;
    try {
      const token = authHeader.split(' ')[1];
      if (!token) {
        console.error('❌ No token found in Authorization header');
        return res.status(401).json({ error: 'unauthorized', message: 'No token provided' });
      }
      session = JSON.parse(Buffer.from(token, 'base64').toString());
      console.log('🔐 Session decoded for user:', session?.id);
    } catch (parseErr) {
      console.error('❌ Session parse error:', parseErr);
      console.error('Token received:', authHeader.substring(0, 50) + '...');
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid session token' });
    }
    
    if (!session || !session.id) {
      console.error('❌ Invalid session structure:', session);
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid session' });
    }
    
    const profile = await Profile.findById(session.id);
    if (!profile) {
      return res.status(404).json({ error: 'profile_not_found' });
    }
    
    // Update profile with provided details
    if (full_name) profile.full_name = sanitizeInput(full_name);
    if (email) {
      profile.email = sanitizeInput(email);
      profile.email_verified = true;
    }
    if (date_of_birth) profile.date_of_birth = date_of_birth;
    if (gender) profile.gender = gender;
    
    await profile.save();
    
    res.json(profile);
  } catch (err) {
    console.error('Complete profile error:', err);
    res.status(500).json({ error: 'complete_profile_error', message: err.message });
  }
});

app.patch(`${apiBase}/profiles/:id`, requireAdmin, async (req, res) => {
  try {
    const updateData = { ...req.body };
    // Remove _id if present
    delete updateData._id;
    const profile = await Profile.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'update_profile_error' });
  }
});

app.delete(`${apiBase}/profiles/:id`, requireAdmin, async (req, res) => {
  await Profile.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.get(`${apiBase}/categories`, async (req, res) => {
  const { is_popular } = req.query;
  const filter = { is_active: true };
  if (is_popular === 'true') {
    filter.is_popular = true;
  }
  const categories = await Category.find(filter).sort({ sort_order: 1 });
  res.json(categories);
});

app.post(`${apiBase}/categories`, requireAdmin, async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.json(category);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'create_category_error' });
  }
});

app.patch(`${apiBase}/categories/:id`, requireAdmin, async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!category) return res.status(404).json({ error: 'not_found' });
  res.json(category);
});

app.delete(`${apiBase}/categories/:id`, requireAdmin, async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Search autocomplete endpoint
app.get(`${apiBase}/services/search/autocomplete`, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }

    const services = await Service.find({
      is_active: true,
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ],
    })
      .populate('category_id', 'name slug')
      .select('name slug category_id base_price average_rating')
      .limit(8)
      .sort({ average_rating: -1 });

    res.json(services);
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json({ error: 'autocomplete_error' });
  }
});

app.get(`${apiBase}/services`, async (req, res) => {
  const { categorySlug, minPrice, maxPrice, minRating, search, limit } = req.query;
  const filter = { is_active: true };

  if (minPrice) filter.base_price = { ...filter.base_price, $gte: Number(minPrice) };
  if (maxPrice) filter.base_price = { ...filter.base_price, $lte: Number(maxPrice) };
  if (minRating) filter.average_rating = { $gte: Number(minRating) };
  if (search) filter.name = { $regex: search, $options: 'i' };

  if (categorySlug) {
    const category = await Category.findOne({ slug: categorySlug });
    if (category) filter.category_id = category._id;
  }

  const query = Service.find(filter).populate('category_id', 'name slug').sort({ average_rating: -1 });
  if (limit) query.limit(Number(limit));
  const services = await query.exec();
  
  // Calculate and update ratings for all services (batch update for efficiency)
  for (const service of services) {
    const serviceReviews = await Review.find({ service_id: service._id, is_verified: true });
    if (serviceReviews.length > 0) {
      const avgRating = serviceReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / serviceReviews.length;
      const calculatedRating = Math.round(avgRating * 10) / 10;
      const calculatedCount = serviceReviews.length;
      
      if (service.average_rating !== calculatedRating || service.review_count !== calculatedCount) {
        await Service.findByIdAndUpdate(service._id, { 
          average_rating: calculatedRating,
          review_count: calculatedCount
        });
        service.average_rating = calculatedRating;
        service.review_count = calculatedCount;
      }
    }
  }
  
  res.json(services);
});

app.post(`${apiBase}/services`, requireAdmin, async (req, res) => {
  try {
    const service = await Service.create(req.body);
    res.json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'create_service_error' });
  }
});

app.patch(`${apiBase}/services/:id`, requireAdmin, async (req, res) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!service) return res.status(404).json({ error: 'not_found' });
    res.json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'update_service_error' });
  }
});

app.delete(`${apiBase}/services/:id`, requireAdmin, async (req, res) => {
  try {
    await Service.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'delete_service_error' });
  }
});

// Service Add-ons CRUD (admin)
app.get(`${apiBase}/service-addons`, requireAdmin, async (req, res) => {
  try {
    const { serviceId } = req.query;
    const filter = {};
    if (serviceId) filter.service_id = serviceId;
    const addons = await ServiceAddon.find(filter).sort({ created_at: -1 });
    res.json(addons);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'list_addons_error' });
  }
});

app.post(`${apiBase}/service-addons`, requireAdmin, async (req, res) => {
  try {
    const addon = await ServiceAddon.create(req.body);
    res.json(addon);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'create_addon_error' });
  }
});

app.patch(`${apiBase}/service-addons/:id`, requireAdmin, async (req, res) => {
  try {
    const addon = await ServiceAddon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!addon) return res.status(404).json({ error: 'not_found' });
    res.json(addon);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'update_addon_error' });
  }
});

app.delete(`${apiBase}/service-addons/:id`, requireAdmin, async (req, res) => {
  try {
    await ServiceAddon.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'delete_addon_error' });
  }
});

app.get(`${apiBase}/services/:slug`, async (req, res) => {
  const service = await Service.findOne({ slug: req.params.slug, is_active: true });
  if (!service) return res.status(404).json({ error: 'not_found' });
  const addons = await ServiceAddon.find({ service_id: service._id, is_active: true });
  const reviews = await Review.find({ service_id: service._id, is_verified: true })
    .populate('customer_id', 'full_name')
    .sort({ created_at: -1 })
    .limit(10);
  
  // Calculate and update average_rating and review_count if not set or outdated
  const serviceReviews = await Review.find({ service_id: service._id, is_verified: true });
  if (serviceReviews.length > 0) {
    const avgRating = serviceReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / serviceReviews.length;
    const calculatedRating = Math.round(avgRating * 10) / 10;
    const calculatedCount = serviceReviews.length;
    
    // Update if different from stored values
    if (service.average_rating !== calculatedRating || service.review_count !== calculatedCount) {
      await Service.findByIdAndUpdate(service._id, { 
        average_rating: calculatedRating,
        review_count: calculatedCount
      });
      service.average_rating = calculatedRating;
      service.review_count = calculatedCount;
    }
  }
  
  res.json({ service, addons, reviews });
});

app.get(`${apiBase}/reviews`, async (req, res) => {
  const { limit, serviceId, employeeId, bookingId } = req.query;
  const filter = { is_verified: true };
  if (serviceId) filter.service_id = serviceId;
  if (employeeId) filter.employee_id = employeeId;
  if (bookingId) filter.booking_id = bookingId;
  const query = Review.find(filter)
    .populate('customer_id', 'full_name')
    .populate('service_id', 'name')
    .populate('employee_id', 'full_name')
    .sort({ created_at: -1 });
  if (limit) query.limit(Number(limit));
  const reviews = await query.exec();
  res.json(reviews);
});

// Get review by booking ID
app.get(`${apiBase}/reviews/booking/:bookingId`, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const review = await Review.findOne({ booking_id: bookingId })
      .populate('customer_id', 'full_name')
      .populate('service_id', 'name')
      .populate('employee_id', 'full_name');
    
    // Return null instead of 404 - "no review" is a valid state, not an error
    if (!review) {
      return res.status(200).json(null);
    }
    
    res.json(review);
  } catch (err) {
    console.error('Get review by booking error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Create review (with worker rating)
app.post(`${apiBase}/reviews`, async (req, res) => {
  try {
    const { customer_id, service_id, employee_id, booking_id, rating, worker_rating, comment, images } = req.body;
    
    if (!customer_id || !service_id || !rating) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    // Verify booking belongs to customer (if booking_id provided)
    if (booking_id) {
      const booking = await Booking.findById(booking_id);
      if (!booking) {
        return res.status(404).json({ error: 'booking_not_found' });
      }
      
      // Ensure only the booking customer can review
      if (booking.customer_id.toString() !== customer_id) {
        return res.status(403).json({ error: 'unauthorized', message: 'You can only review your own bookings' });
      }

      // Check if review already exists for this booking
      const existing = await Review.findOne({ booking_id });
      if (existing) {
        return res.status(400).json({ error: 'review_already_exists', message: 'You have already reviewed this booking' });
      }
    }

    const review = await Review.create({
      customer_id,
      service_id,
      employee_id,
      booking_id,
      rating,
      worker_rating,
      comment,
      images: images || [],
      is_verified: true,
    });

    // Update worker rating if worker_rating provided
    if (employee_id && worker_rating) {
      const workerReviews = await Review.find({ 
        employee_id, 
        worker_rating: { $exists: true, $ne: null } 
      });
      const avgRating = workerReviews.reduce((sum, r) => sum + (r.worker_rating || 0), 0) / workerReviews.length;
      await Profile.findByIdAndUpdate(employee_id, { rating: Math.round(avgRating * 10) / 10 });
    }

    // Update service average_rating and review_count
    const serviceReviews = await Review.find({ service_id, is_verified: true });
    if (serviceReviews.length > 0) {
      const avgServiceRating = serviceReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / serviceReviews.length;
      await Service.findByIdAndUpdate(service_id, { 
        average_rating: Math.round(avgServiceRating * 10) / 10,
        review_count: serviceReviews.length
      });
    }

    const populatedReview = await Review.findById(review._id)
      .populate('customer_id', 'full_name')
      .populate('service_id', 'name')
      .populate('employee_id', 'full_name');

    res.json(populatedReview);
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'create_review_error' });
  }
});

app.post(
  `${apiBase}/bookings`,
  [
    body('service_id').notEmpty().withMessage('Service ID required'),
    body('booking_date').isISO8601().withMessage('Invalid date format'),
    body('booking_time').notEmpty().withMessage('Booking time required'),
    body('customer_name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('customer_phone').trim().isMobilePhone('en-IN').withMessage('Invalid phone number'),
    body('customer_address').isObject().withMessage('Address must be an object'),
    body('total_price').isFloat({ min: 0 }).withMessage('Invalid price'),
    body('customer_id').isMongoId().withMessage('Customer ID required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { customer_pincode, customer_address, booking_date, booking_time, service_id } = req.body;

    // Pincode serviceability check removed - services available for whole Gorakhpur city
    const pincode = customer_pincode || customer_address?.pincode;

    // Validate required fields
    if (!service_id || !booking_date || !booking_time) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    // Require verified customer
    const customerProfile = await Profile.findById(req.body.customer_id);
    if (!customerProfile) {
      return res.status(404).json({ error: 'customer_not_found' });
    }
    if (!customerProfile.phone_verified) {
      return res.status(403).json({ error: 'phone_not_verified', message: 'Please verify your phone before booking.' });
    }

    // Check slot availability if slot management is enabled
    const bookingDate = new Date(booking_date);
    const timeSlot = booking_time; // e.g., "morning", "afternoon", "evening"
    
    // Map time slot to actual time range
    const timeSlotMap = {
      morning: '09:00-12:00',
      afternoon: '12:00-15:00',
      evening: '15:00-18:00',
    };
    const actualTimeSlot = timeSlotMap[timeSlot] || timeSlot;

    // Check if slot is available
    const slot = await Slot.findOne({
      service_id,
      date: { $gte: new Date(bookingDate.setHours(0, 0, 0, 0)), $lt: new Date(bookingDate.setHours(23, 59, 59, 999)) },
      time_slot: actualTimeSlot,
    });

    if (slot && slot.booked_count >= slot.total_capacity) {
      return res.status(400).json({ 
        error: 'slot_unavailable', 
        message: 'This time slot is fully booked. Please choose another time.' 
      });
    }

    // Calculate pricing breakdown on the server for consistency and security
    const basePrice = Number(req.body.base_price) || 0;
    const addonPrice = Number(req.body.addon_price) || 0;
    const discountAmount = Number(req.body.discount_amount) || 0;
    const walletAmount = Number(req.body.wallet_amount) || 0;
    // Platform fee currently disabled; set to 0.
    // In future this can be driven by admin-configurable settings.
    const platformFee = 0;
    const subtotalAfterDiscount = Math.max(0, basePrice + addonPrice - discountAmount);
    const computedTotal = Math.max(0, subtotalAfterDiscount - walletAmount);

    // Validate and process wallet payment if used
    if (walletAmount > 0) {
      const customerProfile = await Profile.findById(req.body.customer_id);
      if (!customerProfile) {
        return res.status(404).json({ error: 'customer_not_found' });
      }
      
      const currentBalance = customerProfile.wallet_balance || 0;
      if (walletAmount > currentBalance) {
        return res.status(400).json({ 
          error: 'insufficient_wallet_balance', 
          message: 'Insufficient wallet balance' 
        });
      }
      
      if (walletAmount > subtotalAfterDiscount) {
        return res.status(400).json({ 
          error: 'invalid_wallet_amount', 
          message: 'Wallet amount cannot exceed the total amount after discount' 
        });
      }
    }

    // Create booking with normalized pricing fields
    const booking = await Booking.create({
      ...req.body,
      base_price: basePrice,
      addon_price: addonPrice,
      discount_amount: discountAmount,
      wallet_amount: walletAmount,
      platform_fee: platformFee,
      total_price: computedTotal,
      customer_pincode: pincode,
      status: 'pending',
    });

    // Process wallet payment if used
    if (walletAmount > 0) {
      // Deduct wallet balance
      const customerProfile = await Profile.findById(req.body.customer_id);
      const newBalance = (customerProfile.wallet_balance || 0) - walletAmount;
      await Profile.findByIdAndUpdate(req.body.customer_id, { wallet_balance: newBalance });
      
      // Create wallet transaction
      await WalletTransaction.create({
        user_id: req.body.customer_id,
        amount: walletAmount,
        transaction_type: 'debit',
        description: `Payment for booking ${booking._id}`,
        booking_id: booking._id,
      });
      
      // Update payment status if fully paid from wallet
      if (computedTotal === 0) {
        booking.payment_status = 'paid';
        booking.payment_method = 'wallet';
        await booking.save();
      }
    }

    // Update slot booked count if slot exists
    if (slot) {
      slot.booked_count += 1;
      if (slot.booked_count >= slot.total_capacity) {
        slot.is_available = false;
      }
      await slot.save();
    }

    // Increment promo code usage count if promo code was used
    if (req.body.promo_code) {
      const promo = await PromoCode.findOne({ code: String(req.body.promo_code).toUpperCase().trim() });
      if (promo) {
        promo.usage_count = (promo.usage_count || 0) + 1;
        await promo.save();
      }
    }

    // Send WhatsApp notification to admin for new booking
    try {
      const bookingId = booking._id.toString().slice(-8).toUpperCase();
      const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER || '9794163992'; // Admin WhatsApp number
      
      // Use dedicated admin notification function (supports MSG91 templates)
      const { sendAdminBookingNotification } = await import('./services/whatsapp.js');
      const notifResult = await sendAdminBookingNotification(adminPhone, {
        bookingId // Optional: only send booking ID if template requires it
      });
      
      if (notifResult.success) {
        console.log(`✅ WhatsApp notification sent to admin (${adminPhone}) for new booking ${bookingId}`);
      } else {
        console.error(`⚠️ Failed to send admin notification: ${notifResult.error}`);
      }
    } catch (notifError) {
      // Don't fail booking creation if notification fails
      console.error('⚠️ Failed to send admin notification for new booking:', notifError);
    }

    res.json(booking);
  } catch (err) {
    console.error('Booking creation error:', err);
    res.status(500).json({ error: 'create_booking_error', message: err.message });
  }
});

app.get(`${apiBase}/bookings/:id`, async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    // Include base_price so frontend can always show correct base price
    .populate('service_id', 'name slug base_price')
    .populate('customer_id', 'full_name phone email')
    .populate('employee_id', 'full_name phone');
  if (!booking) return res.status(404).json({ error: 'not_found' });
  res.json(booking);
});

app.get(`${apiBase}/bookings`, async (req, res) => {
  try {
    const { customerId, employeeId, includeDeleted } = req.query;
    const filter = {};
    if (customerId) filter.customer_id = customerId;
    if (employeeId) filter.employee_id = employeeId;
    
    // Exclude deleted bookings by default, unless includeDeleted is true
    if (includeDeleted !== 'true') {
      filter.is_deleted = { $ne: true };
    }
    
      const bookings = await Booking.find(filter)
        .populate('customer_id', 'full_name phone email')
        // Include base_price for listings as well (used in dashboards, etc.)
        .populate('service_id', 'name slug base_price')
        .populate('employee_id', 'full_name phone _id')
        .sort({ booking_date: -1, created_at: -1 });
    
    console.log(`📦 GET /api/bookings - Found ${bookings.length} bookings`, {
      filter,
      count: bookings.length,
    });
    
    res.json(bookings);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'fetch_bookings_error', message: err.message });
  }
});

app.patch(`${apiBase}/bookings/:id/status`, async (req, res) => {
  try {
    const { status, job_photos, before_photos, after_photos } = req.body;
    const updateData = { status };
    
    // Add job photos if provided (legacy support)
    if (job_photos && Array.isArray(job_photos)) {
      updateData.job_photos = job_photos;
    }
    
    // Add before/after photos if provided
    if (before_photos && Array.isArray(before_photos)) {
      updateData.before_photos = before_photos;
    }
    if (after_photos && Array.isArray(after_photos)) {
      updateData.after_photos = after_photos;
    }
    
    // Set timestamps based on status
    if (status === 'accepted') {
      updateData.accepted_at = new Date();
    } else if (status === 'reached') {
      updateData.reached_at = new Date();
    } else if (status === 'in_progress') {
      updateData.started_at = new Date();
    } else if (status === 'completed') {
      updateData.completed_at = new Date();
    }

    const booking = await Booking.findById(req.params.id)
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
      
    if (!booking) return res.status(404).json({ error: 'not_found' });

    // Auto-update payment status for COD bookings when status changes to completed
    if (status === 'completed' && booking.payment_method === 'cod' && booking.payment_status === 'pending') {
      updateData.payment_status = 'paid';
      console.log(`[Update Status] Auto-updated payment_status to 'paid' for COD booking ${booking._id}`);
    }

    const oldStatus = booking.status;
    const updatedBooking = await Booking.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
    
    // Update worker's current_jobs count when status changes
    if (updatedBooking.employee_id) {
      const activeBookings = await Booking.countDocuments({
        employee_id: updatedBooking.employee_id,
        status: { $in: ['assigned', 'accepted', 'reached', 'in_progress'] },
      });
      await Profile.findByIdAndUpdate(updatedBooking.employee_id, { current_jobs: activeBookings });
    }

    // Create notification for customer when status changes
    if (oldStatus !== status && updatedBooking.customer_id) {
      const customer = updatedBooking.customer_id;
      const serviceName = updatedBooking.service_id?.name || 'Service';
      const employeeName = updatedBooking.employee_id?.full_name || 'Our professional';
      
      let message = '';
      let subject = '';
      
      switch (status) {
        case 'assigned':
          message = `Great news! ${employeeName} has been assigned to your ${serviceName} booking. They will contact you soon.`;
          subject = 'Worker Assigned to Your Booking';
          break;
        case 'accepted':
          message = `${employeeName} has accepted your ${serviceName} booking. They will reach your location soon.`;
          subject = 'Worker Accepted Your Booking';
          break;
        case 'reached':
          message = `${employeeName} has reached your location for your ${serviceName} service.`;
          subject = 'Worker Reached Your Location';
          break;
        case 'in_progress':
          message = `${employeeName} has started your ${serviceName} service. They are working on it now.`;
          subject = 'Service Started';
          break;
        case 'completed':
          message = `Your ${serviceName} service has been completed! Please rate your experience in your dashboard.`;
          subject = 'Service Completed';
          break;
        case 'cancelled':
          message = `Your ${serviceName} booking has been cancelled. If you have any questions, please contact us.`;
          subject = 'Booking Cancelled';
          break;
        default:
          message = `Your booking status has been updated to ${status}.`;
          subject = 'Booking Status Updated';
      }

      // Send notifications via unified notification service
      await sendBookingStatusUpdate({
        customer,
        status,
        serviceName,
        employeeName,
        bookingId: updatedBooking._id,
      });
    }
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'update_status_error' });
  }
});

// Get eligible workers for a booking (filtered by skill + location)
app.get(`${apiBase}/bookings/:id/eligible-workers`, requireAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('service_id');
    if (!booking) return res.status(404).json({ error: 'not_found' });

    const serviceId = booking.service_id?._id;
    const customerLocation = booking.customer_address?.pincode || booking.customer_address?.location || '';

    // Find technicians/employees with matching skill and availability
    const filter = {
      role: { $in: ['employee', 'manager', 'lead'] },
      is_available: true,
      // Phone verification is optional for assignment; keep other verifications strict
      // phone_verified: true,
      id_verified: true,
      skills_verified: true,
      background_check_status: 'approved',
      approval_status: 'approved',
      $or: [
        { skills: serviceId },
        { skills: { $size: 0 } }, // Workers with no skills (can do all)
      ],
      $expr: { $lt: ['$current_jobs', '$max_capacity'] }, // Not at capacity
    };

    const workers = await Profile.find(filter).populate('skills', 'name slug');

    // Sort by: 1) Location match, 2) Rating, 3) Experience, 4) Current workload
    const workersWithPriority = workers.map((worker) => {
      let priority = 0;
      const locationMatch = worker.location === customerLocation ? 100 : 0;
      const ratingScore = (worker.rating || 0) * 10;
      const experienceScore = (worker.experience_years || 0) * 5;
      const workloadScore = (worker.max_capacity - worker.current_jobs) * 2;
      
      priority = locationMatch + ratingScore + experienceScore + workloadScore;

      return {
        ...worker.toObject(),
        priority,
        distance: worker.location === customerLocation ? 'Same area' : 'Different area',
      };
    });

    workersWithPriority.sort((a, b) => b.priority - a.priority);

    res.json(workersWithPriority);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'fetch_workers_error' });
  }
});

// Auto-assign worker to booking (assigns best match automatically)
app.patch(`${apiBase}/bookings/:id/auto-assign`, requireAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('service_id');
    if (!booking) return res.status(404).json({ error: 'not_found' });
    if (booking.employee_id) {
      return res.status(400).json({ error: 'already_assigned' });
    }

    const serviceId = booking.service_id?._id;
    const customerLocation = booking.customer_pincode || booking.customer_address?.pincode || '';

    // Find best matching worker
    const filter = {
      role: { $in: ['employee', 'manager', 'lead'] },
      is_available: true,
      // Phone verification is optional for auto-assign as well
      // phone_verified: true,
      id_verified: true,
      skills_verified: true,
      background_check_status: 'approved',
      approval_status: 'approved',
      $or: [
        { skills: serviceId },
        { skills: { $size: 0 } },
      ],
      $expr: { $lt: ['$current_jobs', '$max_capacity'] },
    };

    const workers = await Profile.find(filter).populate('skills', 'name slug');
    
    if (workers.length === 0) {
      return res.status(404).json({ error: 'no_eligible_workers' });
    }

    // Calculate priority scores
    const workersWithPriority = workers.map((worker) => {
      let priority = 0;
      const locationMatch = worker.location === customerLocation ? 100 : 0;
      const ratingScore = (worker.rating || 0) * 10;
      const experienceScore = (worker.experience_years || 0) * 5;
      const workloadScore = (worker.max_capacity - worker.current_jobs) * 2;
      priority = locationMatch + ratingScore + experienceScore + workloadScore;
      return { worker, priority };
    });

    // Sort by priority and get best match
    workersWithPriority.sort((a, b) => b.priority - a.priority);
    const bestWorker = workersWithPriority[0].worker;

    // Assign worker
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { employee_id: bestWorker._id, status: 'assigned', assigned_at: new Date() },
      { new: true }
    ).populate('service_id', 'name').populate('customer_id', 'full_name phone email').populate('employee_id', 'full_name phone');

    // Update worker's current_jobs count
    const activeBookings = await Booking.countDocuments({
      employee_id: bestWorker._id,
      status: { $in: ['assigned', 'in_progress'] },
    });
    await Profile.findByIdAndUpdate(bestWorker._id, { current_jobs: activeBookings });

    // Send notification to customer and employee
    if (updatedBooking.customer_id) {
      await sendBookingStatusUpdate({
        customer: updatedBooking.customer_id,
        status: 'assigned',
        serviceName: updatedBooking.service_id?.name || 'Service',
        employeeName: updatedBooking.employee_id?.full_name || 'Our professional',
        bookingId: updatedBooking._id,
      });
    }

    // Notify employee about new assignment
    if (updatedBooking.employee_id && updatedBooking.employee_id.phone) {
      const serviceName = updatedBooking.service_id?.name || 'Service';
      const customerName = updatedBooking.customer_id?.full_name || 'Customer';
      const employeeName = updatedBooking.employee_id.full_name || 'Employee';
      await sendNotification({
        to: updatedBooking.employee_id.phone,
        type: 'whatsapp',
        message: `Hello! ${employeeName}\n\nNew booking assigned! Service: ${serviceName}, Customer: ${customerName}. Check your portal for details.\n\nThank you for choosing ACE Home Solutions!`,
        userId: updatedBooking.employee_id._id,
        bookingId: updatedBooking._id,
        metadata: { type: 'assignment' },
      });
    }

    res.json(updatedBooking);
  } catch (err) {
    console.error('Auto-assign error:', err);
    res.status(500).json({ error: 'auto_assign_error' });
  }
});

// Assign worker to booking
app.patch(`${apiBase}/bookings/:id/assign`, requireAdmin, async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id_required' });

    const worker = await Profile.findById(employee_id);
    if (!worker) return res.status(404).json({ error: 'worker_not_found' });

    // For assignment we require strong identity/skill/background checks,
    // but phone verification is optional (already enforced in some flows)
    if (
      !worker.id_verified ||
      !worker.skills_verified ||
      worker.background_check_status !== 'approved' ||
      worker.approval_status !== 'approved'
    ) {
      return res.status(400).json({ error: 'worker_not_verified' });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { employee_id, status: 'assigned', assigned_at: new Date() },
      { new: true }
    ).populate('service_id', 'name').populate('customer_id', 'full_name phone email').populate('employee_id', 'full_name phone');

    if (!booking) return res.status(404).json({ error: 'not_found' });

    // Update worker's current_jobs count
    const activeBookings = await Booking.countDocuments({
      employee_id,
      status: { $in: ['assigned', 'in_progress'] },
    });
    await Profile.findByIdAndUpdate(employee_id, { current_jobs: activeBookings });

    // Send notification to customer and employee
    if (booking.customer_id) {
      await sendBookingStatusUpdate({
        customer: booking.customer_id,
        status: 'assigned',
        serviceName: booking.service_id?.name || 'Service',
        employeeName: booking.employee_id?.full_name || 'Our professional',
        bookingId: booking._id,
      });
    }

    // Notify employee about new assignment
    if (booking.employee_id && booking.employee_id.phone) {
      const serviceName = booking.service_id?.name || 'Service';
      const customerName = booking.customer_id?.full_name || 'Customer';
      const employeeName = booking.employee_id.full_name || 'Employee';
      await sendNotification({
        to: booking.employee_id.phone,
        type: 'whatsapp',
        message: `Hello! ${employeeName}\n\nNew booking assigned! Service: ${serviceName}, Customer: ${customerName}. Check your portal for details.\n\nThank you for choosing ACE Home Solutions!`,
        userId: booking.employee_id._id,
        bookingId: booking._id,
        metadata: { type: 'assignment' },
      });
    }

    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'assign_error' });
  }
});

// Soft delete booking (move to trash)
app.patch(`${apiBase}/bookings/:id/delete`, requireAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    if (booking.is_deleted) {
      return res.status(400).json({ error: 'already_deleted', message: 'Booking is already deleted' });
    }
    
    booking.is_deleted = true;
    booking.deleted_at = new Date();
    booking.deleted_by = req.user?.id;
    await booking.save();
    
    res.json({ success: true, message: 'Booking moved to trash' });
  } catch (err) {
    console.error('Soft delete booking error:', err);
    res.status(500).json({ error: 'delete_error', message: err.message });
  }
});

// Restore booking from trash
app.patch(`${apiBase}/bookings/:id/restore`, requireAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    if (!booking.is_deleted) {
      return res.status(400).json({ error: 'not_deleted', message: 'Booking is not deleted' });
    }
    
    booking.is_deleted = false;
    booking.deleted_at = undefined;
    booking.deleted_by = undefined;
    await booking.save();
    
    const updatedBooking = await Booking.findById(req.params.id)
      .populate('service_id', 'name slug')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Restore booking error:', err);
    res.status(500).json({ error: 'restore_error', message: err.message });
  }
});

// Permanent delete booking (admin only)
app.delete(`${apiBase}/bookings/:id`, requireAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    // Only allow permanent delete if booking is already soft deleted
    if (!booking.is_deleted) {
      return res.status(400).json({ 
        error: 'not_in_trash', 
        message: 'Please delete the booking first to move it to trash' 
      });
    }
    
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Booking permanently deleted' });
  } catch (err) {
    console.error('Permanent delete booking error:', err);
    res.status(500).json({ error: 'delete_error', message: err.message });
  }
});

// Cancel booking
app.patch(`${apiBase}/bookings/:id/cancel`, async (req, res) => {
  try {
    const { reason, cancelled_by } = req.body;
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) return res.status(404).json({ error: 'not_found' });
    if (booking.status === 'completed') {
      return res.status(400).json({ error: 'cannot_cancel_completed' });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'already_cancelled' });
    }

    // Update booking
    booking.status = 'cancelled';
    booking.cancelled_at = new Date();
    booking.cancellation_reason = reason || 'No reason provided';
    booking.cancelled_by = cancelled_by || 'customer';
    
    // If slot exists, decrease booked count
    if (booking.booking_date && booking.booking_time) {
      const bookingDate = new Date(booking.booking_date);
      const timeSlotMap = {
        morning: '09:00-12:00',
        afternoon: '12:00-15:00',
        evening: '15:00-18:00',
      };
      const actualTimeSlot = timeSlotMap[booking.booking_time] || booking.booking_time;
      
      const slot = await Slot.findOne({
        service_id: booking.service_id,
        date: { $gte: new Date(bookingDate.setHours(0, 0, 0, 0)), $lt: new Date(bookingDate.setHours(23, 59, 59, 999)) },
        time_slot: actualTimeSlot,
      });

      if (slot && slot.booked_count > 0) {
        slot.booked_count -= 1;
        slot.is_available = true;
        await slot.save();
      }
    }

    // Update worker's current_jobs if assigned
    if (booking.employee_id) {
      const activeBookings = await Booking.countDocuments({
        employee_id: booking.employee_id,
        status: { $in: ['assigned', 'in_progress'] },
      });
      await Profile.findByIdAndUpdate(booking.employee_id, { current_jobs: activeBookings });
    }

    await booking.save();
    res.json(booking);
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'cancel_error' });
  }
});

// Reschedule booking
app.patch(
  `${apiBase}/bookings/:id/reschedule`,
  [
    body('booking_date').isISO8601().withMessage('Invalid date format'),
    body('booking_time').notEmpty().withMessage('Booking time required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { booking_date, booking_time } = req.body;
      const booking = await Booking.findById(req.params.id).populate('service_id');
      
      if (!booking) return res.status(404).json({ error: 'not_found' });
      if (booking.status === 'completed') {
        return res.status(400).json({ error: 'cannot_reschedule_completed' });
      }
      if (booking.status === 'cancelled') {
        return res.status(400).json({ error: 'cannot_reschedule_cancelled' });
      }

      // Validate serviceability for new date
      const pincode = booking.customer_pincode || booking.customer_address?.pincode;
      if (!(await isServiceable(pincode))) {
        return res.status(400).json({ 
          error: 'service_not_available', 
          message: 'Services are not available in your area yet.' 
        });
      }

      // Check slot availability for new date/time
      const newBookingDate = new Date(booking_date);
      const timeSlotMap = {
        morning: '09:00-12:00',
        afternoon: '12:00-15:00',
        evening: '15:00-18:00',
      };
      const actualTimeSlot = timeSlotMap[booking_time] || booking_time;

      // Free up old slot
      if (booking.booking_date && booking.booking_time) {
        const oldBookingDate = new Date(booking.booking_date);
        const oldActualTimeSlot = timeSlotMap[booking.booking_time] || booking.booking_time;
        
        const oldSlot = await Slot.findOne({
          service_id: booking.service_id,
          date: { 
            $gte: new Date(oldBookingDate.setHours(0, 0, 0, 0)), 
            $lt: new Date(oldBookingDate.setHours(23, 59, 59, 999)) 
          },
          time_slot: oldActualTimeSlot,
        });

        if (oldSlot && oldSlot.booked_count > 0) {
          oldSlot.booked_count -= 1;
          oldSlot.is_available = true;
          await oldSlot.save();
        }
      }

      // Check new slot availability
      const newSlot = await Slot.findOne({
        service_id: booking.service_id,
        date: { 
          $gte: new Date(newBookingDate.setHours(0, 0, 0, 0)), 
          $lt: new Date(newBookingDate.setHours(23, 59, 59, 999)) 
        },
        time_slot: actualTimeSlot,
      });

      if (newSlot && newSlot.booked_count >= newSlot.total_capacity) {
        return res.status(400).json({ 
          error: 'slot_unavailable', 
          message: 'This time slot is fully booked. Please choose another time.' 
        });
      }

      // Update booking
      booking.booking_date = newBookingDate;
      booking.booking_time = booking_time;
      booking.status = booking.status === 'assigned' ? 'pending' : booking.status; // Reset to pending if assigned

      // Update new slot
      if (newSlot) {
        newSlot.booked_count += 1;
        if (newSlot.booked_count >= newSlot.total_capacity) {
          newSlot.is_available = false;
        }
        await newSlot.save();
      }

      await booking.save();
      const updatedBooking = await Booking.findById(booking._id)
        .populate('service_id', 'name slug')
        .populate('employee_id', 'full_name phone');

      res.json(updatedBooking);
    } catch (err) {
      console.error('Reschedule booking error:', err);
      res.status(500).json({ error: 'reschedule_error', message: err.message });
    }
  }
);

// Admin Promo Code Management
app.get(`${apiBase}/promo`, requireAdmin, async (req, res) => {
  try {
    const promos = await PromoCode.find().sort({ created_at: -1 });
    res.json(promos);
  } catch (err) {
    console.error('Get promos error:', err);
    res.status(500).json({ error: 'get_promos_error', message: err.message });
  }
});

app.post(`${apiBase}/promo`, requireAdmin, [
  body('code').trim().notEmpty().withMessage('Code is required'),
  body('discount_type').isIn(['percentage', 'flat']).withMessage('Invalid discount type'),
  body('discount_value').isFloat({ min: 0.01 }).withMessage('Discount value must be greater than 0'),
  body('max_discount').optional().isFloat({ min: 0 }),
  body('min_order_value').optional().isFloat({ min: 0 }),
  body('valid_from').optional().isISO8601(),
  body('valid_until').optional().isISO8601(),
  body('max_usage').optional().isInt({ min: 0 }),
], validate, async (req, res) => {
  try {
    const {
      code,
      discount_type,
      discount_value,
      max_discount,
      min_order_value,
      valid_from,
      valid_until,
      is_active,
      max_usage,
    } = req.body;

    // Check if code already exists
    const existing = await PromoCode.findOne({ code: String(code).toUpperCase().trim() });
    if (existing) {
      return res.status(400).json({ error: 'code_exists', message: 'Promo code already exists' });
    }

    const promo = await PromoCode.create({
      code: String(code).toUpperCase().trim(),
      discount_type,
      discount_value: Number(discount_value),
      max_discount: max_discount ? Number(max_discount) : undefined,
      min_order_value: min_order_value ? Number(min_order_value) : undefined,
      valid_from: valid_from ? new Date(valid_from) : undefined,
      valid_until: valid_until ? new Date(valid_until) : undefined,
      is_active: is_active !== undefined ? is_active : true,
      max_usage: max_usage ? Number(max_usage) : undefined,
      usage_count: 0,
    });

    res.json(promo);
  } catch (err) {
    console.error('Create promo error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'code_exists', message: 'Promo code already exists' });
    }
    res.status(500).json({ error: 'create_promo_error', message: err.message });
  }
});

app.patch(`${apiBase}/promo/:id`, requireAdmin, [
  body('code').optional().trim().notEmpty(),
  body('discount_type').optional().isIn(['percentage', 'flat']),
  body('discount_value').optional().isFloat({ min: 0.01 }),
  body('max_discount').optional().isFloat({ min: 0 }),
  body('min_order_value').optional().isFloat({ min: 0 }),
  body('valid_from').optional().isISO8601(),
  body('valid_until').optional().isISO8601(),
  body('max_usage').optional().isInt({ min: 0 }),
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};

    if (req.body.code !== undefined) updateData.code = String(req.body.code).toUpperCase().trim();
    if (req.body.discount_type !== undefined) updateData.discount_type = req.body.discount_type;
    if (req.body.discount_value !== undefined) updateData.discount_value = Number(req.body.discount_value);
    if (req.body.max_discount !== undefined) updateData.max_discount = req.body.max_discount ? Number(req.body.max_discount) : null;
    if (req.body.min_order_value !== undefined) updateData.min_order_value = req.body.min_order_value ? Number(req.body.min_order_value) : null;
    if (req.body.valid_from !== undefined) updateData.valid_from = req.body.valid_from ? new Date(req.body.valid_from) : null;
    if (req.body.valid_until !== undefined) updateData.valid_until = req.body.valid_until ? new Date(req.body.valid_until) : null;
    if (req.body.is_active !== undefined) updateData.is_active = req.body.is_active;
    if (req.body.max_usage !== undefined) updateData.max_usage = req.body.max_usage ? Number(req.body.max_usage) : null;

    // Check code uniqueness if updating code
    if (updateData.code) {
      const existing = await PromoCode.findOne({ code: updateData.code, _id: { $ne: id } });
      if (existing) {
        return res.status(400).json({ error: 'code_exists', message: 'Promo code already exists' });
      }
    }

    const promo = await PromoCode.findByIdAndUpdate(id, updateData, { new: true });
    if (!promo) {
      return res.status(404).json({ error: 'not_found', message: 'Promo code not found' });
    }

    res.json(promo);
  } catch (err) {
    console.error('Update promo error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'code_exists', message: 'Promo code already exists' });
    }
    res.status(500).json({ error: 'update_promo_error', message: err.message });
  }
});

app.delete(`${apiBase}/promo/:id`, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const promo = await PromoCode.findByIdAndDelete(id);
    if (!promo) {
      return res.status(404).json({ error: 'not_found', message: 'Promo code not found' });
    }
    res.json({ success: true, message: 'Promo code deleted' });
  } catch (err) {
    console.error('Delete promo error:', err);
    res.status(500).json({ error: 'delete_promo_error', message: err.message });
  }
});

// Public endpoint to get all active promo codes (for customers to view)
app.get(`${apiBase}/promo/active/all`, async (req, res) => {
  try {
    const now = new Date();
    const activePromos = await PromoCode.find({
      is_active: true,
      valid_from: { $lte: now },
      $or: [
        { valid_until: { $gte: now } },
        { valid_until: null },
      ],
    }).sort({ created_at: -1 });
    
    res.json(activePromos);
  } catch (err) {
    console.error('Get all active promos error:', err);
    res.status(500).json({ error: 'get_active_promos_error', message: err.message });
  }
});

// Public endpoint to get single active promo code (for display on frontend)
app.get(`${apiBase}/promo/active`, async (req, res) => {
  try {
    const now = new Date();
    const activePromos = await PromoCode.find({
      is_active: true,
      $and: [
        {
          $or: [
            { valid_until: { $exists: false } },
            { valid_until: null },
            { valid_until: { $gte: now } }
          ]
        },
        {
          $or: [
            { valid_from: { $exists: false } },
            { valid_from: null },
            { valid_from: { $lte: now } }
          ]
        }
      ]
    })
    .select('code discount_type discount_value max_discount')
    .sort({ created_at: -1 })
    .limit(1); // Return only the first active promo for banner display
    
    res.json(activePromos.length > 0 ? activePromos[0] : null);
  } catch (err) {
    console.error('Get active promo error:', err);
    res.status(500).json({ error: 'get_active_promo_error', message: err.message });
  }
});

// Public promo validation endpoint
app.get(`${apiBase}/promo/validate`, async (req, res) => {
  try {
    const { code, subtotal } = req.query;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'code_required', message: 'Promo code is required' });
    }
    
    const promoCode = String(code).toUpperCase().trim();
    const promo = await PromoCode.findOne({ code: promoCode, is_active: true });
    
    if (!promo) {
      return res.status(404).json({ error: 'invalid_code', message: 'Invalid promo code' });
    }
    
    if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
      return res.status(400).json({ error: 'expired', message: 'This promo code has expired' });
    }
    
    if (promo.valid_from && new Date(promo.valid_from) > new Date()) {
      return res.status(400).json({ error: 'not_yet_valid', message: 'This promo code is not yet valid' });
    }
    
    const orderValue = subtotal ? Number(subtotal) : 0;
    if (orderValue < (promo.min_order_value || 0)) {
      return res.status(400).json({ 
        error: 'min_order_value', 
        message: `Minimum order value of ₹${promo.min_order_value || 0} required`,
        min: promo.min_order_value || 0 
      });
    }
    
    // Check usage limit
    if (promo.max_usage && promo.usage_count >= promo.max_usage) {
      return res.status(400).json({ 
        error: 'usage_limit_exceeded', 
        message: 'This promo code has reached its maximum usage limit' 
      });
    }
    
    res.json(promo);
  } catch (err) {
    console.error('Promo validation error:', err);
    res.status(500).json({ error: 'validation_error', message: 'Failed to validate promo code' });
  }
});

// Employee-specific endpoints for booking workflow
app.post(`${apiBase}/bookings/:id/accept`, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    // Allow employees to accept from either 'assigned' or 'pending' states.
    // Block only clearly invalid terminal states.
    if (['cancelled', 'completed'].includes(booking.status)) {
      return res.status(400).json({ error: 'invalid_status', message: 'Booking cannot be accepted in its current status' });
    }
    
    booking.status = 'accepted';
    booking.accepted_at = new Date();
    await booking.save();
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
    
    // Send notification to customer
    if (updatedBooking.customer_id) {
      await sendBookingStatusUpdate({
        customer: updatedBooking.customer_id,
        status: 'accepted',
        serviceName: updatedBooking.service_id?.name || 'Service',
        employeeName: updatedBooking.employee_id?.full_name || 'Our professional',
        bookingId: booking._id,
      });
    }
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Accept booking error:', err);
    res.status(500).json({ error: 'accept_error', message: err.message });
  }
});

app.post(`${apiBase}/bookings/:id/mark-reached`, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    // Previously this required status === 'accepted'.
    // To make the workflow smoother, allow marking reached for any non-terminal status.
    if (['cancelled', 'completed'].includes(booking.status)) {
      return res.status(400).json({ error: 'invalid_status', message: 'Booking cannot be marked as reached in its current status' });
    }
    
    booking.status = 'reached';
    booking.reached_at = new Date();
    await booking.save();
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
    
    // Send notification to customer
    if (updatedBooking.customer_id) {
      await sendBookingStatusUpdate({
        customer: updatedBooking.customer_id,
        status: 'reached',
        serviceName: updatedBooking.service_id?.name || 'Service',
        employeeName: updatedBooking.employee_id?.full_name || 'Our professional',
        bookingId: booking._id,
      });
    }
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Mark reached error:', err);
    res.status(500).json({ error: 'mark_reached_error', message: err.message });
  }
});

app.post(`${apiBase}/bookings/:id/start-work`, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    // Previously required status === 'reached'.
    // To keep the workflow flexible, allow starting work for any non-terminal status.
    if (['cancelled', 'completed'].includes(booking.status)) {
      return res.status(400).json({
        error: 'invalid_status',
        message: 'Booking cannot be started in its current status',
      });
    }
    
    booking.status = 'in_progress';
    booking.started_at = new Date();
    await booking.save();
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
    
    // Send notification to customer
    if (updatedBooking.customer_id) {
      const customer = updatedBooking.customer_id;
      const serviceName = updatedBooking.service_id?.name || 'Service';
      const employeeName = updatedBooking.employee_id?.full_name || 'Our professional';
      
      await sendBookingStatusUpdate({
        customer: updatedBooking.customer_id,
        status: 'in_progress',
        serviceName: updatedBooking.service_id?.name || 'Service',
        employeeName: updatedBooking.employee_id?.full_name || 'Our professional',
        bookingId: booking._id,
      });
    }
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Start work error:', err);
    res.status(500).json({ error: 'start_work_error', message: err.message });
  }
});

app.post(`${apiBase}/bookings/:id/complete`, async (req, res) => {
  try {
    const { before_photos, after_photos } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    // Previously required status === 'in_progress'.
    // To keep the workflow flexible, allow completion from any non-cancelled state.
    if (['cancelled'].includes(booking.status)) {
      return res.status(400).json({
        error: 'invalid_status',
        message: 'Booking cannot be completed in its current status',
      });
    }
    
    booking.status = 'completed';
    booking.completed_at = new Date();
    
    // Auto-update payment status for COD bookings when work is completed
    // For COD, payment is collected when service is delivered/completed
    if (booking.payment_method === 'cod' && booking.payment_status === 'pending') {
      booking.payment_status = 'paid';
      console.log(`[Complete Booking] Auto-updated payment_status to 'paid' for COD booking ${booking._id}`);
    }
    
    if (before_photos && Array.isArray(before_photos)) {
      booking.before_photos = before_photos;
    }
    if (after_photos && Array.isArray(after_photos)) {
      booking.after_photos = after_photos;
    }
    
    await booking.save();
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone');
    
    // Update worker's current_jobs count
    if (updatedBooking.employee_id) {
      const activeBookings = await Booking.countDocuments({
        employee_id: updatedBooking.employee_id,
        status: { $in: ['assigned', 'accepted', 'reached', 'in_progress'] },
      });
      await Profile.findByIdAndUpdate(updatedBooking.employee_id, { current_jobs: activeBookings });
    }
    
    // Send notification to customer
    if (updatedBooking.customer_id) {
      const customer = updatedBooking.customer_id;
      const serviceName = updatedBooking.service_id?.name || 'Service';
      
      await sendBookingStatusUpdate({
        customer: updatedBooking.customer_id,
        status: 'completed',
        serviceName: updatedBooking.service_id?.name || 'Service',
        employeeName: updatedBooking.employee_id?.full_name || 'Our professional',
        bookingId: booking._id,
      });
    }
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Complete booking error:', err);
    res.status(500).json({ error: 'complete_error', message: err.message });
  }
});

app.post(`${apiBase}/bookings/:id/add-partner`, async (req, res) => {
  try {
    const { partner_id } = req.body;
    if (!partner_id) return res.status(400).json({ error: 'partner_id_required' });
    
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    
    // Verify partner is an employee
    const partner = await Profile.findById(partner_id);
    if (!partner || partner.role !== 'employee') {
      return res.status(400).json({ error: 'invalid_partner', message: 'Partner must be an employee' });
    }
    
    booking.partner_id = partner_id;
    await booking.save();
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate('service_id', 'name')
      .populate('customer_id', 'full_name phone email')
      .populate('employee_id', 'full_name phone')
      .populate('partner_id', 'full_name phone');
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Add partner error:', err);
    res.status(500).json({ error: 'add_partner_error', message: err.message });
  }
});

app.post(`${apiBase}/notify-me`, async (req, res) => {
  try {
    const { service_id, customer_name, customer_phone, customer_email, pincode } = req.body;
    if (!customer_phone) return res.status(400).json({ error: 'phone_required' });
    const notify = await NotifyMe.create({ 
      service_id, 
      customer_name, 
      customer_phone, 
      customer_email, 
      pincode 
    });
    res.json({ success: true, id: notify._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'notify_me_error' });
  }
});

app.get(`${apiBase}/notify-me`, requireAdmin, async (_req, res) => {
  const entries = await NotifyMe.find().sort({ created_at: -1 });
  res.json(entries);
});

// ==================== RAZORPAY PAYMENT ENDPOINTS ====================

// Create Razorpay order
app.post(
  `${apiBase}/payments/create-order`,
  [
    body('amount').isNumeric().withMessage('Amount is required'),
    body('booking_id').isMongoId().withMessage('Valid booking ID required'),
    body('currency').optional().isString(),
  ],
  validate,
  async (req, res) => {
    if (!razorpay) {
      return res.status(503).json({ error: 'payment_service_unavailable', message: 'Payment gateway not configured' });
    }
    
    try {
      const { amount, booking_id, currency = 'INR' } = req.body;

      // Verify booking exists
      const booking = await Booking.findById(booking_id);
      if (!booking) {
        return res.status(404).json({ error: 'booking_not_found' });
      }

      // Verify amount matches booking total
      if (Math.abs(Number(amount) - booking.total_price) > 0.01) {
        return res.status(400).json({ error: 'amount_mismatch' });
      }

      // Create Razorpay order
      const options = {
        amount: Math.round(Number(amount) * 100), // Convert to paise
        currency: currency,
        receipt: `booking_${booking_id}_${Date.now()}`,
        notes: {
          booking_id: booking_id.toString(),
          customer_id: booking.customer_id.toString(),
          service_id: booking.service_id.toString(),
        },
      };

      const order = await razorpay.orders.create(options);

      // Update booking with order ID
      booking.payment_id = order.id;
      await booking.save();

      res.json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
      });
    } catch (err) {
      console.error('Create Razorpay order error:', err);
      res.status(500).json({
        error: 'payment_order_error',
        message: err.message || 'Failed to create payment order',
      });
    }
  }
);

// Verify payment and update booking
app.post(
  `${apiBase}/payments/verify`,
  [
    body('razorpay_order_id').notEmpty().withMessage('Order ID required'),
    body('razorpay_payment_id').notEmpty().withMessage('Payment ID required'),
    body('razorpay_signature').notEmpty().withMessage('Signature required'),
    body('booking_id').isMongoId().withMessage('Valid booking ID required'),
  ],
  validate,
  async (req, res) => {
    if (!razorpay) {
      return res.status(503).json({ error: 'payment_service_unavailable', message: 'Payment gateway not configured' });
    }
    
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id } = req.body;

      // Find booking
      const booking = await Booking.findById(booking_id);
      if (!booking) {
        return res.status(404).json({ error: 'booking_not_found' });
      }

      // Verify signature
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const generated_signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(text)
        .digest('hex');

      if (generated_signature !== razorpay_signature) {
        return res.status(400).json({ error: 'invalid_signature', message: 'Payment verification failed' });
      }

      // Fetch payment details from Razorpay
      const payment = await razorpay.payments.fetch(razorpay_payment_id);

      // Verify payment status and amount
      if (payment.status !== 'captured' && payment.status !== 'authorized') {
        return res.status(400).json({
          error: 'payment_not_captured',
          message: `Payment status: ${payment.status}`,
        });
      }

      const paidAmount = payment.amount / 100; // Convert from paise
      if (Math.abs(paidAmount - booking.total_price) > 0.01) {
        return res.status(400).json({ error: 'amount_mismatch', message: 'Paid amount does not match booking total' });
      }

      // Update booking payment status
      booking.payment_status = 'paid';
      booking.payment_id = razorpay_payment_id;
      booking.status = 'confirmed'; // Move booking to confirmed status
      await booking.save();

      res.json({
        success: true,
        booking_id: booking._id,
        payment_id: razorpay_payment_id,
        amount: paidAmount,
        status: 'paid',
      });
    } catch (err) {
      console.error('Verify payment error:', err);
      res.status(500).json({
        error: 'payment_verification_error',
        message: err.message || 'Failed to verify payment',
      });
    }
  }
);

// Payment webhook (for handling Razorpay events)
app.post(`${apiBase}/payments/webhook`, express.raw({ type: 'application/json' }), async (req, res) => {
  if (!razorpay) {
    return res.status(503).json({ error: 'payment_service_unavailable' });
  }
  
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

    if (!webhookSecret) {
      console.warn('Webhook secret not configured');
      return res.status(400).json({ error: 'webhook_not_configured' });
    }

    // Verify webhook signature
    const text = req.body.toString();
    const generated_signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(text)
      .digest('hex');

    if (generated_signature !== signature) {
      return res.status(400).json({ error: 'invalid_signature' });
    }

    const event = JSON.parse(text);
    const { event: eventType, payload } = event;

    // Handle different payment events
    if (eventType === 'payment.captured') {
      const { payment } = payload.payment.entity;
      const bookingId = payment.notes?.booking_id;

      if (bookingId) {
        const booking = await Booking.findById(bookingId);
        if (booking) {
          booking.payment_status = 'paid';
          booking.payment_id = payment.id;
          booking.status = 'confirmed';
          await booking.save();
        }
      }
    } else if (eventType === 'payment.failed') {
      const { payment } = payload.payment.entity;
      const bookingId = payment.notes?.booking_id;

      if (bookingId) {
        const booking = await Booking.findById(bookingId);
        if (booking) {
          booking.payment_status = 'pending';
          await booking.save();
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'webhook_error' });
  }
});

// Create notification endpoint
app.post(`${apiBase}/notifications`, async (req, res) => {
  try {
    const notification = await Notification.create(req.body);
    res.json({ success: true, id: notification._id });
  } catch (err) {
    console.error('Create notification error:', err);
    res.status(500).json({ error: 'create_notification_error' });
  }
});

// Get notifications (admin can see all, customers can see their own)
app.get(`${apiBase}/notifications`, async (req, res) => {
  try {
    const { userId, type, status, user_id } = req.query;
    const filter = {};
    
    // If userId/user_id provided, filter by it (for customers)
    if (userId) filter.user_id = userId;
    if (user_id) filter.user_id = user_id;
    
    // If no userId provided and not admin, require authentication
    const adminKey = req.headers['x-admin-key'];
    const isAdmin = adminKey && adminKey === process.env.ADMIN_KEY;
    
    if (!isAdmin && !filter.user_id) {
      return res.status(400).json({ error: 'user_id_required' });
    }
    
    if (type) filter.type = type;
    if (status) filter.status = status;
    
    const notifications = await Notification.find(filter)
      .populate('user_id', 'full_name phone email')
      .sort({ created_at: -1 })
      .limit(100);
    res.json(notifications);
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'get_notifications_error' });
  }
});

// Slot Management Endpoints
app.get(`${apiBase}/slots`, async (req, res) => {
  try {
    const { serviceId, date } = req.query;
    const filter = {};
    if (serviceId) filter.service_id = serviceId;
    if (date) {
      const dateObj = new Date(date);
      filter.date = { 
        $gte: new Date(dateObj.setHours(0, 0, 0, 0)), 
        $lt: new Date(dateObj.setHours(23, 59, 59, 999)) 
      };
    }
    const slots = await Slot.find(filter)
      .populate('service_id', 'name')
      .sort({ date: 1, time_slot: 1 });
    res.json(slots);
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ error: 'get_slots_error' });
  }
});

app.post(`${apiBase}/slots`, requireAdmin, async (req, res) => {
  try {
    const { service_id, date, time_slot, total_capacity } = req.body;
    if (!service_id || !date || !time_slot) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }
    const slot = await Slot.create({ service_id, date, time_slot, total_capacity: total_capacity || 1 });
    res.json(slot);
  } catch (err) {
    console.error('Create slot error:', err);
    res.status(500).json({ error: 'create_slot_error' });
  }
});

app.patch(`${apiBase}/slots/:id`, requireAdmin, async (req, res) => {
  try {
    const slot = await Slot.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!slot) return res.status(404).json({ error: 'not_found' });
    res.json(slot);
  } catch (err) {
    console.error('Update slot error:', err);
    res.status(500).json({ error: 'update_slot_error' });
  }
});

// Analytics endpoint for admin dashboard
app.get(`${apiBase}/analytics`, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.created_at = {};
      if (startDate) dateFilter.created_at.$gte = new Date(startDate);
      if (endDate) dateFilter.created_at.$lte = new Date(endDate);
    }

    const [
      totalBookings,
      completedBookings,
      pendingBookings,
      cancelledBookings,
      totalRevenue,
      bookingsByStatus,
      bookingsByService,
      workerPerformance,
    ] = await Promise.all([
      Booking.countDocuments(dateFilter),
      Booking.countDocuments({ ...dateFilter, status: 'completed' }),
      Booking.countDocuments({ ...dateFilter, status: 'pending' }),
      Booking.countDocuments({ ...dateFilter, status: 'cancelled' }),
      Booking.aggregate([
        { $match: { ...dateFilter, payment_status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$total_price' } } },
      ]),
      Booking.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$service_id', count: { $sum: 1 }, revenue: { $sum: '$total_price' } } },
        { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'service' } },
        { $unwind: '$service' },
        { $project: { serviceName: '$service.name', count: 1, revenue: 1 } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Booking.aggregate([
        { $match: { ...dateFilter, employee_id: { $exists: true }, status: 'completed' } },
        { $group: { _id: '$employee_id', completedJobs: { $sum: 1 }, totalRevenue: { $sum: '$total_price' } } },
        { $lookup: { from: 'profiles', localField: '_id', foreignField: '_id', as: 'worker' } },
        { $unwind: '$worker' },
        { $project: { workerName: '$worker.full_name', completedJobs: 1, totalRevenue: 1 } },
        { $sort: { completedJobs: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.json({
      overview: {
        totalBookings,
        completedBookings,
        pendingBookings,
        cancelledBookings,
        totalRevenue: totalRevenue[0]?.total || 0,
        completionRate: totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(1) : 0,
        cancellationRate: totalBookings > 0 ? ((cancelledBookings / totalBookings) * 100).toFixed(1) : 0,
      },
      bookingsByStatus: bookingsByStatus.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      topServices: bookingsByService,
      topWorkers: workerPerformance,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'analytics_error' });
  }
});

// Error logging endpoint
app.post(`${apiBase}/errors`, async (req, res) => {
  try {
    // In production, you'd want to log to a service like Sentry, LogRocket, etc.
    console.error('Client Error:', {
      ...req.body,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error logging failed:', err);
    res.status(500).json({ error: 'logging_failed' });
  }
});

// Wallet Management Endpoints
// Get wallet transactions
app.get(`${apiBase}/wallet/transactions`, requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.query;
    const filter = {};
    if (user_id) filter.user_id = user_id;

    const transactions = await WalletTransaction.find(filter)
      .populate('user_id', 'full_name phone email')
      .populate('booking_id', 'booking_date service_id')
      .sort({ created_at: -1 });

    res.json(transactions);
  } catch (err) {
    console.error('Get wallet transactions error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Add wallet transaction (admin only)
app.post(`${apiBase}/wallet/transactions`, requireAdmin, async (req, res) => {
  try {
    const { user_id, amount, transaction_type, description, booking_id } = req.body;

    if (!user_id || !amount || !transaction_type || !description) {
      return res.status(400).json({ error: 'validation_failed', message: 'Missing required fields' });
    }

    if (!['credit', 'debit', 'refund'].includes(transaction_type)) {
      return res.status(400).json({ error: 'validation_failed', message: 'Invalid transaction type' });
    }

    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'validation_failed', message: 'Invalid amount' });
    }

    // Get user profile
    const profile = await Profile.findById(user_id);
    if (!profile) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Calculate new balance
    let newBalance = profile.wallet_balance || 0;
    if (transaction_type === 'credit') {
      newBalance += amountNum;
    } else if (transaction_type === 'debit' || transaction_type === 'refund') {
      newBalance -= amountNum;
      if (newBalance < 0) {
        return res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient wallet balance' });
      }
    }

    // Create transaction
    const transaction = await WalletTransaction.create({
      user_id,
      amount: amountNum,
      transaction_type,
      description: sanitizeInput(description),
      booking_id: booking_id || undefined,
    });

    // Update user wallet balance
    await Profile.findByIdAndUpdate(user_id, { wallet_balance: newBalance });

    // Populate and return
    const populatedTransaction = await WalletTransaction.findById(transaction._id)
      .populate('user_id', 'full_name phone email')
      .populate('booking_id', 'booking_date service_id');

    res.json(populatedTransaction);
  } catch (err) {
    console.error('Add wallet transaction error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Serviceability Areas Management - ALL routes must be before error handler
// Get all serviceability areas (public - only active areas)
app.get(`${apiBase}/serviceability-areas/public`, async (req, res) => {
  try {
    const areas = await ServiceabilityArea.find({ is_active: true }).sort({ city: 1 });
    res.json(areas);
  } catch (err) {
    console.error('Get public serviceability areas error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Get all serviceability areas (admin only - includes inactive)
app.get(`${apiBase}/serviceability-areas`, requireAdmin, async (req, res) => {
  try {
    const areas = await ServiceabilityArea.find().sort({ city: 1 });
    res.json(areas);
  } catch (err) {
    console.error('Get serviceability areas error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Create serviceability area
app.post(`${apiBase}/serviceability-areas`, requireAdmin, async (req, res) => {
  try {
    const { city, pincodes, is_active } = req.body;

    if (!city || !Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ error: 'validation_failed', message: 'City and at least one pincode are required' });
    }

    // Validate pincodes are 6 digits
    const validPincodes = pincodes.filter((p) => /^\d{6}$/.test(String(p).trim()));
    if (validPincodes.length === 0) {
      return res.status(400).json({ error: 'validation_failed', message: 'At least one valid 6-digit pincode is required' });
    }

    // Check if city already exists
    const existing = await ServiceabilityArea.findOne({ city: sanitizeInput(city.trim()) });
    if (existing) {
      return res.status(400).json({ error: 'duplicate', message: 'This city already exists' });
    }

    const area = await ServiceabilityArea.create({
      city: sanitizeInput(city.trim()),
      pincodes: validPincodes.map((p) => String(p).trim()),
      is_active: is_active !== undefined ? is_active : true,
    });

    res.json(area);
  } catch (err) {
    console.error('Create serviceability area error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'duplicate', message: 'This city already exists' });
    }
    res.status(500).json({ error: 'server_error' });
  }
});

// Update serviceability area
app.patch(`${apiBase}/serviceability-areas/:id`, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { city, pincodes, is_active } = req.body;

    const area = await ServiceabilityArea.findById(id);
    if (!area) {
      return res.status(404).json({ error: 'not_found' });
    }

    const updateData = {};
    if (city !== undefined) {
      updateData.city = sanitizeInput(city.trim());
      // Check for duplicate city if changing
      if (updateData.city !== area.city) {
        const existing = await ServiceabilityArea.findOne({ city: updateData.city });
        if (existing) {
          return res.status(400).json({ error: 'duplicate', message: 'This city already exists' });
        }
      }
    }
    if (pincodes !== undefined) {
      if (!Array.isArray(pincodes) || pincodes.length === 0) {
        return res.status(400).json({ error: 'validation_failed', message: 'At least one pincode is required' });
      }
      const validPincodes = pincodes.filter((p) => /^\d{6}$/.test(String(p).trim()));
      if (validPincodes.length === 0) {
        return res.status(400).json({ error: 'validation_failed', message: 'At least one valid 6-digit pincode is required' });
      }
      updateData.pincodes = validPincodes.map((p) => String(p).trim());
    }
    if (is_active !== undefined) {
      updateData.is_active = is_active;
    }

    const updated = await ServiceabilityArea.findByIdAndUpdate(id, updateData, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('Update serviceability area error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'duplicate', message: 'This city already exists' });
    }
    res.status(500).json({ error: 'server_error' });
  }
});

// Delete serviceability area
app.delete(`${apiBase}/serviceability-areas/:id`, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const area = await ServiceabilityArea.findByIdAndDelete(id);
    if (!area) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ success: true, message: 'Serviceability area deleted successfully' });
  } catch (err) {
    console.error('Delete serviceability area error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Global error handler - MUST be after all routes but before 404 handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'internal_server_error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  });
});

// 404 handler - MUST be last, after all routes and error handler
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `Route ${req.path} not found` });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`🚀 API server running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  if (!process.env.RAZORPAY_KEY_ID) {
    console.log(`⚠️  Razorpay not configured - payment features disabled`);
  }
});

