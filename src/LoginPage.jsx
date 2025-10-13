import React, { useState } from 'react';
import axios from 'axios';
import './LoginPage.css';

const LoginPage = ({ onLogin }) => {
  // === Your existing login state & logic (UNCHANGED) ===
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

  // === NEW: Student Registration state ===
  const [showRegister, setShowRegister] = useState(false);
  const [studentData, setStudentData] = useState({
    roll_no: '',
    name: '',
    email: '',
    password: ''
  });
  const [saving, setSaving] = useState(false);

  const handleStudentChange = (e) => {
    const { name, value } = e.target;
    setStudentData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleRegister = async () => {
    if (!studentData.roll_no || !studentData.name || !studentData.email || !studentData.password) {
      alert('Please fill Roll No, Name, Email, and Password.');
      return;
    }
    try {
      setSaving(true);
      await axios.post('http://localhost:5000/api/students/register', studentData);
      alert('Student registered successfully!');
      setStudentData({ roll_no: '', name: '', email: '', password: '' });
      setShowRegister(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Registration failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    // NOTE: height: '100vh' + overflow: 'hidden' prevents page scroll
    <div className="login-container" style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      {/* === NEW: Top-right Student Registration button === */}
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 2 }}>
        <button
          onClick={() => setShowRegister(true)}
          style={{
            backgroundColor: '#4a6ef6',
            color: 'white',
            padding: '8px 14px',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Student Registration
        </button>
      </div>

      {/* === Your existing Login UI (UNCHANGED) === */}
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">🤖</div>
          <h1 className="login-title">AI Attendance</h1>
          <p className="login-subtitle">Face Recognition Attendance System</p>
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

        <div className="demo-credentials">
          <p className="demo-title">Demo Credentials:</p>
          <p>Admin: admin@school.edu</p>
          <p>Teacher: teacher@school.edu</p>
          <p>Student: student@school.edu</p>
          <p>Password: any</p>
        </div>
      </div>

      {/* === NEW: Student Registration Modal === */}
      {showRegister && (
        // Fullscreen overlay WITHOUT padding to avoid extra scroll
        <div
          onClick={() => setShowRegister(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          {/* Modal card with its own scroll if content is taller than viewport */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,.12)',
              padding: 20
            }}
          >
            <h3 style={{ marginTop: 0 }}>Student Registration</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <label>Roll No *</label>
              <input
                type="text"
                name="roll_no"
                placeholder="e.g. 23CS012"
                value={studentData.roll_no}
                onChange={handleStudentChange}
                style={{ border: '1px solid #e3e6ef', borderRadius: 8, padding: '10px 12px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <label>Name *</label>
              <input
                type="text"
                name="name"
                placeholder="Student Name"
                value={studentData.name}
                onChange={handleStudentChange}
                style={{ border: '1px solid #e3e6ef', borderRadius: 8, padding: '10px 12px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <label>Email *</label>
              <input
                type="email"
                name="email"
                placeholder="student@college.edu"
                value={studentData.email}
                onChange={handleStudentChange}
                style={{ border: '1px solid #e3e6ef', borderRadius: 8, padding: '10px 12px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <label>Password *</label>
              <input
                type="password"
                name="password"
                placeholder="Create a password"
                value={studentData.password}
                onChange={handleStudentChange}
                style={{ border: '1px solid #e3e6ef', borderRadius: 8, padding: '10px 12px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button
                onClick={handleRegister}
                disabled={saving}
                style={{
                  background: '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowRegister(false)}
                disabled={saving}
                style={{
                  background: '#dc3545',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LoginPage;
