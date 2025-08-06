import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Auth from './Auth';
import './App.css';

const App = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState('auth');
  const [friends, setFriends] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [friendUsername, setFriendUsername] = useState('');
  const [currentChatFriend, setCurrentChatFriend] = useState(null);

  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('currentUser');
    
    if (token && savedUser) {
      const user = JSON.parse(savedUser);
      setCurrentUser(user);
      setView('friends');

      // Initialize socket connection with the JWT token
      socketRef.current = io('http://localhost:5000', {
        query: { token },
      });

      socketRef.current.on('chat message', (msg) => {
        setMessages((prevMessages) => [...prevMessages, msg]);
      });

      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const fetchFriends = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/friends', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setFriends(data);
        } else {
          console.error('Failed to fetch friends');
          logOut();
        }
      } catch (error) {
        console.error('Error fetching friends:', error);
      }
    };

    fetchFriends();
  }, [currentUser]);

  const logOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
    setFriends([]);
    setMessages([]);
    setView('auth');
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  const handleLogin = (user) => {
    setCurrentUser(user);
    setView('friends');
    
    // Re-initialize socket connection after login
    const token = localStorage.getItem('token');
    socketRef.current = io('http://localhost:5000', {
      query: { token },
    });
    
    socketRef.current.on('chat message', (msg) => {
      setMessages((prevMessages) => [...prevMessages, msg]);
    });
  };

  const addFriend = async () => {
    if (friendUsername.trim() === '') return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/add-friend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ friendUsername }),
      });
      if (response.ok) {
        const newFriend = await response.json();
        setFriends([...friends, newFriend]);
        setFriendUsername('');
      } else {
        const errorData = await response.json();
        alert(errorData.error);
      }
    } catch (error) {
      console.error('Error adding friend:', error);
      alert('An error occurred while adding the friend.');
    }
  };

  const startChat = (friend) => {
    setCurrentChatFriend(friend);
    setView('chat');
  };

  const backToFriends = () => {
    setView('friends');
    setCurrentChatFriend(null);
    setMessages([]);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (input.trim() && currentChatFriend && socketRef.current) {
      socketRef.current.emit('chat message', {
        senderId: currentUser.id,
        receiverId: currentChatFriend.id,
        content: input,
      });
      setInput('');
    }
  };

  if (view === 'auth') {
    return <Auth onLogin={handleLogin} />;
  }

  if (view === 'friends') {
    return (
      <div className="container">
        <div className="header">
          <img src="logo.png" alt="Your App Name" style={{ height: '100px' }} />
          <button onClick={logOut} className="logout-btn">Logout</button>
        </div>
        <div className="friends-section" style={{ display: 'flex' }}>
          <div className="user-info" style={{ color: '#e2e8f0', padding: '20px' }}>
            Logged in as: {currentUser?.username}
          </div>
          <div className="add-friend-section">
            <div className="add-friend-form">
              <input
                type="text"
                value={friendUsername}
                onChange={(e) => setFriendUsername(e.target.value)}
                className="add-friend-input"
                placeholder="Enter friend's username to add"
              />
              <button onClick={addFriend}>Add Friend</button>
            </div>
          </div>
          <div className="friends-list">
            {friends.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#e2e8f0', marginTop: '50px' }}>
                <h3>No friends yet</h3>
                <p>Add friends using their username to start chatting!</p>
              </div>
            ) : (
              friends.map((friend) => (
                <div key={friend.id} className="friend-item" onClick={() => startChat(friend)}>
                  <div className="friend-info">
                    <div className="friend-avatar">{friend.username.charAt(0).toUpperCase()}</div>
                    <div>
                      <div>{friend.username}</div>
                      <div className="friend-status">Online</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'chat') {
    return (
      <div className="container">
        <div className="header">
          <img src="logo.png" alt="Your App Name" style={{ height: '100px' }} />
          <button onClick={logOut} className="logout-btn">Logout</button>
        </div>
        <div className="chat-section" style={{ display: 'flex' }}>
          <div className="chat-header">
            <button className="back-btn" onClick={backToFriends}>← Back</button>
            <div className="friend-info">
              <div className="friend-avatar">{currentChatFriend.username.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 'bold' }}>{currentChatFriend.username}</div>
                <div className="friend-status">Online</div>
              </div>
            </div>
          </div>
          <div className="messages" id="messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.senderId === currentUser.id ? 'own' : 'other'}`}>
                {msg.content}
              </div>
            ))}
          </div>
          <div className="input-section">
            <div className="message-input">
              <input
                type="text"
                id="messageInput"
                className="message-text"
                placeholder="Type your message..."
                maxLength="500"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    sendMessage(e);
                  }
                }}
              />
              <button onClick={sendMessage}>Send</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
};

export default App;