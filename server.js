// server.js

// Load environment variables from the .env file
// In a production environment, these variables are provided by the hosting service.
require('dotenv').config();

// Import necessary modules
const express = require('express');
const http = require('http');
const cors = require('cors'); 
const { Server } = require("socket.io");
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); 

// Create the Express app and HTTP server
const app = express();

// Enable CORS for all routes
// In a deployed app, you might want to restrict this to your frontend URL
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Added OPTIONS for preflight requests
  credentials: true
}));

app.use(express.json({ limit: '50mb' })); // Increased limit for image data

const server = http.createServer(app);

// Initialize Socket.io and enable CORS for the client
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// Create a connection pool for the PostgreSQL database
// The environment variables will be provided by Railway
const pool = new Pool({
  user: process.env.DB_USER, // Using DB_USER as per previous context
  host: process.env.DB_HOST, // Using DB_HOST as per previous context
  database: process.env.DB_DATABASE, // Using DB_DATABASE as per previous context
  password: process.env.DB_PASSWORD, // Using DB_PASSWORD as per previous context
  port: process.env.DB_PORT, // Using DB_PORT as per previous context
  ssl: {
    rejectUnauthorized: false // This is often needed for Railway's managed Postgres
  }
});

// Simple root route to check if the server is running
app.get('/', (req, res) => {
  res.send('<h1>Real-time chat server is running!</h1>');
});

// User registration endpoint with name field support
app.post('/register', async (req, res) => {
  const { username, password, name } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    const query = 'INSERT INTO users(username, password_hash, name) VALUES($1, $2, $3) RETURNING id, username, name';
    const values = [username, passwordHash, name || username];
    
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login endpoint to return name as well
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    const userQuery = 'SELECT * FROM users WHERE username = $1';
    const userResult = await pool.query(userQuery, [username]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (isMatch) {
      const updateQuery = 'UPDATE users SET last_login = NOW() WHERE id = $1';
      await pool.query(updateQuery, [user.id]);
      
      return res.json({ 
        id: user.id, 
        username: user.username,
        name: user.name || user.username
      });
    } else {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint for adding a friend
app.post('/add-friend', async (req, res) => {
    const { userId, friendUsername } = req.body;

    if (!userId || !friendUsername) {
        return res.status(400).json({ error: 'User ID and friend username are required' });
    }

    try {
        const friendQuery = 'SELECT id FROM users WHERE username = $1';
        const friendResult = await pool.query(friendQuery, [friendUsername]);
        const friend = friendResult.rows[0];

        if (!friend) {
            return res.status(404).json({ error: 'Friend username not found' });
        }

        const friendId = friend.id;

        // Check if friendship already exists
        const checkQuery = 'SELECT * FROM friendships WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)';
        const checkResult = await pool.query(checkQuery, [userId, friendId]);

        if (checkResult.rows.length > 0) {
            return res.status(409).json({ error: 'Friendship already exists' });
        }

        // Add friendship
        const insertQuery = 'INSERT INTO friendships (user1_id, user2_id) VALUES ($1, $2) RETURNING *';
        await pool.query(insertQuery, [userId, friendId]);

        res.status(201).json({ message: 'Friend added successfully' });
    } catch (err) {
        console.error('Error adding friend:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to get a user's friends
app.get('/friends/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const query = `
            SELECT 
                u.id, u.username, u.name 
            FROM users u
            JOIN friendships f ON (u.id = f.user1_id AND f.user2_id = $1) OR (u.id = f.user2_id AND f.user1_id = $1)
            WHERE u.id != $1
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching friends:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// New endpoint to get chat messages between two users
app.get('/messages/:userId/:friendId', async (req, res) => {
    const { userId, friendId } = req.params;
    
    try {
        // --- IMPORTANT: Select message_type and image_data here ---
        const query = `
            SELECT id, sender_id, receiver_id, content, message_type, image_data, created_at FROM messages
            WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query, [userId, friendId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Handle Socket.io connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('chat message', async (msg) => {
    console.log('Received message:', msg);
    
    // Validate required fields
    if (!msg.senderId || !msg.receiverId) {
        console.error('Message missing senderId or receiverId');
        return;
    }

    try {
      let query, values;
      // --- IMPORTANT FIX HERE: Conditionally insert content or image_data ---
      if (msg.messageType === 'image' && msg.imageData) {
          query = 'INSERT INTO messages(sender_id, receiver_id, message_type, image_data) VALUES($1, $2, $3, $4) RETURNING *';
          values = [msg.senderId, msg.receiverId, 'image', msg.imageData];
      } else {
          // Default to text message, ensure content is not null for text messages
          if (!msg.content) { // This check is still good for ensuring text messages have content
              console.error('Text message missing content');
              return;
          }
          query = 'INSERT INTO messages(sender_id, receiver_id, content, message_type) VALUES($1, $2, $3, $4) RETURNING *';
          values = [msg.senderId, msg.receiverId, msg.content, 'text'];
      }
      
      const result = await pool.query(query, values);
      const savedMessage = result.rows[0];
      
      // Emit the message back to all connected clients (or specific rooms for private chat)
      io.emit('chat message', savedMessage);
    } catch (err) {
      console.error('Error saving message to database:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
