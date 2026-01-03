# ACEhome-Backend

Backend API server for ACE Home Solutions platform built with Node.js, Express, and MongoDB.

## 🚀 Features

- RESTful API for service management
- MongoDB database integration
- Worker assignment and management
- Booking management with status tracking
- Employee workflow (accept, reach, start, complete)
- Partner assignment for jobs
- Photo upload (before/after job completion)
- Analytics and reporting
- Rate limiting and security
- Razorpay payment integration
- OTP-based authentication
- SMS and Email notifications

## 📋 Prerequisites

- Node.js 18+ and npm
- MongoDB Atlas account (or local MongoDB)
- Razorpay account (optional, for payments)

## 🛠️ Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Siddhartha-Kum/ACEhome-Backend.git
cd ACEhome-Backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```env
# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database

# Server Configuration
PORT=4000
ADMIN_KEY=your-secure-admin-key-here

# Razorpay Payment Gateway (Get from https://razorpay.com)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret  # Optional, for webhook verification

# Environment
NODE_ENV=development
```

### 4. Start the server

```bash
npm run server
```

The server will start on `http://localhost:4000`

## 📁 Project Structure

```
ACEhome-Backend/
├── server/
│   ├── index.js           # Main server file
│   ├── middleware/        # Custom middleware
│   │   └── logger.js     # Request logging
│   ├── seed.js           # Database seeding script
│   └── seed-data-template.js  # Seed data template
└── package.json          # Dependencies
```

## 🔑 API Endpoints

### Public Endpoints
- `GET /api/health` - Health check
- `GET /api/categories` - Get all categories
- `GET /api/services` - Get services (with filters)
- `GET /api/services/:slug` - Get service details
- `GET /api/reviews` - Get reviews
- `POST /api/auth/request-otp` - Request OTP
- `POST /api/auth/verify-otp` - Verify OTP and login
- `POST /api/bookings` - Create booking
- `POST /api/notify-me` - Notify me for unavailable services

### Protected Endpoints (Require Admin Key)
- `POST /api/categories` - Create category
- `PATCH /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category
- `POST /api/services` - Create service
- `PATCH /api/services/:id` - Update service
- `DELETE /api/services/:id` - Delete service
- `GET /api/bookings/:id/eligible-workers` - Get eligible workers
- `PATCH /api/bookings/:id/assign` - Assign worker
- `PATCH /api/bookings/:id/auto-assign` - Auto-assign worker
- `GET /api/analytics` - Get analytics data

### Employee Endpoints
- `POST /api/bookings/:id/accept` - Accept booking assignment
- `POST /api/bookings/:id/mark-reached` - Mark as reached location
- `POST /api/bookings/:id/start-work` - Start work
- `POST /api/bookings/:id/complete` - Complete job with photos
- `POST /api/bookings/:id/add-partner` - Add partner to job

## 🔐 Authentication

The API uses OTP-based authentication:
1. Request OTP: `POST /api/auth/request-otp` with phone number
2. Verify OTP: `POST /api/auth/verify-otp` with phone and OTP code

Admin endpoints require the `X-Admin-Key` header with your admin key.

## 🚢 Deployment

### Railway/Render/Heroku

1. Set environment variables:
   - `MONGODB_URI`: Your MongoDB connection string
   - `PORT`: Server port (usually auto-set by platform)
   - `ADMIN_KEY`: Your admin key
   - `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: For payments

2. Deploy the `server` folder

3. The platform will automatically run `npm run server`

## 🐛 Troubleshooting

### MongoDB Connection Issues
- Verify your MongoDB URI is correct
- Check if your IP is whitelisted in MongoDB Atlas
- Ensure network access is enabled

### Rate Limiting
- Profile GET requests: 100 per minute
- General API: 100 per 15 minutes
- Auth endpoints: 10 per 15 minutes

## 📄 License

Private - All rights reserved

## 👥 Support

For issues or questions, please contact the development team.
