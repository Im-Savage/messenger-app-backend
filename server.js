// server.js

// Load environment variables from the .env file
require('dotenv').config();

// Import necessary modules
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
const jwt = require('jsonwebtoken'); // Import jsonwebtoken for authentication
const cors = require('cors'); // <-- Import the cors middleware

// Create the Express app and HTTP server
const app = express();
app.use(express.json()); // Enable Express to parse JSON data from requests

// A more explicit CORS configuration to ensure it's applied correctly
app.use(cors({
    origin: '*', // Allow all origins to access the resources
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Include OPTIONS for preflight requests
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const server = http.createServer(app);

// Initialize Socket.io and enable CORS for the client
const io = new Server(server, {
  cors: {
    origin: "*", // Allows any origin to connect
    methods: ["GET", "POST"]
  }
});

// Check for required environment variables before creating the pool
// --- IMPORTANT CHANGE HERE: Using Railway's default PG_ variables ---
const dbConfig = {
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  // Add SSL for production environment if required by the hosting provider
  ssl: {
    rejectUnauthorized: false // This is often needed for Railway's managed Postgres
  }
};

// Log a warning if any database config is missing, as this will fail the deployment
for (const key in dbConfig) {
  if (!dbConfig[key]) {
    console.warn(`Missing environment variable for database: ${key}`);
  }
}

// Create a connection pool for the PostgreSQL database
const pool = new Pool(dbConfig);

// Function to generate a JWT token
const generateToken = (id, username) => {
  return jwt.sign({ id, username }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
};

// Simple root route to check if the server is running
app.get('/', (req, res) => {
  res.send('<h1>Real-time chat server is running!</h1>');
});

// New: User registration endpoint
app.post('/register', async (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username, and password are required' });
  }

  try {
    // Check if the username already exists
    const userExists = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert the new user into the database
    // --- IMPORTANT FIX HERE: Changed 'password' to 'password_hash' ---
    const query = 'INSERT INTO users(name, username, password_hash) VALUES($1, $2, $3) RETURNING id, name, username';
    const values = [name, username, hashedPassword];
    const result = await pool.query(query, values);

    // Respond with the new user's details (excluding password)
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New: User login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // --- IMPORTANT FIX HERE: Changed 'password' to 'password_hash' for login comparison ---
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userResult.rows[0];

    if (user && (await bcrypt.compare(password, user.password_hash))) { // Compare with password_hash
      // Update last_login timestamp
      const updateQuery = 'UPDATE users SET last_login = NOW() WHERE id = $1';
      await pool.query(updateQuery, [user.id]);
      
      // Generate a JWT token
      const token = generateToken(user.id, user.username);
      
      return res.json({ id: user.id, name: user.name, username: user.username, token });
    } else {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New: Endpoint to add a friend
app.post('/add-friend', async (req, res) => {
    const { userId, friendUsername } = req.body;

    if (!userId || !friendUsername) {
        return res.status(400).json({ error: 'userId and friendUsername are required' });
    }

    try {
        const friendResult = await pool.query('SELECT id FROM users WHERE username = $1', [friendUsername]);
        const friend = friendResult.rows[0];

        if (!friend) {
            return res.status(404).json({ error: 'User not found' });
        }

        const friendId = friend.id;

        // Check if friendship already exists
        // --- IMPORTANT FIX HERE: Changed 'user_id' and 'friend_id' to 'user1_id' and 'user2_id' ---
        const friendshipExists = await pool.query(
            'SELECT * FROM friendships WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
            [userId, friendId]
        );

        if (friendshipExists.rows.length > 0) {
            return res.status(400).json({ error: 'Friendship already exists' });
        }

        // Create a new friendship record
        // --- IMPORTANT FIX HERE: Changed 'user_id' and 'friend_id' to 'user1_id' and 'user2_id' ---
        await pool.query('INSERT INTO friendships (user1_id, user2_id) VALUES ($1, $2)', [userId, friendId]);

        res.status(200).json({ message: 'Friend added successfully' });
    } catch (err) {
        console.error('Error adding friend:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// New: Endpoint to get a list of friends for a user
app.get('/friends/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // --- IMPORTANT FIX HERE: Changed 'f.friend_id' and 'f.user_id' to 'f.user1_id' and 'f.user2_id' ---
        const friendsQuery = `
            SELECT 
                u.id, 
                u.name,
                u.username
            FROM users u
            JOIN friendships f ON (u.id = f.user1_id AND f.user2_id = $1) OR (u.id = f.user2_id AND f.user1_id = $1)
            WHERE u.id != $1;
        `;
        const result = await pool.query(friendsQuery, [userId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Error getting friends:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// New: Endpoint to get messages between two users
app.get('/messages/:user1Id/:user2Id', async (req, res) => {
    const { user1Id, user2Id } = req.params;

    try {
        const query = `
            SELECT * FROM messages 
            WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query, [user1Id, user2Id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Handle Socket.io connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Listen for a 'chat message' event from the client
  socket.on('chat message', async (msg) => {
    console.log('message: ' + msg.content);
    
    try {
      // Save the message to the database
      const query = 'INSERT INTO messages(sender_id, receiver_id, content) VALUES($1, $2, $3) RETURNING *';
      const values = [msg.senderId, msg.receiverId, msg.content];
      const result = await pool.query(query, values);
      
      // Broadcast the message to all connected clients, including the sender
      io.emit('chat message', result.rows[0]);
    } catch (err) {
      console.error('Error saving message to database:', err);
    }
  });

  // Listen for a 'disconnect' event
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start the server on the specified port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
