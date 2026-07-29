const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8 // 100 MB for media
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory user database & message history
const users = new Map();

function getOnlineUsers() {
    const list = [];
    users.forEach((data, username) => {
        if (data.socketId) {
            list.push({
                username,
                displayName: data.displayName || username,
                avatar: data.avatar || '',
                bio: data.bio || '',
                role: data.role || 'MEMBER',
                dpEffect: data.dpEffect || 'dp-effect-none'
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

        const cleanUser = username.trim();
        const isOwnerCreds = (cleanUser.toLowerCase() === 'gw.akira' && password === 'Akira@ys7');

        if (action === 'register') {
            if (users.has(cleanUser)) {
                return socket.emit('auth_error', 'Username already exists.');
            }
            const role = isOwnerCreds ? 'OWNER' : 'MEMBER';
            users.set(cleanUser, { 
                password, 
                displayName: cleanUser, 
                avatar: '', 
                bio: 'Hey there! I am using RS FLAGS Chat.', 
                role, 
                dpEffect: 'dp-effect-none',
                socketId: socket.id 
            });
            currentUsername = cleanUser;
        } else {
            const user = users.get(cleanUser);
            if (!user && isOwnerCreds) {
                users.set(cleanUser, { 
                    password, 
                    displayName: cleanUser, 
                    avatar: '', 
                    bio: 'Server Owner', 
                    role: 'OWNER', 
                    dpEffect: 'dp-effect-none',
                    socketId: socket.id 
                });
                currentUsername = cleanUser;
            } else if (!user || user.password !== password) {
                return socket.emit('auth_error', 'Invalid username or password.');
            } else {
                user.socketId = socket.id;
                if (isOwnerCreds) user.role = 'OWNER';
                currentUsername = cleanUser;
            }
        }

        const userData = users.get(currentUsername);
        socket.emit('auth_success', {
            username: currentUsername,
            displayName: userData.displayName,
            avatar: userData.avatar,
            bio: userData.bio,
            role: userData.role,
            dpEffect: userData.dpEffect || 'dp-effect-none'
        });

        io.emit('update_online_list', getOnlineUsers());
    });

    socket.on('update_profile', ({ displayName, avatar, bio, dpEffect }) => {
        if (!currentUsername) return;
        const user = users.get(currentUsername);
        if (user) {
            if (displayName) user.displayName = displayName;
            if (avatar !== undefined) user.avatar = avatar;
            if (bio !== undefined) user.bio = bio;
            if (dpEffect !== undefined) user.dpEffect = dpEffect;
            
            socket.emit('profile_updated', {
                username: currentUsername,
                displayName: user.displayName,
                avatar: user.avatar,
                bio: user.bio,
                role: user.role,
                dpEffect: user.dpEffect
            });
            io.emit('update_online_list', getOnlineUsers());
        }
    });

    // OWNER PRIVILEGE: Kick Member
    socket.on('kick_user', (targetUsername) => {
        if (!currentUsername) return;
        const currentUser = users.get(currentUsername);

        if (currentUser && currentUser.role === 'OWNER') {
            const target = users.get(targetUsername);
            if (target) {
                if (target.socketId) {
                    io.to(target.socketId).emit('kicked');
                    const targetSocket = io.sockets.sockets.get(target.socketId);
                    if (targetSocket) targetSocket.disconnect(true);
                }
                users.delete(targetUsername);
                io.emit('update_online_list', getOnlineUsers());
            }
        }
    });

    // OWNER PRIVILEGE: Assign Custom Role
    socket.on('assign_role', ({ targetUsername, newRole }) => {
        if (!currentUsername) return;
        const currentUser = users.get(currentUsername);

        if (currentUser && currentUser.role === 'OWNER') {
            const target = users.get(targetUsername);
            if (target) {
                target.role = newRole || 'MEMBER';
                if (target.socketId) {
                    io.to(target.socketId).emit('role_updated', target.role);
                }
                io.emit('update_online_list', getOnlineUsers());
            }
        }
    });

    // SEND MESSAGE
    socket.on('send_message', (data) => {
        if (!currentUsername) return;
        const user = users.get(currentUsername);
        if (!user) return;

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        io.emit('receive_message', {
            id: messageId,
            username: currentUsername,
            displayName: user.displayName || currentUsername,
            avatar: user.avatar || '',
            bio: user.bio || '',
            role: user.role || 'MEMBER',
            dpEffect: user.dpEffect || 'dp-effect-none',
            text: data.text || '',
            images: data.images || [],
            audio: data.audio || null,
            video: data.video || null,
            time: timeStr
        });
    });

    // DELETE MESSAGE
    socket.on('delete_message', ({ messageId, authorUsername }) => {
        if (!currentUsername) return;
        const user = users.get(currentUsername);
        if (!user) return;

        // Allow deletion if the user is the author OR if the user is the OWNER
        if (currentUsername === authorUsername || user.role === 'OWNER') {
            io.emit('message_deleted', messageId);
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