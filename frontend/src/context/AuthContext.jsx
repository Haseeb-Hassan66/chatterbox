import { createContext, useContext, useState, useEffect } from 'react';
import socket from '../services/socket';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        const storedUser = localStorage.getItem('user');
        return storedUser ? JSON.parse(storedUser) : null;
    });

    const [token, setToken] = useState(() => localStorage.getItem('token'));

    useEffect(() => {
        if (user && token) {
            socket.auth = { token };
            socket.connect();
            // Re-emit set_online on every connect AND reconnect
            const handleConnect = () => {
                socket.emit('set_online', { userId: user.id });
            };
            socket.on('connect', handleConnect);
            return () => {
                socket.off('connect', handleConnect);
            };
        } else {
            socket.disconnect();
        }
    }, [user, token]);

    const login = (userData, authToken) => {
        setUser(userData);
        setToken(authToken);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('token', authToken);
    };

    const logout = () => {
        if (user) {
            socket.emit('set_offline', { userId: user.id });
        }
        setUser(null);
        setToken(null);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
