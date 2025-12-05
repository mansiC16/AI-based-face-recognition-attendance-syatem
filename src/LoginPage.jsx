import React, { useState } from 'react';
import './LoginPage.css';

const LoginPage = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    role: 'Student'
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleLogin = () => {
    onLogin(formData);
  };

  return (
    <div className="login-container" style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      {/* === Login Card === */}
      <div className="login-card">
        <div className="login-header">
          {/* Professional Fingerprint Icon */}
          <div className="login-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="login-title">AI Attendance System</h1>
          <p className="login-subtitle">Face Recognition Attendance Management</p>
        </div>

        <div className="login-form">
          <input
            type="email"
            name="email"
            placeholder="Email Address"
            value={formData.email}
            onChange={handleInputChange}
            className="login-input"
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleInputChange}
            className="login-input"
          />

          <select
            name="role"
            value={formData.role}
            onChange={handleInputChange}
            className="login-select"
          >
            <option value="Student">Student</option>
            <option value="Teacher">Teacher</option>
            <option value="Admin">Admin</option>
          </select>

          <button
            onClick={handleLogin}
            className="login-button"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;