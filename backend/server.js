const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app = express();

// Environment and Port configuration
const PORT = process.env.PORT || 3000;

// Ensure MONGODB_URI is set
if (!process.env.MONGODB_URI) {
  console.error('FATAL ERROR: MONGODB_URI is not defined.');
  process.exit(1);
}

// MongoDB connection setup
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => console.error('MongoDB connection error:', error));

// Define a schema and model for prime data
const primeDataSchema = new mongoose.Schema({
  name: String,
  id: String,
  joiningDate: [String]
});
const PrimeData = mongoose.model('PrimeData', primeDataSchema);

// Security: Helmet to add security headers
app.use(helmet());

// Security: CORS with specified origin
const corsOptions = {
  origin: 'https://nimble-sunshine-294092.netlify.app/', // Replace with your actual frontend domain
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Security: Rate limiting to limit requests from the same IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per window
});
app.use(limiter);

// API to fetch data from MongoDB and serve frontend
app.get('/api/prime-data', async (req, res) => {
  try {
    const data = await PrimeData.find();

    // If no data in MongoDB, send a message
    if (data.length === 0) {
      return res.status(404).json({ message: 'No data found in the database' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching data from MongoDB:', error.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
