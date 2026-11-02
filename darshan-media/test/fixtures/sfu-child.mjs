import net from 'node:net';
net.createServer((socket) => socket.end()).listen(Number(process.argv[2]), '127.0.0.1');
