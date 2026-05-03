# SyncWave: Collaborative Party Session System

SyncWave is a modern, full-stack web application designed to solve the chaos of music management at gatherings. It allows a host to create a party room where guests can join, suggest music via AI-powered search, and influence the session in real time.

## 🚀 The Problem We Solve

In traditional party settings, one person usually controls the aux cord, or guests shout requests that get forgotten. **SyncWave** provides:
- **Collaborative Queue Control**: Guests can add tracks to a shared queue without sharing a physical device.
- **AI-Powered Discovery**: Use natural language (e.g., "Chill evening lo-fi") to find music immediately via Gemini AI integration.
- **Environmental Immersion**: Interactive 3D backgrounds and "Ambient Vibes" (Rain, Fire, Forest, etc.) that sync across all connected devices.
- **Smart Management**: Hosts can reorder tracks via drag-and-drop, kick disruptive listeners, and manage the party with professional dashboard tools.

## 🛠️ Tech Stack

- **Frontend**: 
  - **React 18 & Vite**: For a high-performance, single-page application experience.
  - **Tailwind CSS (v4)**: For modern, responsive styling and glassmorphism UI.
  - **Dnd-kit**: For smooth drag-and-drop reordering of the music queue.
  - **Three.js & React Three Fiber**: For immersive 3D background visualizations.
  - **Motion (Framer Motion)**: For fluid UI transitions and animations.
  - **Lucide React**: For beautiful, consistent iconography.
- **Backend**:
  - **Express (Node.js)**: Handling API routes and serving the frontend.
  - **Google Gemini AI SDK**: Powering the smart music search and suggestion engine.
  - **Firebase Firestore**: Providing real-time state synchronization for the queue and party status.
  - **Socket.io**: For low-latency event broadcasting between host and listeners.
- **Audio Engine**:
  - **Howler.js**: Managing ambient soundscapes.
  - **YouTube IFrame API**: For high-quality music streaming within the app.

## ⚙️ How to Run This Code

### Prerequisites
- Node.js (v18 or higher)
- A Firebase Project (with Firestore enabled)
- A Google Gemini API Key

### Installation

1. **Clone and Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   Create a `.env` file in the root directory (using `.env.example` as a template):
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   YOUTUBE_API_KEY=your_youtube_api_key_here
   FIREBASE_PROJECT_ID=your-firebase-project-id
   FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
   ```

3. **Firebase Configuration**:
   Copy `firebase-applet-config.example.json` to `firebase-applet-config.json` and fill in your Firebase project details from [Firebase Console](https://console.firebase.google.com):
   ```bash
   cp firebase-applet-config.example.json firebase-applet-config.json
   ```
   ⚠️ **Important**: Never commit `firebase-applet-config.json` to version control. It contains sensitive credentials and is already in `.gitignore`. Treat it like a password.

3. **Database Rules**:
   Deploy the Firestore security rules provided in `firestore.rules` to ensure the party system is secure.

4. **Development Mode**:
   Launch the full-stack dev server:
   ```bash
   npm run dev
   ```
   The app will typically be available at `http://localhost:3000`.

5. **Production Build**:
   ```bash
   npm run build
   npm start
   ```

## 🎮 Key Features for Users

- **Host Dashboard**: Complete control over playback, volume, queue reordering, and listener moderation.
- **Instant Invite**: QR Code and one-click invite link sharing.
- **Ambient System**: Overlays for Rain, Fire, Forest, Wind, and Coffee Shop vibes with independent volume control.
- **Smart Queue**: Real-time updates across all devices when a track is added, played, or moved.
- **Glassmorphism UI**: A technical yet elegant interface built for dark-room party environments.

---

Built for shared listening and live session control.
