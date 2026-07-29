const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory user database
const users = new Map(); // username -> { password, displayName, avatar, bio, role, socketId }

function getOnlineUsers() {
    const list = [];
    users.forEach((data, username) => {
        if (data.socketId) {
            list.push({
                username,
                displayName: data.displayName || username,
                avatar: data.avatar || '',
                bio: data.bio || '',
                role: data.role || 'MEMBER'
            });
        }
    });
    return list;
}

io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('authenticate', ({ username, password, action }) => {
        if (!username || !password) {
            return socket.emit('auth_error', 'Username and password required.');
        }

        if (action === 'register') {
            if (users.has(username)) {
                return socket.emit('auth_error', 'Username already exists.');
            }
            const role = (username.toLowerCase() === 'owner' || username.toLowerCase() === 'rs') ? 'RS FLAGS / OWNER' : 'MEMBER';
            users.set(username, { password, displayName: username, avatar: '', bio: '', role, socketId: socket.id });
            currentUsername = username;
        } else {
            const user = users.get(username);
            if (!user || user.password !== password) {
                return socket.emit('auth_error', 'Invalid username or password.');
            }
            user.socketId = socket.id;
            currentUsername = username;
        }

        const userData = users.get(currentUsername);
        socket.emit('auth_success', {
            username: currentUsername,
            displayName: userData.displayName,
            avatar: userData.avatar,
            bio: userData.bio,
            role: userData.role
        });

        io.emit('update_online_list', getOnlineUsers());
    });

    socket.on('update_profile', ({ displayName, avatar, bio }) => {
        if (!currentUsername) return;
        const user = users.get(currentUsername);
        if (user) {
            if (displayName) user.displayName = displayName;
            if (avatar !== undefined) user.avatar = avatar;
            if (bio !== undefined) user.bio = bio;
            
            socket.emit('profile_updated', {
                username: currentUsername,
                displayName: user.displayName,
                avatar: user.avatar,
                bio: user.bio,
                role: user.role
            });
            io.emit('update_online_list', getOnlineUsers());
        }
    });

    socket.on('send_message', (data) => {
        if (!currentUsername) return;
        const user = users.get(currentUsername);
        if (!user) return;

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('receive_message', {
            username: currentUsername,
            displayName: user.displayName || currentUsername,
            avatar: user.avatar || '',
            bio: user.bio || '',
            role: user.role || 'MEMBER',
            text: data.text || '',
            images: data.images || [],
            time: timeStr
        });
    });

    // --- WEBRTC CALL SIGNALING EVENTS ---
    socket.on('call_user', ({ targetUsername, signalData, isVideo }) => {
        const target = users.get(targetUsername);
        const caller = users.get(currentUsername);
        if (target && target.socketId) {
            io.to(target.socketId).emit('incoming_call', {
                signal: signalData,
                fromUsername: currentUsername,
                fromDisplayName: caller ? caller.displayName : currentUsername,
                fromAvatar: caller ? caller.avatar : '',
                fromBio: caller ? caller.bio : '',
                isVideo
            });
        } else {
            socket.emit('call_failed', 'User is offline or unavailable.');
        }
    });

    socket.on('answer_call', ({ targetUsername, signalData }) => {
        const target = users.get(targetUsername);
        if (target && target.socketId) {
            io.to(target.socketId).emit('call_accepted', { signal: signalData });
        }
    });

    socket.on('reject_call', ({ targetUsername }) => {
        const target = users.get(targetUsername);
        if (target && target.socketId) {
            io.to(target.socketId).emit('call_rejected');
        }
    });

    socket.on('end_call', ({ targetUsername }) => {
        const target = users.get(targetUsername);
        if (target && target.socketId) {
            io.to(target.socketId).emit('call_ended');
        }
    });

    socket.on('ice_candidate', ({ targetUsername, candidate }) => {
        const target = users.get(targetUsername);
        if (target && target.socketId) {
            io.to(target.socketId).emit('ice_candidate', { candidate });
        }
    });

    // Admin Controls
    socket.on('kick_user', (targetUsername) => {
        const sender = users.get(currentUsername);
        if (sender && sender.role === 'RS FLAGS / OWNER') {
            const target = users.get(targetUsername);
            if (target && target.socketId) {
                io.to(target.socketId).emit('kicked');
            }
        }
    });

    socket.on('assign_role', ({ targetUsername, newRole }) => {
        const sender = users.get(currentUsername);
        if (sender && sender.role === 'RS FLAGS / OWNER') {
            const target = users.get(targetUsername);
            if (target) {
                target.role = newRole;
                io.emit('update_online_list', getOnlineUsers());
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentUsername) {
            const user = users.get(currentUsername);
            if (user && user.socketId === socket.id) {
                user.socketId = null;
            }
            io.emit('update_online_list', getOnlineUsers());
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});