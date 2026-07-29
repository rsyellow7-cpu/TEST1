const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Ensure public/uploads folder exists on the server
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100 MB buffer
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const registeredUsers = {};

registeredUsers['gw.akira'] = { password: 'Akira@ys7', role: 'RS FLAGS / OWNER' };

io.on('connection', (socket) => {

    socket.on('authenticate', ({ username, password, action }) => {
        const cleanName = username.trim();

        if (action === 'login') {
            if (!registeredUsers[cleanName]) {
                return socket.emit('auth_error', 'User does not exist. Please register.');
            }
            if (registeredUsers[cleanName].password !== password) {
                return socket.emit('auth_error', 'Incorrect password.');
            }
        } else if (action === 'register') {
            if (registeredUsers[cleanName]) {
                return socket.emit('auth_error', 'Username already exists. Please log in.');
            }
            registeredUsers[cleanName] = { password, role: 'MEMBER' };
        }

        const role = registeredUsers[cleanName].role;
        users[socket.id] = { username: cleanName, role };

        socket.emit('auth_success', { username: cleanName, role });
        io.emit('user_joined', { username: cleanName, role });
        broadcastOnlineUsers();
    });

    socket.on('send_message', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const savedImageUrls = [];

        // Save incoming Base64 images as physical files on server disk
        if (data.images && Array.isArray(data.images)) {
            data.images.forEach((base64Str) => {
                try {
                    const matches = base64Str.match(/^data:image\/([a-zA-Z]*);base64,(.+)$/);
                    if (matches) {
                        const ext = matches[1] || 'jpeg';
                        const buffer = Buffer.from(matches[2], 'base64');
                        const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
                        const filePath = path.join(uploadDir, fileName);

                        fs.writeFileSync(filePath, buffer);
                        savedImageUrls.push(`/uploads/${fileName}`);
                    }
                } catch (err) {
                    console.error('Error saving image file:', err);
                }
            });
        }

        io.emit('receive_message', {
            username: user.username,
            role: user.role,
            text: data.text || '',
            images: savedImageUrls, // Send public URLs to clients
            time
        });
    });

    socket.on('kick_user', (targetUsername) => {
        const requester = users[socket.id];
        if (requester && requester.role === 'RS FLAGS / OWNER') {
            for (let id in users) {
                if (users[id].username === targetUsername) {
                    io.to(id).emit('kicked');
                    delete users[id];
                    break;
                }
            }
            broadcastOnlineUsers();
            io.emit('system_message', `${targetUsername} was kicked by RS FLAGS Owner.`);
        }
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const username = users[socket.id].username;
            delete users[socket.id];
            io.emit('user_left', { username });
            broadcastOnlineUsers();
        }
    });

    function broadcastOnlineUsers() {
        const onlineList = Object.values(users).map(u => ({ username: u.username, role: u.role }));
        io.emit('update_online_list', onlineList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RS FLAGS Chat server running on port ${PORT}`);
});