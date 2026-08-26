import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import IssueList from './pages/IssueList';
import CreateIssue from './pages/CreateIssue';
import IssueView from './pages/IssueView';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/issues" element={<IssueList />} />
        <Route path="/issues/new" element={<CreateIssue />} />
        <Route path="/issues/:id" element={<IssueView />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;