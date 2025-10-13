// RegisterStudent.jsx
import React, { useState } from 'react';

export default function RegisterStudent() {
  const [form, setForm] = useState({
    name: '',
    roll_no: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('http://localhost:5000/api/students/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register');
      setMsg({ type: 'success', text: 'Registered! You can now log in.' });
      setForm({ name: '', roll_no: '', email: '', password: '' });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h2>Student Registration</h2>
        {msg && (
          <div
            style={{
              marginBottom: 12,
              padding: '8px 10px',
              borderRadius: 6,
              background: msg.type === 'success' ? '#e7f8ef' : '#fde8e8',
              color: msg.type === 'success' ? '#0f5132' : '#842029',
              border: '1px solid',
            }}
          >
            {msg.text}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <label>Name</label>
          <input name="name" value={form.name} onChange={onChange} placeholder="Full name" required />

          <label>Roll Number</label>
          <input name="roll_no" value={form.roll_no} onChange={onChange} placeholder="e.g. CS-23-017" required />

          <label>Email</label>
          <input type="email" name="email" value={form.email} onChange={onChange} placeholder="you@college.edu" required />

          <label>Password</label>
          <input type="password" name="password" value={form.password} onChange={onChange} placeholder="Min 6 chars" required />

          <button type="submit" disabled={loading}>{loading ? 'Registering…' : 'Register'}</button>
        </form>
      </div>
    </div>
  );
}
