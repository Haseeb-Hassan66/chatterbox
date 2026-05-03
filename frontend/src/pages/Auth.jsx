import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const Auth = () => {
    const navigate = useNavigate();
    const { login, token } = useAuth();
    
    const [tab, setTab] = useState('login'); // 'login' or 'register'
    const [isLoading, setIsLoading] = useState(false);
    
    // Form state
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    
    // Error state
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (token) navigate('/chat');
    }, [token, navigate]);

    const handleTabSwitch = (newTab) => {
        setTab(newTab);
        setErrors({});
        setPassword('');
        setConfirmPassword('');
    };

    const validate = () => {
        const newErrors = {};
        if (username.length < 3) newErrors.username = 'Username must be at least 3 characters';
        if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
        if (tab === 'register' && password !== confirmPassword) {
            newErrors.confirm = 'Passwords do not match';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        
        setIsLoading(true);
        try {
            if (tab === 'login') {
                const res = await api.post('/auth/login', { username, password });
                login(res.data.user, res.data.token);
                navigate('/chat');
            } else {
                await api.post('/auth/register', { username, password });
                handleTabSwitch('login'); // switch to login after successful register
            }
        } catch (err) {
            setErrors({ global: err.response?.data?.detail || 'Authentication failed' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="card">
                <div className="logo">
                    <div className="logo-icon">💬</div>
                    <h1>ChatterBox</h1>
                    <p>Connect with your team in real-time.</p>
                </div>

                <div className="tabs">
                    <div className={`tab ${tab === 'login' ? 'active' : ''}`} onClick={() => handleTabSwitch('login')}>Login</div>
                    <div className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => handleTabSwitch('register')}>Register</div>
                </div>

                <form className="form active" onSubmit={handleSubmit}>
                    <div className="field">
                        <input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className={errors.username ? 'error' : ''}
                        />
                        {errors.username && <span className="field-err show">{errors.username}</span>}
                    </div>

                    <div className="field">
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={errors.password ? 'error' : ''}
                        />
                        {errors.password && <span className="field-err show">{errors.password}</span>}
                    </div>

                    {tab === 'register' && (
                        <div className="field">
                            <input
                                type="password"
                                placeholder="Confirm Password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className={errors.confirm ? 'error' : ''}
                            />
                            {errors.confirm && <span className="field-err show">{errors.confirm}</span>}
                        </div>
                    )}

                    {errors.global && <div style={{ color: '#e53935', fontSize: '14px', textAlign: 'center', marginTop: '10px' }}>{errors.global}</div>}

                    <button type="submit" className="btn" disabled={isLoading}>
                        {isLoading ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Auth;
