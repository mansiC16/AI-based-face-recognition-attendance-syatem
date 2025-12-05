import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './admin.css';

const AdminDashboard = ({ user, onLogout }) => {
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [showAddClassForm, setShowAddClassForm] = useState(false);
  const [newClass, setNewClass] = useState({ name: '', strength: '', numSubjects: '', subjects: [] });
  const [showEditClassForm, setShowEditClassForm] = useState(false);
  const [editClassIndex, setEditClassIndex] = useState(null);
  const [editClass, setEditClass] = useState({ id: null, name: '', strength: '', numSubjects: '', subjects: [] });
  const [showAddTeacherForm, setShowAddTeacherForm] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ name: '', email: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const classesRes = await axios.get('http://localhost:5000/classes');
      setClasses(classesRes.data);
      const teachersRes = await axios.get('http://localhost:5000/teachers');
      setTeachers(teachersRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const handleClassInput = (e, index, field, isEdit = false) => {
    const { name, value } = e.target;
    const target = isEdit ? editClass : newClass;
    const setTarget = isEdit ? setEditClass : setNewClass;
    if (index !== undefined) {
      const subjects = [...target.subjects];
      subjects[index][field] = value;
      setTarget({ ...target, subjects });
    } else if (name === 'numSubjects') {
      const num = parseInt(value) || 0;
      // UPDATED: New subjects should have teacher_id property
      const subjects = Array(num).fill().map((_, i) => target.subjects[i] || { name: '', teacher_id: '' });
      setTarget({ ...target, numSubjects: value, subjects });
    } else {
      setTarget({ ...target, [name]: value });
    }
  };

  const submitAddClass = async () => {
    // UPDATED: Validation check is for teacher_id
    if (newClass.name && newClass.strength && newClass.subjects.every(s => s.name && s.teacher_id)) {
      try {
        await axios.post('http://localhost:5000/classes', {
          name: newClass.name,
          strength: parseInt(newClass.strength),
          subjects: newClass.subjects,
        });
        fetchData();
        setShowAddClassForm(false);
        setNewClass({ name: '', strength: '', numSubjects: '', subjects: [] });
      } catch (err) {
        console.error('Error adding class:', err);
      }
    }
  };

  const handleEditClass = (index) => {
    const cls = classes[index];
    setEditClass({
      id: cls.id,
      name: cls.name,
      strength: cls.strength.toString(),
      numSubjects: cls.subjects.length.toString(),
      // Ensure subjects have teacher_id, assuming backend provides it
      subjects: cls.subjects.map(s => ({ ...s })), 
    });
    setEditClassIndex(index);
    setShowEditClassForm(true);
  };

  const submitEditClass = async () => {
    // UPDATED: Validation check is for teacher_id
    if (editClass.name && editClass.strength && editClass.subjects.every(s => s.name && s.teacher_id)) {
      try {
        await axios.put(`http://localhost:5000/classes/${editClass.id}`, {
          name: editClass.name,
          strength: parseInt(editClass.strength),
          subjects: editClass.subjects,
        });
        fetchData();
        setShowEditClassForm(false);
        setEditClass({ id: null, name: '', strength: '', numSubjects: '', subjects: [] });
        setEditClassIndex(null);
      } catch (err) {
        console.error('Error editing class:', err);
      }
    }
  };

  const handleDeleteClass = async (index) => {
    try {
      await axios.delete(`http://localhost:5000/classes/${classes[index].id}`);
      fetchData();
    } catch (err) {
      console.error('Error deleting class:', err);
    }
  };

  const handleTeacherInput = (e) => {
    setNewTeacher({ ...newTeacher, [e.target.name]: e.target.value });
  };

  const submitAddTeacher = async () => {
    if (newTeacher.name && newTeacher.email) {
      try {
        await axios.post('http://localhost:5000/teachers', newTeacher);
        fetchData(); // Re-fetch is simpler and safer here
        setShowAddTeacherForm(false);
        setNewTeacher({ name: '', email: '' });
      } catch (err) {
        console.error('Error adding teacher:', err);
      }
    }
  };

  const totalClasses = classes.length;
  const totalTeachers = teachers.length;
  const totalStudents = classes.reduce((sum, c) => sum + c.strength, 0);

  return (
    <div className="admin-dashboard">
      <header className="header">
        <div className="logo">🤖 AI Attendance System</div>
        <nav><a href="#">Dashboard</a><a href="#">Analytics</a></nav>
        <div className="user-info">{user.email} <button onClick={onLogout} className="logout-btn">Logout</button></div>
      </header>
      <main>
        <h1 className="title">Admin Dashboard</h1>
        <div className="stats">
          <div className="stat-card blue"><div className="stat-number">{totalClasses}</div><div className="stat-label">Total Classes</div></div>
          <div className="stat-card blue"><div className="stat-number">{totalTeachers}</div><div className="stat-label">Total Teachers</div></div>
          <div className="stat-card green"><div className="stat-number">{totalStudents}</div><div className="stat-label">Total Students</div></div>
        </div>
        <section className="class-management">
          <div className="section-header">
            <h2>Class Management</h2>
            <button onClick={() => setShowAddClassForm(true)} className="add-btn">+ Add Class</button>
          </div>
          <table className="class-table">
            <thead><tr><th>Class Name</th><th>Strength</th><th>Assigned Subjects</th><th>Actions</th></tr></thead>
            <tbody>
              {classes.map((cls, index) => (
                <tr key={cls.id}>
                  <td>{cls.name}</td>
                  <td>{cls.strength} students</td>
                  <td>{cls.subjects.map((s, sIndex) => (
                    // This display logic might need adjustment based on data from backend
                    <span key={sIndex} className="teacher-tag">{s.name} ({s.teacher_name || 'N/A'})</span>
                  ))}</td>
                  <td>
                    <button onClick={() => handleEditClass(index)} className="edit-btn">Edit</button>
                    <button onClick={() => handleDeleteClass(index)} className="delete-btn">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        
        {/* Add Class Modal */}
        {showAddClassForm && (
          <div className="modal">
            <div className="modal-content">
              <h3>Add New Class</h3>
              <input name="name" placeholder="Class Name" value={newClass.name} onChange={handleClassInput} className="input" />
              <input name="strength" type="number" placeholder="Class Strength" value={newClass.strength} onChange={handleClassInput} className="input" />
              <input name="numSubjects" type="number" placeholder="Number of Subjects" value={newClass.numSubjects} onChange={handleClassInput} className="input" />
              {newClass.subjects.map((sub, index) => (
                <div key={index} className="subject-group">
                  <input placeholder={`Subject ${index + 1} Name`} value={sub.name} onChange={(e) => handleClassInput(e, index, 'name')} className="input" />
                  <select value={sub.teacher_id} onChange={(e) => handleClassInput(e, index, 'teacher_id')} className="select">
                    <option value="">Assign Teacher</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
              <div className="modal-buttons">
                <button onClick={submitAddClass} className="save-btn">Add</button>
                <button onClick={() => setShowAddClassForm(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Class Modal */}
        {showEditClassForm && (
          <div className="modal">
            <div className="modal-content">
              <h3>Edit Class</h3>
              <input name="name" placeholder="Class Name" value={editClass.name} onChange={(e) => handleClassInput(e, undefined, undefined, true)} className="input" />
              <input name="strength" type="number" placeholder="Class Strength" value={editClass.strength} onChange={(e) => handleClassInput(e, undefined, undefined, true)} className="input" />
              <input name="numSubjects" type="number" placeholder="Number of Subjects" value={editClass.numSubjects} onChange={(e) => handleClassInput(e, undefined, undefined, true)} className="input" />
              {editClass.subjects.map((sub, index) => (
                <div key={index} className="subject-group">
                  <input placeholder={`Subject ${index + 1} Name`} value={sub.name} onChange={(e) => handleClassInput(e, index, 'name', true)} className="input" />
                  <select value={sub.teacher_id} onChange={(e) => handleClassInput(e, index, 'teacher_id', true)} className="select">
                    <option value="">Assign Teacher</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
              <div className="modal-buttons">
                <button onClick={submitEditClass} className="save-btn">Save</button>
                <button onClick={() => setShowEditClassForm(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        )}
        
        <section className="teacher-assignments">
          <div className="section-header">
            <h2>Teacher Assignments</h2>
            <button onClick={() => setShowAddTeacherForm(true)} className="add-btn">+ Add Teacher</button>
          </div>
          {teachers.map((teacher) => (
            <div key={teacher.id} className="teacher-card">
              <h3>{teacher.name}</h3>
              <p>{teacher.email}</p>
              {/* Note: 'teacher.assigned' may need to be fetched from your backend */}
              <p>Assigned Classes: {teacher.assigned && teacher.assigned.length > 0 ? teacher.assigned.join(', ') : 'No classes assigned'}</p>
            </div>
          ))}
        </section>
        
        {showAddTeacherForm && (
          <div className="modal">
            <div className="modal-content">
              <h3>Add New Teacher</h3>
              <input name="name" placeholder="Teacher Name" value={newTeacher.name} onChange={handleTeacherInput} className="input" />
              <input name="email" placeholder="Teacher Email" value={newTeacher.email} onChange={handleTeacherInput} className="input" />
              <div className="modal-buttons">
                <button onClick={submitAddTeacher} className="save-btn">Add</button>
                <button onClick={() => setShowAddTeacherForm(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;