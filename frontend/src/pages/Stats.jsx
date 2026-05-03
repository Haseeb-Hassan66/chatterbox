import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { ArrowLeft, BarChart2 } from 'lucide-react';

const Stats = () => {
    const navigate = useNavigate();
    const { user, token } = useAuth();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!token) {
            navigate('/');
            return;
        }

        const fetchStats = async () => {
            try {
                const res = await api.get('/stats/group-activity');
                setStats(res.data);
            } catch (err) {
                console.error('Failed to load stats', err);
                setError(true);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [token, navigate]);

    if (loading) {
        return (
            <div className="stats-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg)' }}>
                <div style={{ color: 'var(--muted)', fontSize: '15px' }}>Loading statistics...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="stats-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg)' }}>
                <div style={{ background: 'white', padding: '40px', borderRadius: '16px', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    <h2 style={{ color: '#e53935', marginBottom: '10px' }}>Server Error</h2>
                    <p style={{ color: 'var(--muted)', marginBottom: '20px' }}>Could not load statistics data. Is the backend running?</p>
                    <button className="btn" onClick={() => navigate('/chat')}>Back to Chat</button>
                </div>
            </div>
        );
    }

    const { total_messages, top_groups } = stats;
    const maxMsgs = top_groups.length ? Math.max(...top_groups.map(g => g.msg_count)) : 0;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: "'Inter', sans-serif" }}>
            <div style={{ background: 'linear-gradient(135deg, #0d3d37, #128c7e)', padding: '40px 20px', color: 'white' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
                    <button
                        onClick={() => navigate('/chat')}
                        style={{ position: 'absolute', left: 0, top: '0px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', background: 'rgba(255,255,255,0.2)', borderRadius: '16px', marginBottom: '16px' }}>
                            <BarChart2 size={32} />
                        </div>
                        <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '8px' }}>Server Statistics</h1>
                        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '15px' }}>Real-time activity overview</p>
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: '800px', margin: '-30px auto 40px', padding: '0 20px', position: 'relative', zIndex: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                    <div style={{ background: 'white', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
                        <div style={{ color: 'var(--muted)', fontSize: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Total Messages</div>
                        <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--green)' }}>{total_messages.toLocaleString()}</div>
                    </div>
                    <div style={{ background: 'white', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
                        <div style={{ color: 'var(--muted)', fontSize: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Active Groups</div>
                        <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--text)' }}>{top_groups.length}</div>
                    </div>
                </div>

                <div style={{ background: 'white', borderRadius: '16px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px', color: 'var(--text)' }}>Most Active Groups</h3>
                    {top_groups.length === 0 ? (
                        <p style={{ color: 'var(--muted)' }}>No messages sent yet.</p>
                    ) : (
                        top_groups.map((g, index) => {
                            const pct = Math.max((g.msg_count / maxMsgs) * 100, 2);
                            let medal = '';
                            if (index === 0) medal = '🥇 ';
                            if (index === 1) medal = '🥈 ';
                            if (index === 2) medal = '🥉 ';

                            return (
                                <div key={g._id} style={{ marginBottom: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                                        <span>{medal}{g.groupInfo?.name || 'Unknown'}</span>
                                        <span>{g.msg_count.toLocaleString()} msgs</span>
                                    </div>
                                    <div style={{ height: '12px', background: '#e9edef', borderRadius: '6px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', background: 'linear-gradient(90deg, #128c7e, #25d4be)', borderRadius: '6px', width: `${pct}%`, transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)' }}></div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default Stats;
