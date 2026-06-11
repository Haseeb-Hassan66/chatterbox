import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import socket from '../services/socket';
import { LogOut, Plus, Search, BarChart2 } from 'lucide-react';

const COLORS = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f4511e', '#6d4c41', '#00acc1', '#3949ab', '#7cb342', '#d81b60'];
function avatarColor(str) { 
    if(!str) return COLORS[0];
    let h = 0; 
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff; 
    return COLORS[h % COLORS.length]; 
}

function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const playNotificationSound = () => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.warn('Audio context error:', e);
    }
};

export default function ChatDashboard() {
    const navigate = useNavigate();
    const { user, token, logout } = useAuth();
    
    const [groups, setGroups] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [currentSideTab, setCurrentSideTab] = useState('chats');
    const [sideSearch, setSideSearch] = useState('');
    
    const [currentChat, setCurrentChat] = useState(null);
    const currentChatRef = useRef(null);
    const [messages, setMessages] = useState([]);
    const [unreadCounts, setUnreadCounts] = useState({});
    
    const [typingStatus, setTypingStatus] = useState('');
    const typingTimeoutRef = useRef(null);
    const messagesEndRef = useRef(null);
    const userRef = useRef(user);
    // Tracks whether the browser tab/window is currently visible and focused
    const windowFocusedRef = useRef(!document.hidden);
    
    const [msgInput, setMsgInput] = useState('');
    const [deleteMode, setDeleteMode] = useState('manual');
    
    // Modals
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [selectedMembers, setSelectedMembers] = useState([]);
    const [searchQ, setSearchQ] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [messageToDelete, setMessageToDelete] = useState(null);
    const [alertMsg, setAlertMsg] = useState(null);
    const [toasts, setToasts] = useState([]);

    // Keep refs in sync with latest state so socket handlers never use stale closures
    useEffect(() => { currentChatRef.current = currentChat; }, [currentChat]);
    useEffect(() => { userRef.current = user; }, [user]);

    // Track browser tab visibility so we know if the user can actually see the chat
    useEffect(() => {
        const onVisible = () => { windowFocusedRef.current = true; };
        const onHidden  = () => { windowFocusedRef.current = false; };
        const handleVisibility = () => { if (document.hidden) onHidden(); else onVisible(); };
        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('focus', onVisible);
        window.addEventListener('blur',  onHidden);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('focus', onVisible);
            window.removeEventListener('blur',  onHidden);
        };
    }, []);


    const loadInitialData = useCallback(async () => {
        try {
            const [gRes, uRes] = await Promise.all([
                api.get(`/groups/user/${userRef.current.id}`),
                api.get('/auth/users')
            ]);
            setGroups(gRes.data);
            const initialUnreads = {};
            gRes.data.forEach(g => {
                if (g.unreadCount > 0) initialUnreads[g.id] = g.unreadCount;
            });
            setUnreadCounts(initialUnreads);
            setAllUsers(uRes.data);
        } catch (err) {
            console.error('Failed to load initial data');
        }
    // userRef is a ref — stable by definition, no need in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!token) return;
        loadInitialData();
    }, [token, user.id, loadInitialData]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        // ─── new_message ─────────────────────────────────────────────────
        const handleNewMessage = (msg) => {
            const me = userRef.current;
            if (!me) return; // Guard: user logged out or component unmounting

            const activeChatId = currentChatRef.current?.id;
            // "foreground" = this exact conversation's panel is open right now.
            // We never need sound/toast for the chat the user is actively reading.
            // For OTHER chats: only notify if the window is actually visible so we
            // don't spam sounds when the user has the page open in a background tab.
            const isThisChat = activeChatId === msg.groupId;
            const isActiveChatFocused = isThisChat;  // open chat → always silent

            // ── 1. Always update the sidebar preview ──────────────────────
            setGroups(prevGroups => {
                const idx = prevGroups.findIndex(x => x.id === msg.groupId);
                if (idx === -1) {
                    // Group not in local state yet (first DM ever received).
                    // Background refresh; return unchanged synchronously.
                    api.get(`/groups/user/${me.id}`).then(res => {
                        setGroups(res.data);
                        const initialUnreads = {};
                        res.data.forEach(g => {
                            if (g.unreadCount > 0) initialUnreads[g.id] = g.unreadCount;
                        });
                        setUnreadCounts(initialUnreads);
                    });
                    return prevGroups;
                }
                const updated = [...prevGroups];
                updated[idx] = {
                    ...updated[idx],
                    lastMessage: {
                        content: msg.content,
                        senderName: msg.senderName,
                        senderId: msg.senderId,
                        createdAt: msg.createdAt
                    }
                };
                return updated;
            });

            // ── 2. If the chat is open on the right panel, render the msg ─
            if (activeChatId === msg.groupId) {
                setMessages(prev => [...prev, msg]);
            }

            // ── 3. Route notification vs. silent-read ─────────────────────
            if (isActiveChatFocused) {
                // User is on Chats tab with this chat open — mark as read now
                if (msg.senderId !== me.id) {
                    socket.emit('mark_read', {
                        messageId: msg._id,
                        userId: me.id,
                        groupId: msg.groupId
                    });
                }
            } else {
                // Background or wrong-tab — always show an unread badge so the
                // user is notified even when on People / Groups tab
                if (msg.senderId !== me.id) {
                    setUnreadCounts(prev => ({
                        ...prev,
                        [msg.groupId]: (prev[msg.groupId] || 0) + 1
                    }));
                }
            }

            if (msg.senderId !== me.id) {
                // Only silence notifications if the user is actively viewing this specific chat room (tab is visible AND chat is active).
                // In all other cases (e.g. they are in another chat, on Groups/People tab, or the tab is hidden), they get sound/toast.
                const isViewingThisChat = (activeChatId === msg.groupId) && !document.hidden;

                if (!isViewingThisChat) {
                    playNotificationSound();
                    const id = Date.now() + Math.random();
                    setToasts(prev => [...prev, {
                        id,
                        title: msg.senderName || 'New Message',
                        content: msg.content,
                        groupId: msg.groupId
                    }]);
                    setTimeout(() => {
                        setToasts(curr => curr.filter(t => t.id !== id));
                    }, 4000);
                }
            }
        };

        // ─── message_deleted ─────────────────────────────────────────────
        const handleMessageDeleted = ({ messageId, groupId, newLastMessage }) => {
            setMessages(prev => prev.filter(m => m._id !== messageId));
            setGroups(prevGroups => {
                const idx = prevGroups.findIndex(x => x.id === groupId);
                if (idx === -1) return prevGroups;
                const updated = [...prevGroups];
                updated[idx] = { ...updated[idx], lastMessage: newLastMessage };
                return updated;
            });
        };

        // ─── message_read ────────────────────────────────────────────────
        const handleMessageRead = ({ messageId, userId }) => {
            setMessages(prev => prev.map(m => {
                if (m._id !== messageId) return m;
                const reads = m.readBy || [];
                if (reads.includes(userId)) return m;
                return { ...m, readBy: [...reads, userId] };
            }));
        };

        // ─── user_typing ─────────────────────────────────────────────────
        const handleUserTyping = ({ username, groupId }) => {
            const me = userRef.current;
            if (!me) return; // Guard: user logged out
            const activeChatId = currentChatRef.current?.id;
            if (activeChatId && groupId === activeChatId && username !== me.username) {
                setTypingStatus(`${username} is typing...`);
                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = setTimeout(() => setTypingStatus(''), 2500);
            }
        };

        // ─── user_status ─────────────────────────────────────────────────
        const handleUserStatus = ({ userId, isOnline }) => {
            setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, isOnline } : u));
        };

        // ─── group_added ─────────────────────────────────────────────────
        const handleGroupAdded = ({ groupId }) => {
            const me = userRef.current;
            if (!me) return; // Guard: user logged out
            socket.emit('join_group', { groupId });
            // Full refresh so unread counts + users are also updated
            loadInitialData();
        };

        // ─── reconnect: reload fresh data AND re-join all rooms ────────
        const handleReconnect = () => {
            const me = userRef.current;
            if (!me) return;
            // Re-join every group room so incoming messages are received again.
            // We read groupsRef lazily via the API to avoid a stale closure.
            api.get(`/groups/user/${me.id}`).then(res => {
                setGroups(res.data);
                const unreads = {};
                res.data.forEach(g => {
                    if (g.unreadCount > 0) unreads[g.id] = g.unreadCount;
                    socket.emit('join_group', { groupId: g.id });
                });
                setUnreadCounts(unreads);
            }).catch(() => {});
            // Also refresh the user list
            api.get('/auth/users').then(res => setAllUsers(res.data)).catch(() => {});
        };

        socket.on('new_message',    handleNewMessage);
        socket.on('message_deleted', handleMessageDeleted);
        socket.on('message_read',   handleMessageRead);
        socket.on('user_typing',    handleUserTyping);
        socket.on('user_status',    handleUserStatus);
        socket.on('group_added',    handleGroupAdded);
        socket.on('connect',        handleReconnect);

        return () => {
            socket.off('new_message',    handleNewMessage);
            socket.off('message_deleted', handleMessageDeleted);
            socket.off('message_read',   handleMessageRead);
            socket.off('user_typing',    handleUserTyping);
            socket.off('user_status',    handleUserStatus);
            socket.off('group_added',    handleGroupAdded);
            socket.off('connect',        handleReconnect);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Intentionally empty — refs keep values fresh without re-registering

    // When the user returns to the Chats tab with the current chat open,
    // mark any messages that accumulated while they were on People/Groups tab
    // as read so the sender gets the double-tick and the badge clears.
    useEffect(() => {
        if (currentSideTab === 'chats' && currentChat) {
            const hasUnread = (unreadCounts[currentChat.id] || 0) > 0;
            if (hasUnread) {
                setUnreadCounts(prev => ({ ...prev, [currentChat.id]: 0 }));
                // Re-emit mark_read for every unread message currently loaded
                messages.forEach(m => {
                    if (
                        m.senderId !== user.id &&
                        (!m.readBy || !m.readBy.includes(user.id))
                    ) {
                        socket.emit('mark_read', {
                            messageId: m._id,
                            userId: user.id,
                            groupId: currentChat.id
                        });
                    }
                });
            }
        }
    // We intentionally omit messages/unreadCounts/user from deps — we only
    // want this to fire when the tab or active chat changes, not on every msg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSideTab, currentChat?.id]);

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const findDMGroup = (otherId) => groups.find(g => g.isDM && g.members.includes(user.id) && g.members.includes(otherId));
    const getDMPartner = (g) => {
        const otherId = g.members.find(id => id !== user.id);
        return allUsers.find(u => u.id === otherId);
    };

    const openGroupChat = async (g) => {
        // Clear any typing indicator that was showing for the previous chat
        setTypingStatus('');
        if (typingTimeoutRef.current) { clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = null; }
        setCurrentChat({ id: g.id, type: 'group', name: g.name, membersCount: g.members.length });
        setUnreadCounts(prev => ({ ...prev, [g.id]: 0 }));
        socket.emit('join_group', { groupId: g.id });
        loadMessages(g.id);
    };

    const openDMChat = async (otherUser) => {
        try {
            let dmGroup = findDMGroup(otherUser.id);
            if (!dmGroup) {
                try {
                    const findRes = await api.get(`/groups/dm/${user.id}/${otherUser.id}`);
                    dmGroup = findRes.data;
                    if (!groups.find(g => g.id === dmGroup.id)) setGroups(prev => [...prev, dmGroup]);
                } catch (e) {
                    const createRes = await api.post(`/groups/create`, {
                        name: [user.username, otherUser.username].sort().join(' & '),
                        adminId: user.id,
                        members: [otherUser.id],
                        isDM: true
                    });
                    const gRes = await api.get(`/groups/user/${user.id}`);
                    setGroups(gRes.data);
                    dmGroup = gRes.data.find(g => g.id === createRes.data.id);
                    if (dmGroup) {
                        socket.emit('join_group', { groupId: dmGroup.id });
                        socket.emit('notify_new_group', { groupId: dmGroup.id, members: [user.id, otherUser.id] });
                    }
                }
            }
            if (!dmGroup) throw new Error('Could not open conversation');

            // Clear any typing indicator that was showing for the previous chat
            setTypingStatus('');
            if (typingTimeoutRef.current) { clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = null; }
            setCurrentChat({ id: dmGroup.id, type: 'dm', name: otherUser.username, otherId: otherUser.id });
            setUnreadCounts(prev => ({ ...prev, [dmGroup.id]: 0 }));
            socket.emit('join_group', { groupId: dmGroup.id });
            loadMessages(dmGroup.id);
        } catch (err) {
            setAlertMsg('Could not open conversation');
        }
    };

    const loadMessages = async (groupId) => {
        setMessages([]);
        try {
            const res = await api.get(`/groups/${groupId}/messages`);
            setMessages(res.data);
            res.data.forEach(m => {
                if (m.senderId !== user.id && (!m.readBy || !m.readBy.includes(user.id))) {
                    socket.emit('mark_read', { messageId: m._id, userId: user.id, groupId });
                }
            });
        } catch (err) {
            console.error('Failed to load messages');
        }
    };

    const handleToastClick = async (t) => {
        setToasts(prev => prev.filter(x => x.id !== t.id));
        let targetGroup = groups.find(g => g.id === t.groupId);
        if (!targetGroup) {
            try {
                const res = await api.get(`/groups/user/${user.id}`);
                setGroups(res.data);
                targetGroup = res.data.find(g => g.id === t.groupId);
            } catch (err) {
                console.error('Failed to load group on toast click', err);
            }
        }
        if (targetGroup) {
            if (targetGroup.isDM) {
                const partner = getDMPartner(targetGroup);
                if (partner) {
                    openDMChat(partner);
                } else {
                    openGroupChat(targetGroup);
                }
            } else {
                openGroupChat(targetGroup);
            }
        }
        setCurrentSideTab('chats');
    };

    const sendMessage = () => {
        if (!msgInput.trim() || !currentChat) return;
        socket.emit('send_message', {
            groupId: currentChat.id,
            senderId: user.id,
            content: msgInput.trim(),
            deleteMode
        });
        setMsgInput('');
        setCurrentSideTab('chats');
    };

    const handleInputKeyDown = (e) => {
        if (e.key === 'Enter') { sendMessage(); return; }
        if (currentChat && e.key.length === 1) {
            socket.emit('typing', { userId: user.id, username: user.username, groupId: currentChat.id });
        }
    };

    const deleteMessage = (id) => {
        setMessageToDelete(id);
    };

    const confirmDeleteMessage = () => {
        if (!currentChat || !messageToDelete) return;
        socket.emit('delete_message', { messageId: messageToDelete, groupId: currentChat.id });
        setMessageToDelete(null);
    };

    const handleCreateGroup = async () => {
        if (!newGroupName.trim() || !selectedMembers.length) {
            setAlertMsg('Please enter a group name and select at least one member.');
            return;
        }
        try {
            const res = await api.post('/groups/create', { name: newGroupName, adminId: user.id, members: selectedMembers });
            setShowCreateGroup(false);
            const gRes = await api.get(`/groups/user/${user.id}`);
            setGroups(gRes.data);
            if (res.data.id) {
                socket.emit('join_group', { groupId: res.data.id });
                socket.emit('notify_new_group', { groupId: res.data.id, members: [...selectedMembers, user.id] });
            }
        } catch (err) {
            setAlertMsg('Failed to create group');
        }
    };

    const handleSearch = async () => {
        if (!searchQ.trim() || !currentChat) return;
        const res = await api.get(`/groups/${currentChat.id}/search?q=${encodeURIComponent(searchQ)}`);
        setSearchResults(res.data);
    };

    const filteredChats = groups.filter(g => {
        // Show if it has messages OR has unread count (newly added group with pending msgs)
        const hasActivity = !!g.lastMessage || (unreadCounts[g.id] || 0) > 0;
        if (!hasActivity) return false;

        if (g.isDM) {
            const p = getDMPartner(g);
            return p && p.username.toLowerCase().includes(sideSearch.toLowerCase());
        }
        return g.name.toLowerCase().includes(sideSearch.toLowerCase());
    }).sort((a, b) => {
        const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
        const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
        return timeB - timeA;
    });

    const filteredGroups = groups.filter(g => !g.isDM && g.name.toLowerCase().includes(sideSearch.toLowerCase()))
        .sort((a, b) => (unreadCounts[b.id] || 0) - (unreadCounts[a.id] || 0));

    const filteredPeople = allUsers.filter(u => u.id !== user.id && u.username.toLowerCase().includes(sideSearch.toLowerCase()))
        .sort((a, b) => a.username.localeCompare(b.username));

    const chatsUnread = groups.some(g => (unreadCounts[g.id] || 0) > 0);
    const groupsUnread = groups.some(g => !g.isDM && (unreadCounts[g.id] || 0) > 0);
    // People tab intentionally has NO dot — DM unreads are already visible in the Chats tab.

    let lastDate = '';

    return (
        <div className="app-container">
            {/* Toast Notifications */}
            <div className="toasts-container">
                {toasts.map(t => (
                    <div key={t.id} className="toast" onClick={() => handleToastClick(t)}>
                        <div className="toast-header">
                            <span className="toast-title">💬 {t.title}</span>
                            <button className="toast-close" onClick={(e) => { e.stopPropagation(); setToasts(prev => prev.filter(x => x.id !== t.id)); }}>✕</button>
                        </div>
                        <div className="toast-body">{t.content}</div>
                    </div>
                ))}
            </div>

            {/* Sidebar */}
            <div className="sidebar">
                <div className="sidebar-header">
                    <h2>ChatterBox</h2>
                    <div className="header-btns">
                        <button className="hbtn" onClick={() => { setShowCreateGroup(true); setNewGroupName(''); setSelectedMembers([]); }}><Plus size={14} style={{verticalAlign: 'text-bottom'}} /> Group</button>
                        <button className="hbtn" onClick={handleLogout}><LogOut size={14} style={{verticalAlign: 'text-bottom'}} /> Logout</button>
                    </div>
                </div>
                <div className="sidebar-tabs">
                    <div className={`stab ${currentSideTab === 'chats' ? 'active' : ''}`} onClick={() => setCurrentSideTab('chats')}>
                        Chats {chatsUnread && <span className="tab-dot"></span>}
                    </div>
                    <div className={`stab ${currentSideTab === 'groups' ? 'active' : ''}`} onClick={() => setCurrentSideTab('groups')}>
                        Groups {groupsUnread && <span className="tab-dot"></span>}
                    </div>
                    <div className={`stab ${currentSideTab === 'people' ? 'active' : ''}`} onClick={() => setCurrentSideTab('people')}>
                        People
                    </div>
                </div>
                <div className="search-wrap">
                    <input id="sideSearch" placeholder="Search..." value={sideSearch} onChange={e => setSideSearch(e.target.value)} />
                </div>
                <div className="list-area">
                    {currentSideTab === 'chats' && (
                        filteredChats.length === 0 ? <div style={{padding:'20px', textAlign:'center', color:'var(--muted)'}}>No chats yet.</div> :
                        filteredChats.map(g => {
                            const partner = g.isDM ? getDMPartner(g) : null;
                            const name = g.isDM ? (partner?.username || 'Unknown') : g.name;
                            const unread = unreadCounts[g.id] || 0;
                            let preview = g.isDM ? (partner?.isOnline ? '🟢 Online' : '⚫ Offline') : `${g.members.length} members`;
                            let time = '';
                            if (g.lastMessage) {
                                const isSenderMe = g.lastMessage.senderId === user.id || g.lastMessage.senderName === user.username;
                                const senderDisplay = isSenderMe ? 'You' : g.lastMessage.senderName;
                                preview = (senderDisplay ? senderDisplay + ': ' : '') + g.lastMessage.content;
                                time = fmtTime(g.lastMessage.createdAt);
                            }
                            return (
                                <div key={g.id} className={`list-item ${currentChat?.id === g.id ? 'active' : ''} ${unread ? 'has-unread' : ''}`} onClick={() => g.isDM ? openDMChat(partner) : openGroupChat(g)}>
                                    <div className="avatar" style={{background: avatarColor(name)}}>
                                        {name[0].toUpperCase()}
                                        {g.isDM && partner && <div className={partner.isOnline ? 'online-dot' : 'offline-dot'}></div>}
                                    </div>
                                    <div className="item-info">
                                        <div className="item-name"><span>{name}</span><span className="time">{time}</span></div>
                                        <div className="item-preview"><span>{preview.length > 36 ? preview.slice(0, 36) + '…' : preview}</span>{unread > 0 && <span className="unread">{unread}</span>}</div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    {currentSideTab === 'groups' && (
                        filteredGroups.length === 0 ? <div style={{padding:'20px', textAlign:'center', color:'var(--muted)'}}>No groups yet.</div> :
                        filteredGroups.map(g => {
                            const unread = unreadCounts[g.id] || 0;
                            return (
                                <div key={g.id} className={`list-item ${currentChat?.id === g.id ? 'active' : ''} ${unread ? 'has-unread' : ''}`} onClick={() => openGroupChat(g)}>
                                    <div className="avatar" style={{background: avatarColor(g.name)}}>{g.name[0].toUpperCase()}</div>
                                    <div className="item-info">
                                        <div className="item-name"><span>{g.name}</span></div>
                                        <div className="item-preview"><span>{g.members.length} members</span>{unread > 0 && <span className="unread">{unread}</span>}</div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    {currentSideTab === 'people' && (
                        filteredPeople.length === 0 ? <div style={{padding:'20px', textAlign:'center', color:'var(--muted)'}}>No other users yet.</div> :
                        filteredPeople.map(u => {
                            const dm = findDMGroup(u.id);
                            return (
                                <div key={u.id} className={`list-item people-item ${currentChat?.id === dm?.id ? 'active' : ''}`} onClick={() => openDMChat(u)}>
                                    <div className="avatar" style={{background: avatarColor(u.username)}}>{u.username[0].toUpperCase()}<div className={u.isOnline ? 'online-dot' : 'offline-dot'}></div></div>
                                    <div className="item-info">
                                        <div className="item-name"><span>{u.username}</span></div>
                                        <div className="item-preview"><span>{u.isOnline ? '🟢 Online' : '⚫ Offline'}</span></div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Chat Area */}
            {!currentChat ? (
                <div className="no-chat">
                    <div className="nc-icon">💬</div>
                    <p>Select a conversation to start chatting</p>
                </div>
            ) : (
                <div className="chat-view">
                    <div className="chat-header">
                        <div className="ch-avatar" style={{background: avatarColor(currentChat.name)}}>{currentChat.name[0].toUpperCase()}</div>
                        <div className="ch-info">
                            <h3>{currentChat.name}</h3>
                            <p>
                                {currentChat.type === 'group' ? `${currentChat.membersCount} members` : 
                                 (allUsers.find(u => u.id === currentChat.otherId)?.isOnline ? '🟢 Online' : '⚫ Offline')}
                            </p>
                        </div>
                        <div className="ch-actions">
                            <button onClick={() => { setSearchQ(''); setSearchResults([]); setShowSearch(true); }}><Search size={14} style={{verticalAlign:'text-bottom', marginRight:'4px'}}/> Search</button>
                            <button onClick={() => navigate('/stats')}><BarChart2 size={14} style={{verticalAlign:'text-bottom', marginRight:'4px'}}/> Stats</button>
                        </div>
                    </div>
                    
                    <div className="messages" style={{flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px'}}>
                        {messages.length === 0 ? <div style={{textAlign:'center', color:'var(--muted)', marginTop:'40px'}}>No messages yet. Say hello! 👋</div> : 
                        messages.map((msg, i) => {
                            const isMine = msg.senderId === user.id;
                            const isSeen = msg.readBy && msg.readBy.some(id => id !== user.id);
                            const dStr = new Date(msg.createdAt).toDateString();
                            let showDivider = false;
                            if (dStr !== lastDate) { showDivider = true; lastDate = dStr; }

                            return (
                                <div key={msg._id || i}>
                                    {showDivider && (
                                        <div className="date-divider">
                                            <span>{dStr === new Date().toDateString() ? 'Today' : dStr}</span>
                                        </div>
                                    )}
                                    <div className={`msg-wrap ${isMine ? 'sent' : 'received'}`}>
                                        <div className={`bubble ${isMine ? 'sent' : 'received'}`}>
                                            {!isMine && <div className="sender-name" style={{color: avatarColor(msg.senderName || '?')}}>{msg.senderName || 'Unknown'}</div>}
                                            <div>{msg.content}</div>
                                            <div className="bubble-footer">
                                                {msg.deleteMode !== 'manual' && <span className="bubble-expiry">{msg.deleteMode === '24h' ? '⏱ 24h' : '📅 7d'}</span>}
                                                <span className="bubble-time">{fmtTime(msg.createdAt)}</span>
                                                {isMine && <span className={`read-tick ${isSeen ? 'seen' : ''}`} title={isSeen ? 'Seen' : 'Sent'}>{isSeen ? '✓✓' : '✓'}</span>}
                                                {isMine && !isSeen && <button className="del-btn" onClick={() => deleteMessage(msg._id)}>✕</button>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="typing-bar">{typingStatus}</div>
                    
                    <div className="input-row">
                        <select value={deleteMode} onChange={e => setDeleteMode(e.target.value)}>
                            <option value="manual">&#128274; Keep</option>
                            <option value="24h">&#128337; 24h</option>
                            <option value="7d">&#128197; 7 days</option>
                        </select>
                        <input className="msg-input" value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={handleInputKeyDown} placeholder="Type a message..." />
                        <button className="send-btn" onClick={sendMessage}>&#10148;</button>
                    </div>
                </div>
            )}

            {/* Modals */}
            {showCreateGroup && (
                <div className="overlay open" onClick={e => { if(e.target===e.currentTarget) setShowCreateGroup(false); }}>
                    <div className="modal">
                        <h3>Create New Group</h3>
                        <input className="modal-input" placeholder="Group name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                        <p style={{fontSize:'13px', color:'var(--muted)', marginBottom:'10px'}}>Add members:</p>
                        <div className="user-grid">
                            {allUsers.filter(u => u.id !== user.id).map(u => (
                                <div key={u.id} className={`user-pick ${selectedMembers.includes(u.id) ? 'selected' : ''}`} onClick={() => setSelectedMembers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])}>
                                    <div className="up-avatar" style={{background: avatarColor(u.username)}}>{u.username[0].toUpperCase()}<div className={u.isOnline ? 'online-dot' : 'offline-dot'} style={{borderColor:'#fff'}}></div></div>
                                    <div><div className="up-name">{u.username}</div><div className="up-status">{u.isOnline ? 'Online' : 'Offline'}</div></div>
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-cancel" onClick={() => setShowCreateGroup(false)}>Cancel</button>
                            <button className="btn" onClick={handleCreateGroup}>Create</button>
                        </div>
                    </div>
                </div>
            )}

            {showSearch && (
                <div className="overlay open" onClick={e => { if(e.target===e.currentTarget) setShowSearch(false); }}>
                    <div className="modal">
                        <h3>Search in "{currentChat?.name}"</h3>
                        <input className="modal-input" placeholder="Type keyword and press Enter" value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
                        <div style={{maxHeight:'300px', overflowY:'auto'}}>
                            {searchResults.length === 0 ? <p style={{color:'var(--muted)', fontSize:'14px', padding:'10px 0'}}>No results found.</p> : 
                            searchResults.map((m, i) => (
                                <div key={i} style={{padding:'10px', borderBottom:'1px solid var(--border)'}}>
                                    <div style={{fontWeight:600, fontSize:'14px', marginBottom:'4px'}}>{m.senderName || 'Unknown'}</div>
                                    <div style={{fontSize:'14px', marginBottom:'4px'}}>{m.content}</div>
                                    <div style={{fontSize:'11px', color:'var(--muted)'}}>{new Date(m.createdAt).toLocaleString()}</div>
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer" style={{marginTop:'16px'}}>
                            <button className="btn btn-cancel" onClick={() => setShowSearch(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {messageToDelete && (
                <div className="overlay open" onClick={e => { if(e.target===e.currentTarget) setMessageToDelete(null); }}>
                    <div className="modal" style={{ maxWidth: '360px' }}>
                        <h3>Delete message?</h3>
                        <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '20px', lineHeight: '1.5' }}>
                            Are you sure you want to delete this message? This action cannot be undone.
                        </p>
                        <div className="modal-footer">
                            <button className="btn btn-cancel" onClick={() => setMessageToDelete(null)}>Cancel</button>
                            <button className="btn" style={{ background: '#e53935' }} onClick={confirmDeleteMessage}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {alertMsg && (
                <div className="overlay open" onClick={e => { if(e.target===e.currentTarget) setAlertMsg(null); }}>
                    <div className="modal" style={{ maxWidth: '360px' }}>
                        <h3>Alert</h3>
                        <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '20px', lineHeight: '1.5' }}>
                            {alertMsg}
                        </p>
                        <div className="modal-footer">
                            <button className="btn" onClick={() => setAlertMsg(null)}>OK</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
