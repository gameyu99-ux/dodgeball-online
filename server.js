const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8093;

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/dodgeball.html' : req.url;
  filePath = filePath.split('?')[0];
  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);
  const types = {
    '.html': 'text/html', '.js': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.ico': 'image/x-icon'
  };

  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function genKey() {
  let key;
  do { key = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(key));
  return key;
}

class Room {
  constructor(key) {
    this.key = key;
    this.clients = new Map();
    this.hostWs = null;
    this.slots = new Array(20).fill(null);
    this.state = 'waiting';
  }

  assignSlot(ws) {
    // 人間が入れるのは0-7(BLUE内野)と10-17(RED内野)のみ、8-9と18-19はCPU外野固定
    const blueCount = this.slots.slice(0, 8).filter(Boolean).length;
    const redCount = this.slots.slice(10, 18).filter(Boolean).length;
    let start, end;
    if (blueCount <= redCount) { start = 0; end = 8; }
    else { start = 10; end = 18; }
    for (let i = start; i < end; i++) {
      if (!this.slots[i]) { this.slots[i] = ws; return i; }
    }
    // どちらのチームにも空きがない場合、残りのチームを探す
    for (let i = 0; i < 8; i++) { if (!this.slots[i]) { this.slots[i] = ws; return i; } }
    for (let i = 10; i < 18; i++) { if (!this.slots[i]) { this.slots[i] = ws; return i; } }
    return -1;
  }

  removePlayer(ws) {
    const idx = this.slots.indexOf(ws);
    if (idx !== -1) this.slots[idx] = null;
    this.clients.delete(ws);
  }

  getSlotList() {
    return this.slots.map((ws, i) => {
      if (!ws) return null;
      const info = this.clients.get(ws);
      return info ? { slot: i, name: info.name } : null;
    }).filter(Boolean);
  }

  broadcast(msg, exclude = null) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.clients) {
      if (ws !== exclude && ws.readyState === 1) ws.send(data);
    }
  }

  sendTo(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws) => {
  let room = null;
  let mySlot = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create_room': {
        const key = genKey();
        room = new Room(key);
        rooms.set(key, room);
        room.hostWs = ws;
        mySlot = room.assignSlot(ws);
        room.clients.set(ws, { slot: mySlot, name: msg.name || 'Host' });
        room.sendTo(ws, {
          type: 'room_created', key, slot: mySlot, isHost: true,
          players: room.getSlotList()
        });
        break;
      }

      case 'join_room': {
        const r = rooms.get(msg.key);
        if (!r) { ws.send(JSON.stringify({ type: 'error', message: 'ルームが見つかりません' })); return; }
        if (r.clients.size >= 16) { ws.send(JSON.stringify({ type: 'error', message: 'ルームが満員です (最大16人)' })); return; }
        if (r.state === 'playing') { ws.send(JSON.stringify({ type: 'error', message: 'ゲーム中です' })); return; }
        room = r;
        mySlot = room.assignSlot(ws);
        room.clients.set(ws, { slot: mySlot, name: msg.name || 'Player' });
        room.sendTo(ws, {
          type: 'room_joined', key: msg.key, slot: mySlot, isHost: false,
          players: room.getSlotList()
        });
        room.broadcast({
          type: 'player_joined', slot: mySlot, name: msg.name || 'Player',
          players: room.getSlotList()
        }, ws);
        break;
      }

      case 'start_game': {
        if (room && room.hostWs === ws) {
          room.state = 'playing';
          room.broadcast({ type: 'game_start', players: room.getSlotList() });
        }
        break;
      }

      case 'input': {
        if (room && room.hostWs && room.hostWs !== ws && room.hostWs.readyState === 1) {
          room.hostWs.send(JSON.stringify({ type: 'remote_input', slot: mySlot, input: msg.input }));
        }
        break;
      }

      case 'game_state': {
        if (room) room.broadcast({ type: 'game_state', state: msg.state }, ws);
        break;
      }

      case 'choice_request': {
        if (room && msg.targetSlot !== undefined) {
          const targetWs = room.slots[msg.targetSlot];
          if (targetWs) room.sendTo(targetWs, { type: 'choice_request' });
        }
        break;
      }

      case 'choice_result': {
        if (room && room.hostWs && room.hostWs.readyState === 1) {
          room.hostWs.send(JSON.stringify({ type: 'choice_result', slot: mySlot, returnToField: msg.returnToField }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    const wasHost = room.hostWs === ws;
    room.removePlayer(ws);

    if (room.clients.size === 0) {
      rooms.delete(room.key);
      return;
    }

    room.broadcast({
      type: 'player_left', slot: mySlot, wasHost,
      players: room.getSlotList()
    });

    if (wasHost) {
      const [newHost] = room.clients.keys();
      room.hostWs = newHost;
      const info = room.clients.get(newHost);
      room.sendTo(newHost, { type: 'become_host', slot: info.slot });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Dodgeball server on http://localhost:${PORT}`);
});
