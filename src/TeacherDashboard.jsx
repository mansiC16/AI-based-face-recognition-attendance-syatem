import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './TeacherDashboard.css';

const TeacherDashboard = ({ user, onLogout }) => {
  const [dashboardData, setDashboardData] = useState({ assignedClasses: [], totalStudents: 0 });
  const [loading, setLoading] = useState(true);

  const [starting, setStarting] = useState(false);
  const [activeMap, setActiveMap] = useState({}); // key: `${classId}-${subjectId}` -> {session_id, started_at}
  const [showTableKey, setShowTableKey] = useState(null);
  const [tableRows, setTableRows] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);

  useEffect(() => {
    const fetchTeacher = async () => {
      if (!user?.email) return;
      try {
        setLoading(true);
        const response = await axios.get(`http://localhost:5000/api/teacher-dashboard/${user.email}`);
        setDashboardData(response.data);

        const act = await axios.get('http://localhost:5000/api/attendance/active-by-teacher', { params: { email: user.email } });
        const map = {};
        (act.data.sessions || []).forEach(s => {
          map[`${s.class_id}-${s.subject_id}`] = { session_id: s.id, started_at: s.started_at };
        });
        setActiveMap(map);
      } catch (err) { console.error(err); } finally { setLoading(false); }
    };
    fetchTeacher();
  }, [user]);

  const keyOf = (clsId, subId) => `${clsId}-${subId}`;

  const handleStartSession = async (assignment) => {
    const { classId, subjectId } = assignment;
    try {
      setStarting(true);
      const res = await axios.post('http://localhost:5000/api/attendance/start', {
        class_id: classId,
        subject_id: subjectId,
        teacher_email: user.email,
      });
      const s = res.data.session;
      setActiveMap(prev => ({ ...prev, [keyOf(classId, subjectId)]: { session_id: s.id, started_at: s.started_at } }));
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to start session');
    } finally { setStarting(false); }
  };

  const handleCloseSession = async (assignment) => {
    const { classId, subjectId } = assignment;
    const k = keyOf(classId, subjectId);
    const active = activeMap[k];
    if (!active) return;
    try {
      await axios.post('http://localhost:5000/api/attendance/close', {
        session_id: active.session_id,
        teacher_email: user.email,
      });
      setActiveMap(prev => { const n = { ...prev }; delete n[k]; return n; });
      if (showTableKey === k) await fetchTeacherAttendance(assignment);
    } catch (e) { alert(e?.response?.data?.error || 'Failed to close session'); }
  };

  const fetchTeacherAttendance = async (assignment) => {
    const k = keyOf(assignment.classId, assignment.subjectId);
    setShowTableKey(k);
    setTableLoading(true);
    try {
      const resp = await axios.get('http://localhost:5000/api/attendance/teacher-history', {
        params: { class_id: assignment.classId, subject_id: assignment.subjectId },
      });
      setTableRows(resp.data.rows || []);
    } catch (e) { alert('Failed to load attendance'); }
    finally { setTableLoading(false); }
  };

  if (loading) return <div>Loading teacher dashboard...</div>;

  return (
    <div className="dashboard-wrapper">
      <header className="dashboard-header">
        <div className="header-left"><div className="logo">AI Attendance System</div></div>
        <div className="header-right">
          <div className="user-info"><span className="user-name">{user.name || user.email}</span><span className="user-role">Teacher</span></div>
          <button onClick={onLogout} className="logout-button">Logout</button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="welcome-section">
          <h1 className="dashboard-title">Teacher Dashboard</h1>
          <p className="welcome-text">Welcome back, {user.name || user.email}!</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card blue">
            <div className="stat-number">{dashboardData.assignedClasses.length}</div>
            <div className="stat-label">Assigned Classes</div>
          </div>
          <div className="stat-card green">
            <div className="stat-number">{dashboardData.totalStudents}</div>
            <div className="stat-label">Total Students</div>
          </div>
        </div>

        <div className="classes-section">
          <h2 className="section-title">My Assignments</h2>

          {dashboardData.assignedClasses.length > 0 ? (
            dashboardData.assignedClasses.map((assignment, index) => {
              const k = keyOf(assignment.classId, assignment.subjectId);
              const active = activeMap[k];
              return (
                <div className="class-card" key={index}>
                  <div className="class-info">
                    <h3 className="class-name">
                      {assignment.className} — {assignment.subjectName}
                      {active && <span className="session-chip">Active</span>}
                    </h3>
                    <p className="class-details">Total Students: {assignment.strength}</p>
                  </div>
                  <div className="actions-col">
                    {!active && (
                      <button className="start-session-btn pro" disabled={starting} onClick={() => handleStartSession(assignment)}>
                        {starting ? 'Starting…' : 'Start Attendance Session'}
                      </button>
                    )}
                    {active && (
                      <button className="danger-btn" onClick={() => handleCloseSession(assignment)}>
                        End Session
                      </button>
                    )}
                    <button className="secondary-btn" onClick={() => fetchTeacherAttendance(assignment)}>
                      Show Attendance
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p>You have not been assigned to any classes yet.</p>
          )}
        </div>

        {showTableKey && (
          <div className="table-card">
            {tableLoading ? (
              <div style={{ padding: 16 }}>Loading attendance…</div>
            ) : (
              <table>
                <thead>
                  <tr><th>#</th><th>Student</th><th>Date</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 16 }}>No records yet.</td></tr>
                  ) : tableRows.map((r, i) => (
                    <tr key={`${r.student_id}-${r.date}-${i}`}>
                      <td>{i + 1}</td>
                      <td>{r.student_name}</td>
                      <td>{r.date}</td>
                      <td>{r.status === 'Present'
                        ? <span className="badge-present">Present</span>
                        : <span className="badge-absent">Absent</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;
