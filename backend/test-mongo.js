require('dotenv').config();
const mongoose = require('mongoose');

mongoose
    .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => {
        console.log('✅ MongoDB connected:', mongoose.connection.name);
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ MongoDB failed:', err.message);
        process.exit(1);
    });