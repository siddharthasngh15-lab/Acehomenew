/**
 * SEED DATA TEMPLATE
 * 
 * Copy this file and replace the data with your actual services, categories, etc.
 * Then update server/seed.js to import from your data file.
 * 
 * OR simply edit the arrays directly in server/seed.js
 */

export const seedCategories = [
  {
    name: 'Category Name',
    slug: 'category-slug', // URL-friendly, lowercase, hyphens
    description: 'Category description',
    icon: '🎯', // Emoji or icon name
    is_active: true,
    sort_order: 1, // Display order (lower = first)
  },
  // Add more categories...
];

export const seedServices = [
  {
    name: 'Service Name',
    slug: 'service-slug', // URL-friendly, lowercase, hyphens
    category_slug: 'category-slug', // Must match a category slug above
    description: 'Service description',
    base_price: 500, // Base price in rupees
    image_url: 'https://example.com/image.jpg', // Service image URL
    faqs: [ // Optional
      {
        question: 'FAQ Question?',
        answer: 'FAQ Answer',
      },
    ],
  },
  // Add more services...
];

export const seedAddons = [
  {
    service_slug: 'service-slug', // Must match a service slug above
    name: 'Addon Name',
    description: 'Addon description',
    price: 100, // Additional price in rupees
  },
  // Add more addons...
];

export const seedPromoCodes = [
  {
    code: 'PROMOCODE', // Uppercase code
    discount_type: 'percentage', // or 'flat'
    discount_value: 10, // 10% or ₹10
    max_discount: 500, // Optional: max discount for percentage
    min_order_value: 1000, // Minimum order to use this code
    is_active: true,
    valid_until: new Date('2025-12-31'), // Expiry date
  },
  // Add more promo codes...
];

