import React, { useState } from 'react';

const Auth = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const handleAuth = async (isLoginAttempt) => {
    const endpoint = isLoginAttempt ? '/auth/login' : '/auth/register';
    const body = isLoginAttempt
      ? { username, password }
      : { username, password, fullName };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (response.ok) {
        // Save the token and user data to localStorage
        localStorage.setItem('token', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        
        onLogin(data.user); // Pass the user data back to the parent component
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      alert('An error occurred. Please try again.');
    }
  };

  return (
    <div className="container">
      <div className="header">
        <img src="logo.png" alt="Your App Name" style={{ height: '100px' }} />
      </div>

      <div className="auth-section">
        <div className="tab-buttons">
          <button
            className={`tab-btn ${isLogin ? 'active' : ''}`}
            onClick={() => setIsLogin(true)}
          >
            Login
          </button>
          <button
            className={`tab-btn ${!isLogin ? 'active' : ''}`}
            onClick={() => setIsLogin(false)}
          >
            Register
          </button>
        </div>
        
        {isLogin ? (
          <div id="loginForm">
            <h3 style={{ marginBottom: '20px', color: '#e2e8f0' }}>Welcome Back!</h3>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>
            <button onClick={() => handleAuth(true)}>Login</button>
          </div>
        ) : (
          <div id="registerForm">
            <h3 style={{ marginBottom: '20px', color: '#e2e8f0' }}>Create Account</h3>
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
              />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
              />
            </div>
            <button onClick={() => handleAuth(false)}>Create Account</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;