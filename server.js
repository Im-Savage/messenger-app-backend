// server.js

// Load environment variables from the .env file
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
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: {
    rejectUnauthorized: false
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
    console.error('Detailed error for /register:', err.stack || err);
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
    console.error('Detailed error for /login:', err.stack || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MODIFIED: Endpoint to send a friend request, now using gen_random_uuid()
app.post('/send-friend-request', async (req, res) => {
    const { senderId, receiverUsername } = req.body;

    if (!senderId || !receiverUsername) {
        return res.status(400).json({ error: 'Sender ID and receiver username are required' });
    }

    try {
        // Find the receiver's ID
        const receiverQuery = 'SELECT id FROM users WHERE username = $1';
        const receiverResult = await pool.query(receiverQuery, [receiverUsername]);
        const receiver = receiverResult.rows[0];

        if (!receiver) {
            return res.status(404).json({ error: 'Recipient username not found' });
        }

        const receiverId = receiver.id;

        if (senderId === receiverId) {
            return res.status(400).json({ error: 'You cannot send a friend request to yourself' });
        }

        // Check if a friendship already exists (accepted)
        const checkFriendshipQuery = 'SELECT * FROM friendships WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)';
        const friendshipResult = await pool.query(checkFriendshipQuery, [senderId, receiverId]);
        if (friendshipResult.rows.length > 0) {
            return res.status(409).json({ error: 'You are already friends with this user' });
        }

        // Check if a pending request already exists in either direction
        const checkRequestQuery = 'SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)';
        const requestResult = await pool.query(checkRequestQuery, [senderId, receiverId]);
        if (requestResult.rows.length > 0) {
            const existingRequest = requestResult.rows[0];
            if (existingRequest.status === 'pending') {
                if (existingRequest.sender_id === senderId) {
                    return res.status(409).json({ error: 'Friend request already sent to this user' });
                } else {
                    return res.status(409).json({ error: 'This user has already sent you a friend request. Please check your requests.' });
                }
            } else if (existingRequest.status === 'accepted') {
                return res.status(409).json({ error: 'You are already friends with this user' });
            }
        }

        // Insert the new friend request
        // The UUID will be generated automatically by the database
        const insertRequestQuery = 'INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES ($1, $2, \'pending\') RETURNING *';
        await pool.query(insertRequestQuery, [senderId, receiverId]);

        res.status(201).json({ message: 'Friend request sent successfully' });
    } catch (err) {
        console.error('Error sending friend request:', err);
        console.error('Detailed error for /send-friend-request:', err.stack || err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to get a user's friends (only accepted ones)
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
        console.error('Detailed error for /friends/:userId:', err.stack || err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// NEW: Endpoint to get pending friend requests for a user (where current user is the receiver)
app.get('/friend-requests/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const query = `
            SELECT fr.id AS request_id, fr.sender_id, u.username AS sender_username, u.name AS sender_name, fr.created_at
            FROM friend_requests fr
            JOIN users u ON fr.sender_id = u.id
            WHERE fr.receiver_id = $1 AND fr.status = 'pending'
            ORDER BY fr.created_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching friend requests:', err);
        console.error('Detailed error for /friend-requests/:userId:', err.stack || err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// NEW: Endpoint to accept a friend request
app.post('/accept-friend-request', async (req, res) => {
    const { requestId, userId } = req.body; // userId is the receiver_id

    if (!requestId || !userId) {
        return res.status(400).json({ error: 'Request ID and User ID are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get the request details
        const requestQuery = 'SELECT * FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = \'pending\'';
        const requestResult = await client.query(requestQuery, [requestId, userId]);
        const request = requestResult.rows[0];

        if (!request) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Friend request not found or already processed' });
        }

        const { sender_id, receiver_id } = request;

        // Update the friend request status to 'accepted'
        const updateRequestQuery = 'UPDATE friend_requests SET status = \'accepted\', updated_at = NOW() WHERE id = $1 RETURNING *';
        await client.query(updateRequestQuery, [requestId]);

        // Add both sides of the friendship to the friendships table
        const insertFriendship1Query = 'INSERT INTO friendships (user1_id, user2_id) VALUES ($1, $2) ON CONFLICT (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id)) DO NOTHING';
        await client.query(insertFriendship11Query, [sender_id, receiver_id]);
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'Friend request accepted successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error accepting friend request:', err);
        console.error('Detailed error for /accept-friend-request:', err.stack || err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// NEW: Endpoint to decline a friend request
app.post('/decline-friend-request', async (req, res) => {
    const { requestId, userId } = req.body; // userId is the receiver_id

    if (!requestId || !userId) {
        return res.status(400).json({ error: 'Request ID and User ID are required' });
    }

    try {
        const query = 'UPDATE friend_requests SET status = \'declined\', updated_at = NOW() WHERE id = $1 AND receiver_id = $2 AND status = \'pending\' RETURNING *';
        const result = await pool.query(query, [requestId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Friend request not found or already processed' });
        }

        res.status(200).json({ message: 'Friend request declined successfully' });
    } catch (err) {
        console.error('Error declining friend request:', err);
        console.error('Detailed error for /decline-friend-request:', err.stack || err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Endpoint to get chat messages between two users
app.get('/messages/:userId/:friendId', async (req, res) => {
    const { userId, friendId } = req.params;
    
    try {
        const query = `
            SELECT id, sender_id, receiver_id, content, message_type, image_data, created_at FROM messages
            WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query, [userId, friendId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching messages:', err);
        console.error('Detailed error for /messages/:userId/:friendId:', err.stack || err);
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
      if (msg.messageType === 'image' && msg.imageData) {
          query = 'INSERT INTO messages(sender_id, receiver_id, message_type, image_data) VALUES($1, $2, $3, $4) RETURNING *';
          values = [msg.senderId, msg.receiverId, 'image', msg.imageData];
      } else {
          if (!msg.content) {
              console.error('Text message missing content');
              return;
          }
          query = 'INSERT INTO messages(sender_id, receiver_id, content, message_type) VALUES($1, $2, $3, $4) RETURNING *';
          values = [msg.senderId, msg.receiverId, msg.content, 'text'];
      }
      
      const result = await pool.query(query, values);
      const savedMessage = result.rows[0];
      
      io.emit('chat message', savedMessage);
    } catch (err) {
      console.error('Error saving message to database:', err);
      console.error('Detailed error for chat message socket event:', err.stack || err);
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
