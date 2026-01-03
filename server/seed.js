import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Import models (same as index.js)
const baseOptions = { timestamps: true };

const ProfileSchema = new mongoose.Schema(
  {
    phone: { type: String, unique: true, required: true },
    full_name: { type: String, required: true },
    email: { type: String },
    role: { type: String, default: 'customer' },
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

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, unique: true, required: true },
    description: { type: String },
    icon: { type: String },
    is_active: { type: Boolean, default: true },
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
    is_active: { type: Boolean, default: true },
    faqs: [{ question: String, answer: String }],
    image_url: { type: String },
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

const PromoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true },
    discount_type: { type: String, enum: ['percentage', 'flat'], default: 'flat' },
    discount_value: { type: Number, default: 0 },
    max_discount: { type: Number },
    min_order_value: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    valid_until: { type: Date },
  },
  baseOptions
);

const Profile = mongoose.model('Profile', ProfileSchema);
const Category = mongoose.model('Category', CategorySchema);
const Service = mongoose.model('Service', ServiceSchema);
const ServiceAddon = mongoose.model('ServiceAddon', ServiceAddonSchema);
const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);

// ============================================
// SEED DATA - Replace with your actual data
// ============================================

const seedCategories = [
  {
    name: 'AC Services',
    slug: 'ac-services',
    description: 'Professional AC installation, repair, deep cleaning, and gas filling services',
    icon: '❄️',
    is_active: true,
    sort_order: 1,
  },
  {
    name: 'Home Cleaning',
    slug: 'home-cleaning',
    description: 'Deep cleaning, bathroom cleaning, kitchen cleaning, and specialized cleaning services',
    icon: '🧹',
    is_active: true,
    sort_order: 2,
  },
  {
    name: 'Electrical',
    slug: 'electrical',
    description: 'Electrical repairs, installation, wiring, and safety checks',
    icon: '⚡',
    is_active: true,
    sort_order: 3,
  },
  {
    name: 'Air Cooler',
    slug: 'air-cooler',
    description: 'Air cooler repair and maintenance services',
    icon: '🌀',
    is_active: true,
    sort_order: 4,
  },
  {
    name: 'Carpenter Work',
    slug: 'carpenter-work',
    description: 'Furniture repair, assembly, installation, and all carpentry services',
    icon: '🪚',
    is_active: true,
    sort_order: 5,
  },
  {
    name: 'Home Painting',
    slug: 'home-painting',
    description: 'Professional home painting, door polishing, and emulsion paint services',
    icon: '🎨',
    is_active: true,
    sort_order: 6,
  },
  {
    name: 'Water Tank Cleaning',
    slug: 'water-tank-cleaning',
    description: 'Water tank cleaning and sanitization services for apartments and homes',
    icon: '💧',
    is_active: true,
    sort_order: 7,
  },
];

