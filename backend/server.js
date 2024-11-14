const express = require('express');
const axios = require('axios');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { check, validationResult } = require('express-validator'); // For input validation

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure MONGODB_URI and API_KEY are set
if (!process.env.MONGODB_URI || !process.env.API_KEY || !process.env.SESSION_COOKIE) {
  console.error('FATAL ERROR: MONGODB_URI, API_KEY, or SESSION_COOKIE is not defined.');
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

// Define a schema and model for community data
const communityDataSchema = new mongoose.Schema({
  slug: String,
  countOfMembers: Number,
});
const CommunityData = mongoose.model('CommunityData', communityDataSchema);

// Security: Helmet to add security headers
app.use(helmet({
  contentSecurityPolicy: false // Disable if CSP is handled by another layer
}));

// Security: CORS with specified origin for production only
const corsOptions = {
  origin: ['https://nimble-sunshine-294092.netlify.app'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Security: Rate limiting to limit requests from the same IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Adjusted for added security
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Function to fetch initial data
async function fetchCommunityData(name, mtop_sec_key) {
  try {
    const response = await axios.get(`https://g91.tcsion.com/LX/lms_integration/enroll_community_course.json`, {
      params: {
        mtop_sec_key: mtop_sec_key,
        type: 'community',
        page: 1,
        name: name
      },
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching community data:', error);
    return [];
  }
}

// Function to fetch member data by slug
async function fetchMembersBySlug(slug) {
  let members = [];
  let page = 1;
  while (true) {
    const url = `https://g91.tcsion.com/LX/search/search_members?c_id=${slug}&req_type=api&page=${page}`;
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://g91.tcsion.com',
          'Cookie': process.env.SESSION_COOKIE
        }
      });
      
      if (response.data.length === 0) break;
      members = members.concat(response.data);
      page++;
    } catch (error) {
      if (error.response && error.response.status === 500) break;
      console.error(`Error fetching members for slug ${slug}:`, error);
      break;
    }
  }
  return members;
}

// Function to update onboarding data
async function updateOnboardingData(members, joiningDate) {
  for (const member of members) {
    const id = member.usrloginid;
    const existingRecord = await PrimeData.findOne({ id });
    if (existingRecord) {
      if (!existingRecord.joiningDate.includes(joiningDate)) {
        existingRecord.joiningDate.unshift(joiningDate);
        await existingRecord.save();
      }
    }
  }
}

// Function to process community data
async function processCommunityData(name, mtop_sec_key) {
  const communityDataNew = await fetchCommunityData(name, mtop_sec_key);

  for (const newEntry of communityDataNew) {
    const { slug, member_count, name } = newEntry;
    const existingEntry = await CommunityData.findOne({ slug });

    if (existingEntry) {
      if (existingEntry.countOfMembers !== member_count) {
        const members = await fetchMembersBySlug(slug);
        existingEntry.countOfMembers = member_count;
        await existingEntry.save();

        const joiningDate = name.split('- ')[1].split(' ').slice(0, 2).join(' ');
        updateOnboardingData(members, joiningDate);
      }
    } else {
      const members = await fetchMembersBySlug(slug);
      const newCommunityData = new CommunityData({ slug, countOfMembers: member_count });
      await newCommunityData.save();

      const joiningDate = name.split('- ')[1].split(' ').slice(0, 2).join(' ');
      updateOnboardingData(members, joiningDate);
    }
  }
}

// API to fetch data from MongoDB with update check
app.get('/api/prime-data', [
  check('date').optional().isString(),
  check('mtop_sec_key').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const referer = req.get('Referer');
  const allowedOrigin = 'https://nimble-sunshine-294092.netlify.app';
  const name = req.query.month;
  const mtop_sec_key = req.query.mtop_sec_key;

  if (!referer || !referer.startsWith(allowedOrigin)) {
    if (req.headers['x-api-key'] !== process.env.API_KEY) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
  }

  if (name) await processCommunityData(name, mtop_sec_key);

  try {
    const data = await PrimeData.find();
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
