import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { ArrowLeft, BarChart2, MessageSquare, Users, TrendingUp, Clock } from 'lucide-react';

const COLORS = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f4511e', '#6d4c41', '#00acc1', '#3949ab', '#7cb342', '#d81b60'];
function avatarColor(str) {
    if (!str) return COLORS[0];
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
    return COLORS[h % COLORS.length];
}

function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const Stats = () => {
    const navigate = useNavigate();
    const { user, token } = useAuth();
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!token) { navigate('/'); return; }
        const fetchStats = async () => {
            try {
                const res = await api.get('/stats/group-activity');
                setStats(res.data);
            } catch {
                setError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [token, navigate]);

    const totalMessages = stats.reduce((sum, g) => sum + (g.messageCount || 0), 0);
    const maxMsgs = stats.length ? Math.max(...stats.map(g => g.messageCount || 0)) : 1;

    return (
        <div className="app-container">
            {/* Left panel — mirrors the sidebar style */}
            <div className="sidebar">
                <div className="sidebar-header" style={{ background: 'var(--bg)' }}>
                    <h2>Statistics</h2>
                    <button
                        className="hbtn"
                        onClick={() => navigate('/chat')}
                        title="Back to Chat"
                    >
                        <ArrowLeft size={14} style={{ verticalAlign: 'text-bottom', marginRight: '4px' }} />
                        Back
                    </button>
                </div>

                {/* Summary cards stacked in sidebar */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--bg)' }}>
                    <StatCard
                        icon={<MessageSquare size={20} color="var(--green)" />}
                        label="Total Messages"
                        value={loading ? '…' : totalMessages.toLocaleString()}
                        accent="var(--green)"
                    />
                    <StatCard
                        icon={<Users size={20} color="#1e88e5" />}
                        label="Active Groups"
                        value={loading ? '…' : stats.length.toString()}
                        accent="#1e88e5"
                    />
                    <StatCard
                        icon={<TrendingUp size={20} color="#8e24aa" />}
                        label="Top Group"
                        value={loading || !stats.length ? '—' : (stats[0].groupName || 'Unknown')}
                        accent="#8e24aa"
                        small
                    />
                    <StatCard
                        icon={<Clock size={20} color="#f4511e" />}
                        label="Last Activity"
                        value={loading || !stats.length ? '—' : fmtDate(stats[0].lastMessage)}
                        accent="#f4511e"
                        small
                    />

                    <div style={{ marginTop: '8px', padding: '4px 6px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
                            Group Rankings
                        </div>
                        {loading ? (
                            <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '10px 4px' }}>Loading…</div>
                        ) : error ? (
                            <div style={{ color: '#e53935', fontSize: '13px', padding: '10px 4px' }}>Failed to load</div>
                        ) : stats.length === 0 ? (
                            <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '10px 4px' }}>No data yet.</div>
                        ) : stats.map((g, i) => (
                            <div
                                key={g._id}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '10px',
                                    padding: '9px 6px', borderRadius: '8px',
                                    cursor: 'default',
                                    borderBottom: '1px solid var(--border)',
                                }}
                            >
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '50%',
                                    background: avatarColor(g.groupName),
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'white', fontWeight: 700, fontSize: '15px', flexShrink: 0,
                                }}>
                                    {(g.groupName || '?')[0].toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i + 1}. `}
                                        {g.groupName || 'Unknown'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                                        {g.messageCount.toLocaleString()} messages
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right panel — main stats view */}
            <div className="chat-view" style={{ background: 'var(--bg)' }}>
                {/* Header matches chat-header style */}
                <div className="chat-header">
                    <div className="ch-avatar" style={{ background: 'linear-gradient(135deg, #128c7e, #0a5c53)' }}>
                        <BarChart2 size={18} color="white" />
                    </div>
                    <div className="ch-info">
                        <h3>Server Statistics</h3>
                        <p>Real-time group activity overview</p>
                    </div>
                    <div className="ch-actions">
                        <button onClick={() => navigate('/chat')}>
                            <ArrowLeft size={14} style={{ verticalAlign: 'text-bottom', marginRight: '4px' }} />
                            Back to Chat
                        </button>
                    </div>
                </div>

                {/* Scrollable content area — matches .messages style */}
                <div className="messages" style={{ flexDirection: 'column', gap: '16px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '40px', fontSize: '15px' }}>
                            Loading statistics…
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: 'center', marginTop: '60px' }}>
                            <div style={{ background: 'white', display: 'inline-block', padding: '32px 40px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                                <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
                                <div style={{ fontSize: '16px', fontWeight: 700, color: '#e53935', marginBottom: '6px' }}>Server Error</div>
                                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '20px' }}>Could not load statistics. Is the backend running?</div>
                                <button className="btn" style={{ marginTop: 0 }} onClick={() => navigate('/chat')}>Back to Chat</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Bar chart section */}
                            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '20px' }}>
                                    Message Volume by Group
                                </div>
                                {stats.length === 0 ? (
                                    <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No messages sent yet. Start a conversation! 👋</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {stats.map((g, index) => {
                                            const pct = Math.max((g.messageCount / maxMsgs) * 100, 2);
                                            const color = avatarColor(g.groupName);
                                            return (
                                                <div key={g._id}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                                                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                                                                {index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : ''}
                                                                {g.groupName || 'Unknown'}
                                                            </span>
                                                        </div>
                                                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>
                                                            {g.messageCount.toLocaleString()} msgs
                                                        </span>
                                                    </div>
                                                    <div style={{ height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                                                        <div style={{
                                                            height: '100%',
                                                            width: `${pct}%`,
                                                            background: `linear-gradient(90deg, ${color}cc, ${color})`,
                                                            borderRadius: '5px',
                                                            transition: 'width 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
                                                        }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Detailed group cards */}
                            {stats.length > 0 && (
                                <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '16px' }}>
                                        Group Details
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                                        {stats.map((g) => (
                                            <div key={g._id} style={{
                                                border: '1px solid var(--border)', borderRadius: '10px', padding: '16px',
                                                display: 'flex', flexDirection: 'column', gap: '8px',
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{
                                                        width: '36px', height: '36px', borderRadius: '50%',
                                                        background: avatarColor(g.groupName),
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        color: 'white', fontWeight: 700, fontSize: '15px', flexShrink: 0,
                                                    }}>
                                                        {(g.groupName || '?')[0].toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {g.groupName || 'Unknown'}
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>
                                                            {g.messageCount.toLocaleString()} messages
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: '11px', color: 'var(--muted)', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
                                                    Last active: {fmtDate(g.lastMessage)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

// Reusable summary card for sidebar
function StatCard({ icon, label, value, accent, small }) {
    return (
        <div style={{
            background: 'white', borderRadius: '10px', padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: '12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            borderLeft: `3px solid ${accent}`,
        }}>
            <div style={{
                width: '36px', height: '36px', borderRadius: '8px',
                background: `${accent}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
                {icon}
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {label}
                </div>
                <div style={{
                    fontSize: small ? '14px' : '22px',
                    fontWeight: 800,
                    color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {value}
                </div>
            </div>
        </div>
    );
}

export default Stats;
