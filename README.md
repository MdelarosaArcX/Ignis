# Ignis Transcode

React (Vite + TypeScript) front-end and Node.js (Express + FFmpeg) back-end project.

---

## 1. Prerequisites

* **Node.js** v22.19.0 or compatible LTS
* **npm** v10.9.3 or higher
* **Git**
* **Visual Studio Code** (recommended)
* **FFmpeg** (Latest version recommended)

---

## 2. Clone the Repository

```bash
git clone https://github.com/RGArcx/Ignis-Transcode.git
cd Ignis-Transcode
```

---

## 3. Install Dependencies

### Client

```bash
cd client
npm install
```

### Server

```bash
cd ../server
npm install
```

### Root

```bash
cd ..
npm install
```

---

## 4. Run the Application

Run both frontend and backend together from the root:

```bash
npm run dev
```

This uses `concurrently` to run:

* Client at [http://localhost:5173](http://localhost:5173)
* Server at [http://localhost:3000](http://localhost:3000) (or your configured port)

---

## 5. Scripts

Root `package.json`:

```json
{
  "name": "ignis-transcode",
  "private": true,
  "scripts": {
    "dev": "concurrently \"cd client && npm run dev\" \"cd server && node server.js\""
  },
  "devDependencies": {
    "concurrently": "^9.2.1"
  }
}
```

---

## 6. Production Build

1. Build client:

```bash
cd client
npm run build
```

2. Serve build from server (`server/server.js`):

```js
import express from 'express';
import path from 'path';
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
```

3. Start production server:

```bash
cd server
NODE_ENV=production node server.js
```

---

## 7. Troubleshooting

* Port conflicts → change Vite or Express port.
* Module system errors → check `package.json` `type` field.
* ffmpeg errors → `ffmpeg-static` included; install system ffmpeg if needed.

---

## 8. Quick Start Examples

### macOS / Linux

```bash
git clone https://github.com/RGArcx/Ignis-Transcode.git
cd Ignis-Transcode
cd client && npm install
cd ../server && npm install
cd .. && npm install
npm run dev
```

### Windows PowerShell

```powershell
git clone https://github.com/RGArcx/Ignis-Transcode.git
cd Ignis-Transcode\client
npm install
cd ..\server
npm install
cd ..
npm install
npm run dev
```
