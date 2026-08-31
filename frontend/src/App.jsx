import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/login';
import Signup from './pages/signup';
import Dashboard from './pages/dashboard';
import Layout from './components/layout';
import ProtectedRoute from './components/protectedRoute';
import Projects from './pages/projects';
import KanbanBoard from './pages/kanbanboard';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                
                {/* Protected Layout Routes */}
                <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/projects" element={<Projects />} />
                    <Route path="/kanban" element={<KanbanBoard />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}