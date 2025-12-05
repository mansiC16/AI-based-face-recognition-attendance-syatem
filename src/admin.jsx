import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './admin.css';

const AdminDashboard = ({ user, onLogout }) => {
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [showAddClassForm, setShowAddClassForm] = useState(false);
  const [newClass, setNewClass] = useState({ name: '', strength: '', numSubjects: '', subjects: [] });
  const [showEditClassForm, setShowEditClassForm] = useState(false);
  const [editClassIndex, setEditClassIndex] = useState(null);
  const [editClass, setEditClass] = useState({ id: null, name: '', strength: '', numSubjects: '', subjects: [] });
  const [showAddTeacherForm, setShowAddTeacherForm] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ name: '', email: '' });
  const [showAddStudentForm, setShowAddStudentForm] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: '', roll_no: '', email: '', password: '', class_id: '' });
  
  // Alert state - NEW
  const [alert, setAlert] = useState(null);
  
  // Timetable states
  const [selectedClassForTimetable, setSelectedClassForTimetable] = useState('');
  const [selectedSubjectForTimetable, setSelectedSubjectForTimetable] = useState('');
  const [timetableSlots, setTimetableSlots] = useState([]);
  const [showAddSlotForm, setShowAddSlotForm] = useState(false);
  const [newSlot, setNewSlot] = useState({ day_of_week: '', start_time: '', end_time: '' });

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-dismiss alerts after 5 seconds - NEW
  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => {
        setAlert(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  // Helper function to show alerts - NEW
  const showAlert = (message, type = 'error') => {
    setAlert({ message, type });
    // Scroll to top to show the alert
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fetchData = async () => {
    try {
      const classesRes = await axios.get('http://localhost:5000/classes');
      setClasses(classesRes.data);
      const teachersRes = await axios.get('http://localhost:5000/teachers');
      setTeachers(teachersRes.data);
      const studentsRes = await axios.get('http://localhost:5000/api/students/all');
      setStudents(studentsRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
      showAlert('Failed to load data. Please refresh the page.');
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
      const subjects = Array(num).fill().map((_, i) => target.subjects[i] || { name: '', teacher_id: '' });
      setTarget({ ...target, numSubjects: value, subjects });
    } else {
      setTarget({ ...target, [name]: value });
    }
  };

  const submitAddClass = async () => {
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
        showAlert('Class added successfully!', 'success');
      } catch (err) {
        console.error('Error adding class:', err);
        showAlert(err.response?.data?.error || 'Failed to add class');
      }
    } else {
      showAlert('Please fill all fields correctly');
    }
  };

  const handleEditClass = (index) => {
    const cls = classes[index];
    setEditClass({
      id: cls.id,
      name: cls.name,
      strength: cls.strength.toString(),
      numSubjects: cls.subjects.length.toString(),
      subjects: cls.subjects.map(s => ({ ...s })), 
    });
    setEditClassIndex(index);
    setShowEditClassForm(true);
  };

  const submitEditClass = async () => {
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
        showAlert('Class updated successfully!', 'success');
      } catch (err) {
        console.error('Error editing class:', err);
        showAlert(err.response?.data?.error || 'Failed to update class');
      }
    } else {
      showAlert('Please fill all fields correctly');
    }
  };

  const handleDeleteClass = async (index) => {
    if (window.confirm('Are you sure you want to delete this class?')) {
      try {
        await axios.delete(`http://localhost:5000/classes/${classes[index].id}`);
        fetchData();
        showAlert('Class deleted successfully!', 'success');
      } catch (err) {
        console.error('Error deleting class:', err);
        showAlert(err.response?.data?.error || 'Failed to delete class');
      }
    }
  };

  const handleTeacherInput = (e) => {
    setNewTeacher({ ...newTeacher, [e.target.name]: e.target.value });
  };

  const submitAddTeacher = async () => {
    if (newTeacher.name && newTeacher.email) {
      try {
        await axios.post('http://localhost:5000/teachers', newTeacher);
        fetchData();
        setShowAddTeacherForm(false);
        setNewTeacher({ name: '', email: '' });
        showAlert('Teacher added successfully!', 'success');
      } catch (err) {
        console.error('Error adding teacher:', err);
        const errorMsg = err.response?.data?.error || 'Failed to add teacher';
        showAlert(errorMsg);
      }
    } else {
      showAlert('Please fill all fields');
    }
  };

  const handleDeleteTeacher = async (teacherId) => {
    if (window.confirm('Are you sure you want to delete this teacher? This will remove them from all assigned subjects.')) {
      try {
        await axios.delete(`http://localhost:5000/teachers/${teacherId}`);
        fetchData();
        showAlert('Teacher deleted successfully!', 'success');
      } catch (err) {
        console.error('Error deleting teacher:', err);
        showAlert(err.response?.data?.error || 'Failed to delete teacher');
      }
    }
  };

  const handleStudentInput = (e) => {
    setNewStudent({ ...newStudent, [e.target.name]: e.target.value });
  };

  const submitAddStudent = async () => {
    if (newStudent.name && newStudent.roll_no && newStudent.email && newStudent.password && newStudent.class_id) {
      try {
        await axios.post('http://localhost:5000/api/students/admin-register', newStudent);
        fetchData();
        setShowAddStudentForm(false);
        setNewStudent({ name: '', roll_no: '', email: '', password: '', class_id: '' });
        showAlert('Student added successfully!', 'success');
      } catch (err) {
        console.error('Error adding student:', err);
        const errorMsg = err.response?.data?.error || 'Failed to add student';
        showAlert(errorMsg);
      }
    } else {
      showAlert('Please fill all fields');
    }
  };

  const handleDeleteStudent = async (studentId) => {
    if (window.confirm('Are you sure you want to delete this student?')) {
      try {
        await axios.delete(`http://localhost:5000/api/students/${studentId}`);
        fetchData();
        showAlert('Student deleted successfully!', 'success');
      } catch (err) {
        console.error('Error deleting student:', err);
        showAlert(err.response?.data?.error || 'Failed to delete student');
      }
    }
  };

  // Timetable functions
  const loadTimetable = async (classId, subjectId) => {
    try {
      const res = await axios.get(`http://localhost:5000/api/timetable/${classId}/${subjectId}`);
      setTimetableSlots(res.data.slots);
    } catch (err) {
      console.error('Error loading timetable:', err);
      showAlert('Failed to load timetable');
    }
  };

  const handleSlotInput = (e) => {
    setNewSlot({ ...newSlot, [e.target.name]: e.target.value });
  };

  const submitAddSlot = async () => {
    if (newSlot.day_of_week && newSlot.start_time && newSlot.end_time) {
      try {
        await axios.post('http://localhost:5000/api/timetable', {
          class_id: selectedClassForTimetable,
          subject_id: selectedSubjectForTimetable,
          ...newSlot
        });
        loadTimetable(selectedClassForTimetable, selectedSubjectForTimetable);
        setShowAddSlotForm(false);
        setNewSlot({ day_of_week: '', start_time: '', end_time: '' });
        showAlert('Time slot added successfully!', 'success');
      } catch (err) {
        showAlert(err.response?.data?.error || 'Failed to add slot');
      }
    } else {
      showAlert('Please fill all fields');
    }
  };

  const handleDeleteSlot = async (slotId) => {
    if (window.confirm('Delete this time slot?')) {
      try {
        await axios.delete(`http://localhost:5000/api/timetable/${slotId}`);
        loadTimetable(selectedClassForTimetable, selectedSubjectForTimetable);
        showAlert('Time slot deleted successfully!', 'success');
      } catch (err) {
        showAlert('Failed to delete slot');
      }
    }
  };

  const totalClasses = classes.length;
  const totalTeachers = teachers.length;
  const totalStudents = students.length;

  return (
    <div className="admin-dashboard">
      <header className="header">
        <div className="logo">AI Attendance System</div>
        <nav><a href="#">Dashboard</a><a href="#">Analytics</a></nav>
        <div className="user-info">{user.email} <button onClick={onLogout} className="logout-btn">Logout</button></div>
      </header>
      <main>
        <h1 className="title">Admin Dashboard</h1>
        
        {/* Alert Message - NEW */}
        {alert && (
          <div style={{
            padding: '12px 20px',
            marginBottom: '20px',
            borderRadius: '8px',
            backgroundColor: alert.type === 'success' ? '#d4edda' : '#f8d7da',
            color: alert.type === 'success' ? '#155724' : '#721c24',
            border: `1px solid ${alert.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            fontSize: '14px',
            fontWeight: '500'
          }}>
            <span>{alert.message}</span>
            <button 
              onClick={() => setAlert(null)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: 'inherit',
                padding: '0 5px',
                lineHeight: '1'
              }}
            >
              ×
            </button>
          </div>
        )}

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
          <div className="teacher-grid">
            {teachers.map((teacher) => (
              <div key={teacher.id} className="teacher-card">
                <div className="teacher-card-header">
                  <h3>{teacher.name}</h3>
                  <button 
                    onClick={() => handleDeleteTeacher(teacher.id)} 
                    className="delete-icon-btn"
                    title="Delete Teacher"
                  >
                    🗑️
                  </button>
                </div>
                <p className="teacher-email">{teacher.email}</p>
                <p className="teacher-assignments">Assigned Classes: {teacher.assigned && teacher.assigned.length > 0 ? teacher.assigned.join(', ') : 'No classes assigned'}</p>
              </div>
            ))}
          </div>
        </section>
        
        {showAddTeacherForm && (
          <div className="modal">
            <div className="modal-content">
              <h3>Add New Teacher</h3>
              <input name="name" placeholder="Teacher Name" value={newTeacher.name} onChange={handleTeacherInput} className="input" />
              <input name="email" type="email" placeholder="Teacher Email" value={newTeacher.email} onChange={handleTeacherInput} className="input" />
              <div className="modal-buttons">
                <button onClick={submitAddTeacher} className="save-btn">Add</button>
                <button onClick={() => setShowAddTeacherForm(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <section className="teacher-assignments">
          <div className="section-header">
            <h2>Student Management</h2>
            <button onClick={() => setShowAddStudentForm(true)} className="add-btn">+ Add Student</button>
          </div>
          <table className="class-table">
            <thead><tr><th>Roll No</th><th>Name</th><th>Email</th><th>Class</th><th>Actions</th></tr></thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>{student.roll_no}</td>
                  <td>{student.name}</td>
                  <td>{student.email}</td>
                  <td>{student.class_name || 'Not Assigned'}</td>
                  <td>
                    <button onClick={() => handleDeleteStudent(student.id)} className="delete-btn">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {showAddStudentForm && (
          <div className="modal">
            <div className="modal-content">
              <h3>Add New Student</h3>
              <input name="roll_no" placeholder="Roll Number (e.g., 23CS012)" value={newStudent.roll_no} onChange={handleStudentInput} className="input" />
              <input name="name" placeholder="Student Name" value={newStudent.name} onChange={handleStudentInput} className="input" />
              <input name="email" type="email" placeholder="Student Email" value={newStudent.email} onChange={handleStudentInput} className="input" />
              <input name="password" type="password" placeholder="Password" value={newStudent.password} onChange={handleStudentInput} className="input" />
              <select name="class_id" value={newStudent.class_id} onChange={handleStudentInput} className="select">
                <option value="">Select Class</option>
                {classes.map((cls) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
              </select>
              <div className="modal-buttons">
                <button onClick={submitAddStudent} className="save-btn">Add</button>
                <button onClick={() => setShowAddStudentForm(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <section className="teacher-assignments">
          <div className="section-header">
            <h2>Timetable Management</h2>
          </div>
          <div style={{ marginBottom: '20px' }}>
            <select 
              value={selectedClassForTimetable} 
              onChange={(e) => {
                setSelectedClassForTimetable(e.target.value);
                setSelectedSubjectForTimetable('');
                setTimetableSlots([]);
              }}
              className="select"
              style={{ marginRight: '10px', width: '200px' }}
            >
              <option value="">Select Class</option>
              {classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
            </select>
            
            {selectedClassForTimetable && (
              <select 
                value={selectedSubjectForTimetable} 
                onChange={(e) => {
                  setSelectedSubjectForTimetable(e.target.value);
                  if (e.target.value) loadTimetable(selectedClassForTimetable, e.target.value);
                }}
                className="select"
                style={{ width: '200px' }}
              >
                <option value="">Select Subject</option>
                {classes.find(c => c.id == selectedClassForTimetable)?.subjects.map(sub => (
                  <option key={sub.id} value={sub.id}>{sub.name}</option>
                ))}
              </select>
            )}
            
            {selectedSubjectForTimetable && (
              <button onClick={() => setShowAddSlotForm(true)} className="add-btn" style={{ marginLeft: '10px' }}>
                + Add Time Slot
              </button>
            )}
          </div>

          {selectedSubjectForTimetable && (
            <table className="class-table">
              <thead>
                <tr><th>Day</th><th>Start Time</th><th>End Time</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {timetableSlots.map(slot => (
                  <tr key={slot.id}>
                    <td>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][slot.day_of_week]}</td>
                    <td>{slot.start_time}</td>
                    <td>{slot.end_time}</td>
                    <td>
                      <button onClick={() => handleDeleteSlot(slot.id)} className="delete-btn">Delete</button>
                    </td>
                  </tr>
                ))}
                {timetableSlots.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>No slots configured</td></tr>
                )}
              </tbody>
            </table>
          )}
        </section>

        {showAddSlotForm && (
          <div className="modal">
            <div className="modal-content">
              <h3>Add Time Slot</h3>
              <select name="day_of_week" value={newSlot.day_of_week} onChange={handleSlotInput} className="select">
                <option value="">Select Day</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                <option value="0">Sunday</option>
              </select>
              <input name="start_time" type="time" placeholder="Start Time" value={newSlot.start_time} onChange={handleSlotInput} className="input" />
              <input name="end_time" type="time" placeholder="End Time" value={newSlot.end_time} onChange={handleSlotInput} className="input" />
              <div className="modal-buttons">
                <button onClick={submitAddSlot} className="save-btn">Add</button>
                <button onClick={() => setShowAddSlotForm(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;