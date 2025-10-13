import React, { useState, useEffect } from 'react';
import axios from 'axios';
import LoginPage from './LoginPage';
import AdminDashboard from './admin';
import StudentDashboard from './StudentDashboard';
import TeacherDashboard from './TeacherDashboard'; // 1. Import the new dashboard

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  }, [user]);

  // 2. Updated handleLogin to be async and use the new API endpoint
  const handleLogin = async (formData) => {
    try {
      const response = await axios.post('http://localhost:5000/api/login', formData);
      setUser(response.data); // Set user with data from the backend
    } catch (error) {
      console.error('Login failed:', error.response?.data?.error || 'Server error');
      alert(error.response?.data?.error || 'Login failed!');
    }
  };

  const handleLogout = () => {
    setUser(null);
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 3. Updated the switch to render the TeacherDashboard
  switch (user.role) {
    case 'Admin':
      return <AdminDashboard user={user} onLogout={handleLogout} />;
    case 'Student':
      return <StudentDashboard user={user} onLogout={handleLogout} />;
    case 'Teacher':
      return <TeacherDashboard user={user} onLogout={handleLogout} />;
    default:
      return <div>Invalid role <button onClick={handleLogout}>Logout</button></div>;
  }
}

export default App;
