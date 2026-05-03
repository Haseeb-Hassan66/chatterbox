import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './pages/Auth';
import ChatDashboard from './pages/ChatDashboard';
import Stats from './pages/Stats';

const ProtectedRoute = ({ children }) => {
    const { token } = useAuth();
    if (!token) {
        return <Navigate to="/" replace />;
    }
    return children;
};

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/" element={<Auth />} />
            <Route
                path="/chat"
                element={
                    <ProtectedRoute>
                        <ChatDashboard />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/stats"
                element={
                    <ProtectedRoute>
                        <Stats />
                    </ProtectedRoute>
                }
            />
        </Routes>
    );
};

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