const seedServices = [
  // AC Services
  {
    name: 'AC General Repair',
    slug: 'ac-general-repair',
    category_slug: 'ac-services',
    description: 'Expert AC repair services for all brands and models. Fixing all AC issues including compressor problems, electrical faults, and more.',
    base_price: 500,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
    faqs: [
      {
        question: 'What AC issues do you repair?',
        answer: 'We repair all AC issues including gas leakage, compressor problems, electrical faults, water leakage, and more.',
      },
    ],
  },
  {
    name: 'Chemical AC Deep Cleaning',
    slug: 'chemical-ac-deep-cleaning',
    category_slug: 'ac-services',
    description: 'Professional chemical deep cleaning for AC units with sanitization',
    base_price: 1000,
    image_url: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800',
  },
  {
    name: 'Deep Clean Window AC',
    slug: 'deep-clean-window-ac',
    category_slug: 'ac-services',
    description: 'Comprehensive deep cleaning for window AC units',
    base_price: 800,
    image_url: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800',
  },
  {
    name: 'Split AC Deep Cleaning',
    slug: 'split-ac-deep-cleaning',
    category_slug: 'ac-services',
    description: 'Thorough deep cleaning for split AC units including indoor and outdoor units',
    base_price: 1200,
    image_url: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800',
  },
  {
    name: 'Split AC Gas Filling',
    slug: 'split-ac-gas-filling',
    category_slug: 'ac-services',
    description: 'Professional gas filling service for split AC units',
    base_price: 1500,
    image_url: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
  },
  {
    name: 'Split AC Installation',
    slug: 'split-ac-installation',
    category_slug: 'ac-services',
    description: 'Professional split AC installation with warranty and free consultation',
    base_price: 2500,
    image_url: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
  },
  {
    name: 'Split AC Uninstallation',
    slug: 'split-ac-uninstallation',
    category_slug: 'ac-services',
    description: 'Safe and professional split AC uninstallation service',
    base_price: 800,
    image_url: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
  },
  {
    name: 'Window AC Gas Filling',
    slug: 'window-ac-gas-filling',
    category_slug: 'ac-services',
    description: 'Professional gas filling service for window AC units',
    base_price: 1200,
    image_url: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
  },
  {
    name: 'Window AC Installation',
    slug: 'window-ac-installation',
    category_slug: 'ac-services',
    description: 'Professional window AC installation with warranty',
    base_price: 2000,
    image_url: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
  },
  {
    name: 'Window AC Uninstallation',
    slug: 'window-ac-uninstallation',
    category_slug: 'ac-services',
    description: 'Safe and professional window AC uninstallation service',
    base_price: 600,
    image_url: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
  },
  // Home Cleaning
  {
    name: 'Bathroom Cleaning',
    slug: 'bathroom-cleaning',
    category_slug: 'home-cleaning',
    description: 'Professional bathroom deep cleaning and sanitization',
    base_price: 400,
    image_url: 'https://images.unsplash.com/photo-1628177142898-93e36e4e3a50?w=800',
  },
  {
    name: 'Apartment Deep Cleaning',
    slug: 'apartment-deep-cleaning',
    category_slug: 'home-cleaning',
    description: 'Comprehensive deep cleaning for entire apartment',
    base_price: 2000,
    image_url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
  },
  {
    name: 'Kitchen Cleaning',
    slug: 'kitchen-cleaning',
    category_slug: 'home-cleaning',
    description: 'Thorough kitchen cleaning including appliances, cabinets, and exhaust',
    base_price: 600,
    image_url: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800',
  },
  {
    name: 'Mini Service',
    slug: 'mini-service',
    category_slug: 'home-cleaning',
    description: 'Quick cleaning service for small areas or specific rooms',
    base_price: 300,
    image_url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
  },
  {
    name: 'Refrigerator Cleaning',
    slug: 'refrigerator-cleaning',
    category_slug: 'home-cleaning',
    description: 'Deep cleaning and sanitization of refrigerator inside and outside',
    base_price: 500,
    image_url: 'https://images.unsplash.com/photo-1571171637578-41bc2dd41cd2?w=800',
  },
  {
    name: 'Sofa & Carpet Cleaning',
    slug: 'sofa-carpet-cleaning',
    category_slug: 'home-cleaning',
    description: 'Professional sofa and carpet deep cleaning with shampooing',
    base_price: 800,
    image_url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
  },
  {
    name: 'Villa Deep Cleaning',
    slug: 'villa-deep-cleaning',
    category_slug: 'home-cleaning',
    description: 'Comprehensive deep cleaning for entire villa',
    base_price: 3500,
    image_url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
  },
  // Electrical Services
  {
    name: 'Exhaust Installation',
    slug: 'exhaust-installation',
    category_slug: 'electrical',
    description: 'Professional exhaust fan installation service',
    base_price: 600,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Fan Installation',
    slug: 'fan-installation',
    category_slug: 'electrical',
    description: 'Professional ceiling fan installation service',
    base_price: 500,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Fan Repair',
    slug: 'fan-repair',
    category_slug: 'electrical',
    description: 'Expert fan repair services for all types of fans',
    base_price: 300,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Socket Replacement',
    slug: 'socket-replacement',
    category_slug: 'electrical',
    description: 'Professional socket replacement service',
    base_price: 200,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Switch Board Repair',
    slug: 'switch-board-repair',
    category_slug: 'electrical',
    description: 'Professional switch board repair and maintenance',
    base_price: 400,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Switch Replacement',
    slug: 'switch-replacement',
    category_slug: 'electrical',
    description: 'Professional switch replacement service',
    base_price: 150,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Tube Light Installation / Repair',
    slug: 'tube-light-installation-repair',
    category_slug: 'electrical',
    description: 'Professional tube light installation and repair service',
    base_price: 250,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Door Bell Installation',
    slug: 'door-bell-installation',
    category_slug: 'electrical',
    description: 'Professional door bell installation service',
    base_price: 300,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Bulb Installation / Replacement',
    slug: 'bulb-installation-replacement',
    category_slug: 'electrical',
    description: 'Professional bulb installation and replacement service',
    base_price: 100,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Electrical Wiring',
    slug: 'electrical-wiring',
    category_slug: 'electrical',
    description: 'Safe and professional electrical wiring installation and repair',
    base_price: 800,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  // Air Cooler
  {
    name: 'Air Cooler Repair',
    slug: 'air-cooler-repair',
    category_slug: 'air-cooler',
    description: 'Expert air cooler repair services for all brands',
    base_price: 400,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  // Carpenter Work
  {
    name: 'Bed Leg/Headboard Repair',
    slug: 'bed-leg-headboard-repair',
    category_slug: 'carpenter-work',
    description: 'Professional bed leg and headboard repair service',
    base_price: 400,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Bed Support Repair',
    slug: 'bed-support-repair',
    category_slug: 'carpenter-work',
    description: 'Professional bed support repair and reinforcement',
    base_price: 500,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Ceiling Mounted Hanger Installation',
    slug: 'ceiling-mounted-hanger-installation',
    category_slug: 'carpenter-work',
    description: 'Professional ceiling mounted hanger installation',
    base_price: 300,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Channel Repair',
    slug: 'channel-repair',
    category_slug: 'carpenter-work',
    description: 'Professional channel repair and replacement service',
    base_price: 400,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Cupboard Hinge Service',
    slug: 'cupboard-hinge-service',
    category_slug: 'carpenter-work',
    description: 'Professional cupboard hinge repair and replacement',
    base_price: 200,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Sofa Repair',
    slug: 'sofa-repair',
    category_slug: 'carpenter-work',
    description: 'Professional sofa repair service in Gorakhpur',
    base_price: 600,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Wall/Door Hanger Installation',
    slug: 'wall-door-hanger-installation',
    category_slug: 'carpenter-work',
    description: 'Professional wall and door hanger installation',
    base_price: 250,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'All Types Door Repair',
    slug: 'all-types-door-repair',
    category_slug: 'carpenter-work',
    description: 'Professional repair service for all types of doors',
    base_price: 500,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Balcony Hanger Installation',
    slug: 'balcony-hanger-installation',
    category_slug: 'carpenter-work',
    description: 'Professional balcony hanger installation service',
    base_price: 350,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Bed & Sofa Repair',
    slug: 'bed-sofa-repair',
    category_slug: 'carpenter-work',
    description: 'Professional bed and sofa repair services',
    base_price: 600,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Cupboard & Drawer Repair',
    slug: 'cupboard-drawer-repair',
    category_slug: 'carpenter-work',
    description: 'Professional cupboard and drawer repair service',
    base_price: 400,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Drill & Hang Service',
    slug: 'drill-hang-service',
    category_slug: 'carpenter-work',
    description: 'Professional drilling and hanging service for pictures, frames, and fixtures',
    base_price: 200,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Furniture Assembly',
    slug: 'furniture-assembly',
    category_slug: 'carpenter-work',
    description: 'Professional furniture assembly service',
    base_price: 500,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Furniture Repair',
    slug: 'furniture-repair',
    category_slug: 'carpenter-work',
    description: 'Professional furniture repair service for all types of furniture',
    base_price: 600,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  // Home Painting
  {
    name: 'Door Polishing',
    slug: 'door-polishing',
    category_slug: 'home-painting',
    description: 'Professional door polishing and refinishing service',
    base_price: 800,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Tractor Emulsion Paint',
    slug: 'tractor-emulsion-paint',
    category_slug: 'home-painting',
    description: 'Professional tractor emulsion paint service for walls (per sq ft)',
    base_price: 15,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
    faqs: [
      {
        question: 'What is the pricing?',
        answer: 'Pricing is ₹15 per square foot. Minimum charge applies for small areas.',
      },
    ],
  },
  // Water Tank Cleaning
  {
    name: 'Water Tank Cleaning',
    slug: 'water-tank-cleaning',
    category_slug: 'water-tank-cleaning',
    description: 'Professional water tank cleaning and sanitization service',
    base_price: 1500,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
  {
    name: 'Apartment Tank Cleaning',
    slug: 'apartment-tank-cleaning',
    category_slug: 'water-tank-cleaning',
    description: 'Professional apartment water tank cleaning and sanitization',
    base_price: 2000,
    image_url: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800',
  },
];

const seedAddons = [
  {
    service_slug: 'split-ac-installation',
    name: 'Extended Warranty (1 Year)',
    description: 'Get 1 year extended warranty on installation',
    price: 500,
  },
  {
    service_slug: 'window-ac-installation',
    name: 'Extended Warranty (1 Year)',
    description: 'Get 1 year extended warranty on installation',
    price: 500,
  },
  {
    service_slug: 'chemical-ac-deep-cleaning',
    name: 'Sanitization Treatment',
    description: 'Additional sanitization treatment for better hygiene',
    price: 200,
  },
  {
    service_slug: 'split-ac-deep-cleaning',
    name: 'Sanitization Treatment',
    description: 'Additional sanitization treatment',
    price: 200,
  },
  {
    service_slug: 'deep-clean-window-ac',
    name: 'Sanitization Treatment',
    description: 'Additional sanitization treatment',
    price: 200,
  },
  {
    service_slug: 'apartment-deep-cleaning',
    name: 'Window Cleaning',
    description: 'Include window cleaning in the package',
    price: 300,
  },
  {
    service_slug: 'villa-deep-cleaning',
    name: 'Window Cleaning',
    description: 'Include window cleaning in the package',
    price: 500,
  },
  {
    service_slug: 'apartment-deep-cleaning',
    name: 'Carpet Cleaning',
    description: 'Deep carpet cleaning and shampooing',
    price: 500,
  },
  {
    service_slug: 'villa-deep-cleaning',
    name: 'Carpet Cleaning',
    description: 'Deep carpet cleaning and shampooing',
    price: 800,
  },
];

const seedPromoCodes = [
  {
    code: 'WELCOME10',
    discount_type: 'percentage',
    discount_value: 10,
    max_discount: 500,
    min_order_value: 1000,
    is_active: true,
    valid_until: new Date('2025-12-31'),
  },
  {
    code: 'FIRST50',
    discount_type: 'flat',
    discount_value: 50,
    min_order_value: 500,
    is_active: true,
    valid_until: new Date('2025-12-31'),
  },
  {
    code: 'CLEAN20',
    discount_type: 'percentage',
    discount_value: 20,
    max_discount: 1000,
    min_order_value: 2000,
    is_active: true,
    valid_until: new Date('2025-12-31'),
  },
];

const seedAdmin = {
  phone: '8707615444',
  full_name: 'Ace Home Solutions Admin',
  email: 'admin@acehomesolutions.com',
  role: 'admin',
  phone_verified: true,
  email_verified: true,
};

// ============================================
// SEED FUNCTIONS
// ============================================

const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('🗑️  Clearing existing data...');
    await Category.deleteMany({});
    await Service.deleteMany({});
    await ServiceAddon.deleteMany({});
    await PromoCode.deleteMany({});
    console.log('✅ Cleared existing data\n');

    // Seed Categories
    console.log('📁 Seeding categories...');
    const categories = await Category.insertMany(seedCategories);
    console.log(`✅ Created ${categories.length} categories\n`);

    // Create category map for services
    const categoryMap = {};
    categories.forEach((cat) => {
      categoryMap[cat.slug] = cat._id;
    });

    // Seed Services
    console.log('🔧 Seeding services...');
    const servicesToInsert = seedServices.map((service) => {
      const { category_slug, ...rest } = service;
      return {
        ...rest,
        category_id: categoryMap[category_slug],
      };
    });
    const services = await Service.insertMany(servicesToInsert);
    console.log(`✅ Created ${services.length} services\n`);

    // Create service map for addons
    const serviceMap = {};
    services.forEach((svc) => {
      serviceMap[svc.slug] = svc._id;
    });

    // Seed Addons
    console.log('➕ Seeding service addons...');
    const addonsToInsert = seedAddons
      .map((addon) => ({
        ...addon,
        service_id: serviceMap[addon.service_slug],
      }))
      .filter((addon) => addon.service_id) // Only addons with valid service
      .map(({ service_slug, ...rest }) => rest);
    const addons = await ServiceAddon.insertMany(addonsToInsert);
    console.log(`✅ Created ${addons.length} addons\n`);

    // Seed Promo Codes
    console.log('🎟️  Seeding promo codes...');
    const promos = await PromoCode.insertMany(seedPromoCodes);
    console.log(`✅ Created ${promos.length} promo codes\n`);

    // Seed Admin User (if doesn't exist)
    console.log('👤 Seeding admin user...');
    const existingAdmin = await Profile.findOne({ phone: seedAdmin.phone });
    if (!existingAdmin) {
      await Profile.create(seedAdmin);
      console.log('✅ Created admin user\n');
    } else {
      console.log('ℹ️  Admin user already exists\n');
    }

    console.log('🎉 Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - Categories: ${categories.length}`);
    console.log(`   - Services: ${services.length}`);
    console.log(`   - Addons: ${addons.length}`);
    console.log(`   - Promo Codes: ${promos.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

// Run seed
seedDatabase();

